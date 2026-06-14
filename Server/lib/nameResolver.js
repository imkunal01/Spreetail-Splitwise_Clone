"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// lib/nameResolver.js
//
// Name resolution utilities for CSV import.
// Used by routes/import.js to match raw CSV name strings to known DB users.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: levenshtein
// Iterative DP Levenshtein edit distance between two strings.
// Exported so import.js can use it directly for CONFLICTING_DUPLICATE checks.
// ─────────────────────────────────────────────────────────────────────────────

function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);

    for (let i = 1; i <= m; i++) {
        const curr = [i];
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,       // deletion
                curr[j - 1] + 1,   // insertion
                prev[j - 1] + cost // substitution
            );
        }
        prev = curr;
    }
    return prev[n];
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: resolveName
//
// Resolves a raw name string against a list of known user objects.
//
// Resolution statuses:
//   EMPTY      – rawName is blank / whitespace only
//   RESOLVED   – exact (case-insensitive) match found
//   SUGGESTED  – no exact match but a close fuzzy match (Levenshtein <= 2)
//   UNKNOWN    – no match whatsoever
//
// @param {string} rawName
// @param {{ id: string, name: string, email: string }[]} knownUsers
//
// @returns {{
//   status:     'EMPTY' | 'RESOLVED' | 'SUGGESTED' | 'UNKNOWN',
//   resolved:   object | null,   // the matched user (RESOLVED only)
//   suggestion: object | null,   // the fuzzy candidate (SUGGESTED only)
//   distance:   number,          // Levenshtein distance (0 for RESOLVED)
//   note:       string | null    // human-readable explanation of auto-resolution
// }}
// ─────────────────────────────────────────────────────────────────────────────

function resolveName(rawName, knownUsers) {
    if (!rawName || typeof rawName !== "string" || !rawName.trim()) {
        return { status: "EMPTY", resolved: null, suggestion: null, distance: Infinity, note: null };
    }

    const normalized = rawName.trim().toLowerCase();

    // ── 1. Exact match (case-insensitive) ────────────────────────────────────
    const exact = knownUsers.find((u) => u.name.trim().toLowerCase() === normalized);
    if (exact) {
        // If the raw name differed only in case/whitespace, add a note
        const note = exact.name.trim() !== rawName.trim()
            ? `case/whitespace variant of "${exact.name}"`
            : null;
        return { status: "RESOLVED", resolved: exact, suggestion: null, distance: 0, note };
    }

    // ── 2. Fuzzy match (Levenshtein <= 2) ────────────────────────────────────
    let bestUser = null;
    let bestDist = Infinity;

    for (const user of knownUsers) {
        const dist = levenshtein(normalized, user.name.trim().toLowerCase());
        if (dist <= 2 && dist < bestDist) {
            bestDist = dist;
            bestUser = user;
        }
    }

    if (bestUser) {
        return {
            status: "SUGGESTED",
            resolved: null,
            suggestion: bestUser,
            distance: bestDist,
            note: `fuzzy match: "${rawName}" → "${bestUser.name}" (distance ${bestDist})`,
        };
    }

    // ── 3. No match ───────────────────────────────────────────────────────────
    return { status: "UNKNOWN", resolved: null, suggestion: null, distance: Infinity, note: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: extractAllNames
//
// Walks all CSV rows and collects every distinct raw name string that appears
// in either the `paid_by` or `split_with` columns.
// Returns a deduplicated array of non-empty name strings.
//
// @param {{ paid_by?: string, split_with?: string }[]} rows
// @returns {string[]}
// ─────────────────────────────────────────────────────────────────────────────

function extractAllNames(rows) {
    const seen = new Set();

    for (const row of rows) {
        // paid_by — single name
        const payer = (row.paid_by || "").trim();
        if (payer) seen.add(payer);

        // split_with — semicolon-separated list
        const splitWith = (row.split_with || "").split(";");
        for (const part of splitWith) {
            const name = part.trim();
            if (name) seen.add(name);
        }
    }

    return Array.from(seen);
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: inferMembershipDates
//
// Scans CSV rows for date references tied to a given name (in either paid_by
// or split_with columns) and returns the earliest and latest parsed dates seen.
//
// Used to:
//   a) Suggest joinedAt / leftAt dates for newly created guest users.
//   b) Suggest leftAt for existing members who stop appearing in the CSV.
//
// @param {string} name   – Raw name string to search for (case-insensitive)
// @param {object[]} rows – Parsed CSV rows (already run through csv-parse)
//
// @returns {{ firstSeen: Date | null, lastSeen: Date | null }}
// ─────────────────────────────────────────────────────────────────────────────

// Inline minimal date parser — avoids circular import of import.js helpers.
const MONTH_MAP_NR = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function _parseDateSimple(str) {
    if (!str || typeof str !== "string") return null;
    const s = str.trim();

    // DD-MM-YYYY
    let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (m) {
        const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
        return isNaN(d.getTime()) ? null : d;
    }

    // YYYY-MM-DD
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return isNaN(d.getTime()) ? null : d;
    }

    // DD/MM/YYYY
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
        const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
        return isNaN(d.getTime()) ? null : d;
    }

    // MMM-DD (no year — use current year)
    m = s.match(/^([A-Za-z]{3})-(\d{1,2})$/);
    if (m) {
        const monthIdx = MONTH_MAP_NR[m[1].toLowerCase()];
        if (monthIdx !== undefined) {
            const d = new Date(Date.UTC(new Date().getFullYear(), monthIdx, +m[2]));
            return isNaN(d.getTime()) ? null : d;
        }
    }

    return null;
}

function inferMembershipDates(name, rows) {
    if (!name || !rows || rows.length === 0) {
        return { firstSeen: null, lastSeen: null };
    }

    const normalizedName = name.trim().toLowerCase();
    let firstSeen = null;
    let lastSeen = null;

    for (const row of rows) {
        // Check if this name appears in this row
        const payerMatch =
            (row.paid_by || "").trim().toLowerCase() === normalizedName;

        const splitWithNames = (row.split_with || "")
            .split(";")
            .map((n) => n.trim().toLowerCase());
        const splitMatch = splitWithNames.includes(normalizedName);

        if (!payerMatch && !splitMatch) continue;

        const date = _parseDateSimple(row.date);
        if (!date) continue;

        if (firstSeen === null || date < firstSeen) firstSeen = date;
        if (lastSeen === null || date > lastSeen) lastSeen = date;
    }

    return { firstSeen, lastSeen };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    levenshtein,
    resolveName,
    extractAllNames,
    inferMembershipDates,
};
