"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

const { Router } = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");
const { parse } = require("csv-parse/sync");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const {
    calculateSplits,
    validateSplits,
    normalizeSplits,
    computeRowHash,
} = require("../lib/splitCalculator");
const { resolveName, extractAllNames, inferMembershipDates, levenshtein } = require("../lib/nameResolver");
const { Prisma } = require("@prisma/client");
const crypto = require("crypto");
const axios = require("axios");

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage() });

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: parseDate(str)
//
// Tries multiple date formats in order.
// Returns { date: Date, format: string, wasAssumedYear: boolean } or null.
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_MAP = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(str) {
    if (!str || typeof str !== "string") return null;
    const s = str.trim();

    // ── 1. DD-MM-YYYY ──────────────────────────────────────────────────────────
    {
        const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) {
            const [, dd, mm, yyyy] = m;
            const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
            if (!isNaN(date.getTime())) {
                return { date, format: "DD-MM-YYYY", wasAssumedYear: false };
            }
        }
    }

    // ── 2. YYYY-MM-DD (ISO) ────────────────────────────────────────────────────
    {
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
            const [, yyyy, mm, dd] = m;
            const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
            if (!isNaN(date.getTime())) {
                return { date, format: "YYYY-MM-DD", wasAssumedYear: false };
            }
        }
    }

    // ── 3. DD/MM/YYYY ──────────────────────────────────────────────────────────
    {
        const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
            const [, dd, mm, yyyy] = m;
            const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
            if (!isNaN(date.getTime())) {
                return { date, format: "DD/MM/YYYY", wasAssumedYear: false };
            }
        }
    }

    // ── 4. MMM-DD (no year — assume current year) ──────────────────────────────
    {
        const m = s.match(/^([A-Za-z]{3})-(\d{1,2})$/);
        if (m) {
            const [, mon, day] = m;
            const monthIndex = MONTH_MAP[mon.toLowerCase()];
            if (monthIndex !== undefined) {
                const currentYear = new Date().getFullYear();
                const date = new Date(Date.UTC(currentYear, monthIndex, +day));
                if (!isNaN(date.getTime())) {
                    return { date, format: "MON-DD", wasAssumedYear: true };
                }
            }
        }
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: isAmbiguousDate(str)
//
// Only for DD-MM-YYYY strings where day <= 12 AND month <= 12.
// Returns { ambiguous: true, ddmm: Date, mmdd: Date } or { ambiguous: false }.
// ─────────────────────────────────────────────────────────────────────────────

function isAmbiguousDate(str) {
    if (!str || typeof str !== "string") return { ambiguous: false };
    const m = str.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return { ambiguous: false };

    const [, p1, p2, yyyy] = m;
    const d1 = +p1;
    const d2 = +p2;

    if (d1 > 12 || d2 > 12) return { ambiguous: false };

    const ddmm = new Date(Date.UTC(+yyyy, d2 - 1, d1)); // p1=day, p2=month
    const mmdd = new Date(Date.UTC(+yyyy, d1 - 1, d2)); // p1=month, p2=day

    if (isNaN(ddmm.getTime()) || isNaN(mmdd.getTime())) return { ambiguous: false };

    return { ambiguous: true, ddmm, mmdd };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: fetchUsdRate()
//
// Fetches live USD→INR exchange rate from Frankfurter API.
// Falls back to 83.50 on any error.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchUsdRate() {
    try {
        const response = await axios.get(
            "https://api.frankfurter.app/latest?from=USD&to=INR",
            { timeout: 4000 }
        );
        return response.data.rates.INR;
    } catch {
        return 83.50;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: getActiveMembersOnDate(groupId, date, client)
//
// Returns all users who were active members of `groupId` on `date`.
// Accepts a Prisma client or transaction client.
// ─────────────────────────────────────────────────────────────────────────────

async function getActiveMembersOnDate(groupId, date, client) {
    const memberships = await client.groupMembership.findMany({
        where: {
            groupId,
            joinedAt: { lte: date },
            OR: [{ leftAt: null }, { leftAt: { gte: date } }],
        },
        include: { user: { select: { id: true, name: true } } },
    });
    return memberships.map((m) => ({ userId: m.userId, name: m.user.name }));
}

// ─────────────────────────────────────────────────────────────────────────────
// SEEDER DEFAULT ACTIONS
//
// Maps each anomaly type → the choice seed.js (the corrected seeder) would
// make automatically.  Used to build the `autoDecisions` array returned by
// /preview so callers can pass it straight to /confirm and get exactly the
// same data as running the seeder script.
// ─────────────────────────────────────────────────────────────────────────────

const SEEDER_DEFAULT_ACTIONS = {
    MISSING_REQUIRED_FIELD:   "skip",
    INVALID_AMOUNT:           "skip",
    MISSING_SPLIT_WITH:       "import",           // EQUAL split → active members on date
    ZERO_AMOUNT:              "skip",
    NEGATIVE_AMOUNT:          "import_as_refund",
    UNPARSEABLE_DATE:         "skip",
    ASSUMED_DATE_YEAR:        "import",            // assume current year
    AMBIGUOUS_DATE:           "use_dd_mm",         // treat as DD-MM-YYYY
    MISSING_CURRENCY:         "assume_inr",
    USD_NO_EXCHANGE_RATE:     "apply_rate",
    MISSING_PAYER:            "skip",              // seed.js FIX #5: exclude rows with no payer
    UNKNOWN_PAYER_SUGGESTION: "use_suggestion",
    UNKNOWN_PAYER:            "skip",              // seed.js: excludes unresolvable payers
    SETTLEMENT_AS_EXPENSE:    "import_as_settlement",
    INACTIVE_MEMBER_IN_SPLIT: "remove_inactive",
    UNKNOWN_MEMBER_IN_SPLIT:  "remove_from_split",
    INVALID_SPLIT_TYPE:       "skip",
    PERCENTAGE_SUM_INVALID:   "normalize_to_100",
    DUPLICATE_EXACT:          "skip",
    DUPLICATE_NEAR_EXACT:     "skip",              // seed.js skips near-duplicates (e.g. Marina bites)
    CONFLICTING_DUPLICATE:    "skip",              // seed.js skips near-duplicate rows
};

// Descriptions containing these strings are EXCLUDED entirely by seed.js
// (seed.js FIX #16: "deposit share" = direct transfer, skipped even as settlement).
const SEEDER_EXCLUDE_PATTERNS = ["deposit share"];

/**
 * Given a row (clean or flagged) from the preview step, compute the decision
 * that seed.js would make automatically and return
 *   { rowNumber, action, resolvedData }
 * ready to send straight to /confirm.
 *
 * @param {{ rowNumber, parsedData, anomalies?: array }} row
 * @param {array} knownUsers  — the merged user list from the preview step
 */
function computeAutoDecision(row, knownUsers) {
    const { rowNumber, parsedData, anomalies = [] } = row;

    // ── Seeder hard-excludes certain description patterns ─────────────────────
    const descLower = (parsedData.description || "").toLowerCase();
    if (SEEDER_EXCLUDE_PATTERNS.some((p) => descLower.includes(p))) {
        return { rowNumber, action: "skip", resolvedData: parsedData };
    }

    // ── Determine winning action ──────────────────────────────────────────────
    // A single 'skip' anomaly overrides everything.
    // Among non-skip actions: settlement > refund > import.
    let shouldSkip = false;
    let finalAction = "import";

    for (const anomaly of anomalies) {
        const seederAction = SEEDER_DEFAULT_ACTIONS[anomaly.type];
        if (!seederAction) continue;
        if (seederAction === "skip") { shouldSkip = true; break; }
        if (seederAction === "import_as_settlement") finalAction = "import_as_settlement";
        else if (seederAction === "import_as_refund" && finalAction !== "import_as_settlement") finalAction = "import_as_refund";
        // all other non-skip actions leave the base action as "import"
    }

    if (shouldSkip) return { rowNumber, action: "skip", resolvedData: parsedData };

    // ── Patch resolvedData per-anomaly ────────────────────────────────────────
    let resolvedData = { ...parsedData };

    for (const anomaly of anomalies) {
        switch (anomaly.type) {

            case "MISSING_CURRENCY":
                // assume_inr → override currency + rate
                resolvedData = { ...resolvedData, currency: "INR", exchangeRate: 1 };
                break;

            case "NEGATIVE_AMOUNT":
                // import_as_refund → mark as refund
                resolvedData = { ...resolvedData, isRefund: true };
                break;

            case "UNKNOWN_PAYER_SUGGESTION":
                // use_suggestion → accept the fuzzy-match suggestion as payer
                if (anomaly.detail?.suggestion?.id) {
                    resolvedData = { ...resolvedData, paidById: anomaly.detail.suggestion.id };
                }
                break;

            case "INACTIVE_MEMBER_IN_SPLIT": {
                // For settlements the split member IS the payee — never strip them.
                if (finalAction === "import_as_settlement") break;

                // remove_inactive → drop members whose membership had ended
                const inactiveNames = new Set(anomaly.detail?.inactiveMembers || []);
                const inactiveIds = new Set(
                    [...inactiveNames]
                        .map((name) => knownUsers.find((u) => u.name === name)?.id)
                        .filter(Boolean)
                );
                resolvedData = {
                    ...resolvedData,
                    splits: resolvedData.splits.filter((s) => !inactiveIds.has(s.userId)),
                    splitWithNames: resolvedData.splitWithNames.filter((n) => !inactiveNames.has(n)),
                };
                break;
            }

            case "UNKNOWN_MEMBER_IN_SPLIT": {
                // For settlements the split member IS the payee — never strip them.
                if (finalAction === "import_as_settlement") break;

                // remove_from_split → drop unresolvable names from splitWithNames
                // (splits already only has resolved users so no change needed there)
                const unknownRaw = new Set((anomaly.detail?.unknownMembers || []).map((u) => u.raw));
                resolvedData = {
                    ...resolvedData,
                    splitWithNames: resolvedData.splitWithNames.filter((n) => !unknownRaw.has(n)),
                };
                break;
            }

            // AMBIGUOUS_DATE / ASSUMED_DATE_YEAR / USD_NO_EXCHANGE_RATE:
            // parsedData already has the correct values (DD-MM interp, assumed
            // year, usdRate applied) — no additional patch needed.
            default:
                break;
        }
    }

    return { rowNumber, action: finalAction, resolvedData };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE 1: POST /api/import/:groupId/preview
//
// Accepts a multipart CSV upload, runs 20 anomaly checks on each row,
// and returns:
//   - cleanRows:      rows with no anomalies (ready to confirm as-is)
//   - flaggedRows:    rows with one or more anomalies (require user decisions)
//   - autoDecisions:  pre-built decisions using seeder-like defaults for ALL
//                     rows — pass directly to /confirm for zero-interaction import
//   - nameResolution: summary of auto-resolved / needs-confirmation / unknown names
//   - memberLeftDateSuggestions: existing members who may have left
//   - usdRateUsed:    the exchange rate that was applied for USD detection
// ─────────────────────────────────────────────────────────────────────────────

router.post("/:groupId/preview", upload.single("file"), async (req, res) => {
    try {
        // ── Guard: file must be present ───────────────────────────────────────
        if (!req.file) {
            return res.status(400).json({
                error: "No file uploaded. Send a multipart/form-data request with field 'file'.",
            });
        }

        const { groupId } = req.params;

        // ── A. Parse CSV ──────────────────────────────────────────────────────
        // trim: false — we need raw values for anomaly detection (comma amounts, etc.)
        const rows = parse(req.file.buffer, {
            columns: true,
            skip_empty_lines: true,
            trim: false,
        });

        // ── B + C + D. Parallel DB queries + USD rate fetch ───────────────────
        // IMPORTANT: use Promise.all so the Frankfurter HTTP call (slow from India)
        // does not block Supabase connections from being released promptly.
        const [memberships, allSystemUsers, existingExpenses, usdRate] = await Promise.all([
            // B. Group members with isGuest flag (carry membership date context)
            prisma.groupMembership.findMany({
                where: { groupId },
                include: {
                    user: {
                        select: { id: true, name: true, email: true, isGuest: true },
                    },
                },
            }),
            // B2. ALL system users — so names resolve even in fresh/empty groups
            prisma.user.findMany({
                select: { id: true, name: true, email: true, isGuest: true },
            }),
            // C. Existing import hashes for dedup
            prisma.expense.findMany({
                where: { groupId, importedRowHash: { not: null } },
                select: { importedRowHash: true },
            }),
            // D. Live USD→INR rate
            fetchUsdRate(),
        ]);

        // Merge: group members first (they carry membership date context for
        // inactive-member checks), then any additional system-wide users.
        const groupMemberIds = new Set(memberships.map((m) => m.userId));
        const knownUsers = [
            ...memberships.map((m) => m.user),
            ...allSystemUsers.filter((u) => !groupMemberIds.has(u.id)),
        ];
        const unknownUser = knownUsers.find((u) => u.email === "unknown@splitwise.local");
        const existingHashSet = new Set(existingExpenses.map((e) => e.importedRowHash));

        // ── E. Extract and resolve all names ──────────────────────────────────
        const allRawNames = extractAllNames(rows);
        const nameResolutionMap = {};
        for (const rawName of allRawNames) {
            nameResolutionMap[rawName] = resolveName(rawName, knownUsers);
        }

        // ── F. Identify names that need guest-user creation ───────────────────
        const namesToCreate = [];
        for (const [raw, resolution] of Object.entries(nameResolutionMap)) {
            if (resolution.status === "UNKNOWN") {
                namesToCreate.push({
                    raw,
                    generatedEmail: `${raw.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${crypto.randomBytes(3).toString("hex")}@splitwise.local`,
                    inferredDates: inferMembershipDates(raw, rows),
                });
            }
        }

        // ── G. Build inferred left-date suggestions for existing members ──────
        const memberLeftDateSuggestions = [];
        for (const membership of memberships) {
            if (membership.leftAt) continue; // already has a recorded leave date

            const dates = inferMembershipDates(membership.user.name, rows);
            if (dates.lastSeen) {
                const daysSinceLastSeen = (Date.now() - dates.lastSeen.getTime()) / (1000 * 60 * 60 * 24);
                if (daysSinceLastSeen > 30) {
                    memberLeftDateSuggestions.push({
                        userId: membership.userId,
                        name: membership.user.name,
                        lastSeenInCSV: dates.lastSeen,
                        suggestion: `Last appears in CSV on ${dates.lastSeen.toISOString().split("T")[0]}. Set as leave date?`,
                    });
                }
            }
        }

        // ── H. Process each row ───────────────────────────────────────────────
        const cleanRows = [];
        const flaggedRows = [];

        const batchHashes = new Map();     // hash → rowNumber  (intra-batch dedup)
        const batchDescriptions = [];      // { rowNumber, date, description, amount, payer }

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNumber = i + 2; // row 1 = header

            // ── PRE-PROCESS ───────────────────────────────────────────────────

            // Amount — strip commas before parsing
            const rawAmount = (row.amount || "").replace(/,/g, "");
            const parsedAmount = parseFloat(rawAmount);

            // Currency
            const rawCurrency = (row.currency || "").trim().toUpperCase();

            // Split type — normalize to internal enum
            const rawSplitType = (row.split_type || "").trim().toLowerCase();
            const SPLIT_TYPE_MAP = {
                equal: "EQUAL",
                unequal: "EXACT",
                exact: "EXACT",
                percentage: "PERCENTAGE",
                share: "RATIO",
                ratio: "RATIO",
            };
            const normalizedSplitType = SPLIT_TYPE_MAP[rawSplitType] || null;

            // Split-with names
            const rawSplitNames = (row.split_with || "")
                .split(";")
                .map((n) => n.trim())
                .filter(Boolean);

            // Split details (raw string — kept for anomaly checks)
            const splitDetails = (row.split_details || "").trim();

            // Payer resolution
            const payerResolution = resolveName((row.paid_by || "").trim(), knownUsers);

            // Date parsing
            const parsedDateResult = parseDate((row.date || "").trim());
            const ambiguityCheck = isAmbiguousDate((row.date || "").trim());

            const anomalies = [];
            const autoNotes = [];

            // ─────────────────────────────────────────────────────────────────
            // CHECK 1: MISSING REQUIRED FIELDS
            // ─────────────────────────────────────────────────────────────────
            if (!row.description || !(row.description || "").trim()) {
                anomalies.push({
                    type: "MISSING_REQUIRED_FIELD",
                    message: "Description is empty.",
                    detail: { field: "description" },
                    options: ["skip"],
                    defaultAction: "skip",
                });
            }

            if (isNaN(parsedAmount)) {
                anomalies.push({
                    type: "INVALID_AMOUNT",
                    message: `Amount "${row.amount}" cannot be parsed as a number.`,
                    detail: { rawAmount: row.amount },
                    options: ["skip"],
                    defaultAction: "skip",
                });
            }

            if (!row.split_with || !(row.split_with || "").trim()) {
                anomalies.push({
                    type: "MISSING_SPLIT_WITH",
                    message: "No members listed in split_with.",
                    detail: {},
                    options: ["skip"],
                    defaultAction: "skip",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 2: ZERO AMOUNT
            // ─────────────────────────────────────────────────────────────────
            if (!isNaN(parsedAmount) && parsedAmount === 0) {
                anomalies.push({
                    type: "ZERO_AMOUNT",
                    message: "Amount is zero. Likely a void or placeholder row.",
                    detail: { notes: row.notes },
                    options: ["skip"],
                    defaultAction: "skip",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 3: NEGATIVE AMOUNT — treat as refund
            // ─────────────────────────────────────────────────────────────────
            if (!isNaN(parsedAmount) && parsedAmount < 0) {
                anomalies.push({
                    type: "NEGATIVE_AMOUNT",
                    message: `Negative amount (${parsedAmount}). Treat as refund?`,
                    detail: { amount: parsedAmount, notes: row.notes },
                    options: ["import_as_refund", "skip"],
                    defaultAction: "import_as_refund",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 4: COMMA IN AMOUNT — auto-fix, just log
            // ─────────────────────────────────────────────────────────────────
            if ((row.amount || "").includes(",") && !isNaN(parsedAmount)) {
                autoNotes.push(
                    `Amount "${row.amount}" had comma formatting — auto-cleaned to ${parsedAmount}`
                );
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 5: EXCESSIVE DECIMAL PLACES — auto-round, just log
            // ─────────────────────────────────────────────────────────────────
            if (!isNaN(parsedAmount) && parsedAmount > 0) {
                const decimalPart = rawAmount.split(".")[1] || "";
                if (decimalPart.length > 2) {
                    autoNotes.push(
                        `Amount ${parsedAmount} has ${decimalPart.length} decimal places — ` +
                        `will be rounded to ${Math.round(parsedAmount * 100) / 100}`
                    );
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 6: UNPARSEABLE DATE / ASSUMED YEAR
            // ─────────────────────────────────────────────────────────────────
            if (!parsedDateResult) {
                anomalies.push({
                    type: "UNPARSEABLE_DATE",
                    message: `Cannot parse date "${row.date}".`,
                    detail: { rawDate: row.date },
                    options: ["skip"],
                    defaultAction: "skip",
                });
            } else if (parsedDateResult.wasAssumedYear) {
                anomalies.push({
                    type: "ASSUMED_DATE_YEAR",
                    message: `Date "${row.date}" had no year. Assumed ${new Date().getFullYear()}.`,
                    detail: {
                        parsedAs: parsedDateResult.date.toISOString().split("T")[0],
                        assumedYear: new Date().getFullYear(),
                    },
                    options: ["import", "skip"],
                    defaultAction: "import",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 7: AMBIGUOUS DATE (DD-MM vs MM-DD)
            // ─────────────────────────────────────────────────────────────────
            if (parsedDateResult && ambiguityCheck.ambiguous) {
                anomalies.push({
                    type: "AMBIGUOUS_DATE",
                    message: `Date "${row.date}" could be DD-MM or MM-DD.`,
                    detail: {
                        asddmm: ambiguityCheck.ddmm.toISOString().split("T")[0],
                        asmmdd: ambiguityCheck.mmdd.toISOString().split("T")[0],
                        note: row.notes,
                    },
                    options: ["use_dd_mm", "use_mm_dd", "skip"],
                    defaultAction: "use_dd_mm",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 8: MISSING CURRENCY
            // ─────────────────────────────────────────────────────────────────
            if (!rawCurrency) {
                anomalies.push({
                    type: "MISSING_CURRENCY",
                    message: "Currency field is empty.",
                    detail: { notes: row.notes },
                    options: ["assume_inr", "skip"],
                    defaultAction: "assume_inr",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 9: USD WITH NO IN-CSV EXCHANGE RATE
            // ─────────────────────────────────────────────────────────────────
            if (rawCurrency === "USD") {
                const absAmount = Math.abs(parsedAmount);
                anomalies.push({
                    type: "USD_NO_EXCHANGE_RATE",
                    message: "Amount is in USD. No exchange rate in CSV.",
                    detail: {
                        usdAmount: parsedAmount,
                        suggestedRate: usdRate,
                        inrEquivalent: Math.round(absAmount * usdRate * 100) / 100,
                    },
                    options: ["apply_rate", "skip"],
                    defaultAction: "apply_rate",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 10: MISSING PAYER
            // ─────────────────────────────────────────────────────────────────
            if (payerResolution.status === "EMPTY") {
                anomalies.push({
                    type: "MISSING_PAYER",
                    message: `No payer specified. (note: "${row.notes}")`,
                    detail: {
                        availableMembers: knownUsers
                            .filter((u) => !u.isGuest || u.email === "unknown@splitwise.local")
                            .map((u) => ({ id: u.id, name: u.name })),
                        unknownUserId: unknownUser?.id,
                    },
                    options: [
                        "assign_to_unknown",
                        ...knownUsers
                            .filter((u) => u.email !== "unknown@splitwise.local")
                            .map((u) => `assign_to_${u.id}`),
                        "skip",
                    ],
                    defaultAction: "assign_to_unknown",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 11: UNKNOWN PAYER — SUGGESTED (fuzzy match)
            // ─────────────────────────────────────────────────────────────────
            if (payerResolution.status === "SUGGESTED") {
                anomalies.push({
                    type: "UNKNOWN_PAYER_SUGGESTION",
                    message: `Payer "${row.paid_by}" not found. Did you mean "${payerResolution.suggestion.name}"?`,
                    detail: {
                        raw: row.paid_by,
                        suggestion: payerResolution.suggestion,
                        distance: payerResolution.distance,
                    },
                    options: ["use_suggestion", "skip"],
                    defaultAction: "use_suggestion",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 12: UNKNOWN PAYER — no match at all
            // ─────────────────────────────────────────────────────────────────
            if (payerResolution.status === "UNKNOWN") {
                anomalies.push({
                    type: "UNKNOWN_PAYER",
                    message: `Payer "${row.paid_by}" not found and no close match.`,
                    detail: { raw: row.paid_by, unknownUserId: unknownUser?.id },
                    options: ["assign_to_unknown", "skip"],
                    defaultAction: "assign_to_unknown",
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 12b: AUTO-RESOLVED NAME VARIATION — log only
            // ─────────────────────────────────────────────────────────────────
            if (payerResolution.status === "RESOLVED" && payerResolution.note) {
                autoNotes.push(
                    `Payer "${row.paid_by}" auto-resolved to "${payerResolution.resolved.name}" (${payerResolution.note})`
                );
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 13: SETTLEMENT AS EXPENSE
            // ─────────────────────────────────────────────────────────────────
            {
                const settlementKeywords = [
                    "paid back", "settled", "transfer",
                    "reimbursed", "clearing", "deposit share",
                ];
                const descLower = (row.description || "").toLowerCase();
                const isOnePerson = rawSplitNames.length === 1;
                const noSplitType = !(row.split_type || "").trim();

                if (
                    settlementKeywords.some((k) => descLower.includes(k)) ||
                    (isOnePerson && noSplitType)
                ) {
                    anomalies.push({
                        type: "SETTLEMENT_AS_EXPENSE",
                        message: "This looks like a payment between two people, not a shared expense.",
                        detail: { description: row.description, notes: row.notes },
                        options: ["import_as_settlement", "import_as_expense", "skip"],
                        defaultAction: "import_as_settlement",
                    });
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 14: INACTIVE MEMBER IN SPLIT
            // ─────────────────────────────────────────────────────────────────
            if (parsedDateResult) {
                const inactiveInSplit = [];
                for (const splitName of rawSplitNames) {
                    const splitRes = resolveName(splitName, knownUsers);
                    if (splitRes.status === "RESOLVED") {
                        const membership = memberships.find(
                            (ms) => ms.userId === splitRes.resolved.id
                        );
                        if (membership) {
                            const expDate = parsedDateResult.date;
                            const joined = new Date(membership.joinedAt);
                            const left = membership.leftAt ? new Date(membership.leftAt) : null;
                            const isActive =
                                joined <= expDate && (left === null || left >= expDate);
                            if (!isActive) {
                                inactiveInSplit.push(splitRes.resolved.name);
                            }
                        }
                    }
                }
                if (inactiveInSplit.length > 0) {
                    anomalies.push({
                        type: "INACTIVE_MEMBER_IN_SPLIT",
                        message: `These members were not active on this date: ${inactiveInSplit.join(", ")}`,
                        detail: {
                            inactiveMembers: inactiveInSplit,
                            expenseDate: parsedDateResult.date,
                        },
                        options: ["remove_inactive", "skip"],
                        defaultAction: "remove_inactive",
                    });
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 15: UNKNOWN MEMBER IN SPLIT
            // ─────────────────────────────────────────────────────────────────
            {
                const unknownInSplit = [];
                for (const splitName of rawSplitNames) {
                    const splitRes = resolveName(splitName, knownUsers);
                    if (splitRes.status === "UNKNOWN") {
                        unknownInSplit.push({ raw: splitName });
                    }
                }
                if (unknownInSplit.length > 0) {
                    anomalies.push({
                        type: "UNKNOWN_MEMBER_IN_SPLIT",
                        message: `Unknown members in split: ${unknownInSplit.map((u) => u.raw).join(", ")}`,
                        detail: { unknownMembers: unknownInSplit },
                        options: ["remove_from_split", "skip"],
                        defaultAction: "remove_from_split",
                    });
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 16: INVALID / NONSTANDARD SPLIT TYPE
            // ─────────────────────────────────────────────────────────────────
            if (rawSplitType && !normalizedSplitType) {
                anomalies.push({
                    type: "INVALID_SPLIT_TYPE",
                    message: `Split type "${row.split_type}" is not recognized.`,
                    detail: { raw: row.split_type },
                    options: ["skip"],
                    defaultAction: "skip",
                });
            } else if (rawSplitType && normalizedSplitType && rawSplitType !== normalizedSplitType.toLowerCase()) {
                autoNotes.push(`Split type "${row.split_type}" remapped to "${normalizedSplitType}"`);
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 17: PERCENTAGE SPLIT DOESN'T SUM TO 100
            // ─────────────────────────────────────────────────────────────────
            if (normalizedSplitType === "PERCENTAGE" && splitDetails) {
                const percentageMatches = splitDetails.match(/[\d.]+%/g) || [];
                const sum = percentageMatches.reduce(
                    (acc, p) => acc + parseFloat(p),
                    0
                );
                if (sum < 99.99 || sum > 100.01) {
                    anomalies.push({
                        type: "PERCENTAGE_SUM_INVALID",
                        message: `Percentages sum to ${sum.toFixed(1)}%, not 100%.`,
                        detail: { sum, splitDetails },
                        options: ["normalize_to_100", "skip"],
                        defaultAction: "normalize_to_100",
                    });
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 18: DUPLICATE — EXACT (same date + description + amount + payer)
            // ─────────────────────────────────────────────────────────────────
            if (
                parsedDateResult &&
                (payerResolution.status === "RESOLVED" || payerResolution.status === "SUGGESTED") &&
                !isNaN(parsedAmount)
            ) {
                const absAmount = Math.abs(parsedAmount);
                const effectiveRate = rawCurrency === "USD" ? usdRate : 1;
                const amountINR = Math.round(absAmount * effectiveRate * 100) / 100;
                const payerId =
                    payerResolution.status === "RESOLVED"
                        ? payerResolution.resolved.id
                        : payerResolution.suggestion.id;

                const hash = computeRowHash(
                    parsedDateResult.date.toISOString().split("T")[0],
                    row.description || "",
                    amountINR,
                    payerId
                );

                const inDB = existingHashSet.has(hash);
                const inBatch = batchHashes.has(hash);

                if (inDB || inBatch) {
                    anomalies.push({
                        type: "DUPLICATE_EXACT",
                        message: "This expense already exists (same date, description, amount, payer).",
                        detail: {
                            existsInDB: inDB,
                            existsInBatch: inBatch,
                            conflictingRow: batchHashes.get(hash),
                        },
                        options: ["import_anyway", "skip"],
                        defaultAction: "skip",
                    });
                } else {
                    batchHashes.set(hash, rowNumber);
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 19: SIMILAR DUPLICATE
            // Same date + similar description
            // ─────────────────────────────────────────────────────────────────
            if (parsedDateResult) {
                const dateStr = parsedDateResult.date.toISOString().split("T")[0];
                const desc = (row.description || "").toLowerCase().trim();

                for (const prev of batchDescriptions) {
                    if (prev.date !== dateStr) continue;
                    const distance = levenshtein(desc, prev.description);
                    
                    if (distance <= 3) {
                        const isNearExact = prev.amount === parsedAmount && prev.payer === (row.paid_by || "").trim();
                        
                        if (isNearExact) {
                            anomalies.push({
                                type: "DUPLICATE_NEAR_EXACT",
                                message: "This looks like a duplicate expense with a slightly different description.",
                                detail: {
                                    thisRow: { description: row.description, amount: parsedAmount, payer: row.paid_by },
                                    conflictingRow: prev,
                                },
                                options: ["skip", "import_anyway"],
                                defaultAction: "skip",
                            });
                        } else {
                            anomalies.push({
                                type: "CONFLICTING_DUPLICATE",
                                message: "Similar expense exists on the same date with different amount or payer.",
                                detail: {
                                    thisRow: { description: row.description, amount: parsedAmount, payer: row.paid_by },
                                    conflictingRow: prev,
                                },
                                options: ["import_this", "import_both", "skip_both"],
                                defaultAction: "import_this",
                            });
                        }
                        break; // report only the first conflict per row
                    }
                }

                batchDescriptions.push({
                    rowNumber,
                    date: dateStr,
                    description: desc,
                    amount: parsedAmount,
                    payer: (row.paid_by || "").trim(),
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 20: CONTRADICTORY SPLIT DATA — auto-resolve, just log
            // EQUAL + split_details provided → split_details are meaningless
            // ─────────────────────────────────────────────────────────────────
            if (normalizedSplitType === "EQUAL" && splitDetails) {
                autoNotes.push(
                    "split_type is EQUAL but split_details were provided — split_details ignored"
                );
            }

            // ── Build parsedData (best-guess resolved values for this row) ────
            const resolvedPayerId =
                payerResolution.status === "RESOLVED"
                    ? payerResolution.resolved.id
                    : payerResolution.status === "SUGGESTED"
                    ? payerResolution.suggestion.id
                    : unknownUser?.id || null;

            const resolvedSplits = rawSplitNames
                .map((name) => {
                    const r = resolveName(name, knownUsers);
                    const member =
                        r.status === "RESOLVED"
                            ? r.resolved
                            : r.status === "SUGGESTED"
                            ? r.suggestion
                            : null;
                    if (!member) return null;
                    return { userId: member.id, value: 0 };
                })
                .filter(Boolean);

            const parsedData = {
                description: (row.description || "").trim(),
                amount: Math.abs(isNaN(parsedAmount) ? 0 : parsedAmount),
                currency: rawCurrency || "INR",
                exchangeRate: rawCurrency === "USD" ? usdRate : 1,
                paidById: resolvedPayerId,
                paidByName: (row.paid_by || "").trim(),          // raw name for self-contained confirm
                splitWithNames: rawSplitNames,                   // raw names for self-contained confirm
                date: parsedDateResult?.date?.toISOString().split("T")[0] || null,
                splitType: normalizedSplitType || "EQUAL",
                splits: resolvedSplits,
                splitDetails,
                notes: row.notes || "",
                isRefund: !isNaN(parsedAmount) && parsedAmount < 0,
            };

            // ── Categorize row ─────────────────────────────────────────────────
            if (anomalies.length === 0) {
                cleanRows.push({ rowNumber, parsedData, autoNotes });
            } else {
                flaggedRows.push({ rowNumber, rawData: row, parsedData, anomalies, autoNotes });
            }
        }

        // ── Build autoDecisions — seeder-like defaults for ALL rows ──────────
        // Clean rows are always 'import'; flagged rows use computeAutoDecision().
        const autoDecisions = [
            ...cleanRows.map((row) => ({
                rowNumber: row.rowNumber,
                action: "import",
                resolvedData: row.parsedData,
            })),
            ...flaggedRows.map((row) => computeAutoDecision(row, knownUsers)),
        ];

        // Sort by rowNumber so /confirm receives them in CSV order
        autoDecisions.sort((a, b) => a.rowNumber - b.rowNumber);

        // ── Return preview response ───────────────────────────────────────────
        return res.status(200).json({
            sessionId: crypto.randomUUID(),
            totalRows: rows.length,
            cleanRows,
            flaggedRows,
            autoDecisions,
            nameResolution: {
                autoResolved: Object.entries(nameResolutionMap)
                    .filter(([, r]) => r.status === "RESOLVED" && r.note)
                    .map(([raw, r]) => ({
                        raw,
                        resolvedTo: r.resolved.name,
                        reason: r.note,
                    })),
                needsConfirmation: Object.entries(nameResolutionMap)
                    .filter(([, r]) => r.status === "SUGGESTED")
                    .map(([raw, r]) => ({
                        raw,
                        suggestion: r.suggestion,
                        distance: r.distance,
                    })),
                unknown: Object.entries(nameResolutionMap)
                    .filter(([, r]) => r.status === "UNKNOWN")
                    .map(([raw]) => ({ raw })),
                willBeCreatedAsGuest: namesToCreate,
            },
            memberLeftDateSuggestions,
            usdRateUsed: usdRate,
        });
    } catch (err) {
        console.error("[POST /:groupId/preview]", err);
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE 2: POST /api/import/:groupId/confirm
//
// Body: {
//   sessionId: string,          // UUID returned by /preview
//   decisions: [{
//     rowNumber: number,
//     action:   string,          // e.g. 'import', 'skip', 'import_as_settlement', …
//     resolvedData: {
//       description, amount, currency, exchangeRate,
//       paidById, date, splitType,
//       splits: [{ userId, value }],
//       notes, isRefund
//     }
//   }]
// }
//
// Processes each decision sequentially and writes to DB.
// Returns a summary: { imported, importedAsSettlements, skipped, errored, errors }
// ─────────────────────────────────────────────────────────────────────────────

router.post("/:groupId/confirm", async (req, res) => {
    try {
        const { groupId } = req.params;
        const { sessionId, decisions } = req.body;

        if (!sessionId || !Array.isArray(decisions)) {
            return res.status(400).json({
                error: "Body must contain sessionId (string) and decisions (array).",
            });
        }

        const results = {
            imported: 0,
            importedAsSettlements: 0,
            skipped: 0,
            errored: 0,
            errors: [],
            createdUsers: [],
        };

        // Fetch unknownUser as a fallback payer when paidById is still null
        const unknownUser = await prisma.user.findFirst({
            where: { email: "unknown@splitwise.local" },
        });

        // ─────────────────────────────────────────────────────────────────────
        // PHASE 1 — Collect all raw names + the dates they appear on
        // across every non-skip decision so we can infer membership joinedAt.
        // ─────────────────────────────────────────────────────────────────────
        const nameDateMap = {};  // { lowerCaseName: [dateStrings] }
        const rawNames = new Set();
        // Maps alias name (lower) → already-resolved userId.
        // Populated when paidById is set alongside paidByName so Phase 2 can
        // use the real user record instead of creating a ghost for the alias.
        const resolvedPayerMap = {};  // { lowerCaseName: userId }

        for (const decision of decisions) {
            if (decision.action === "skip" || decision.action === "skip_both") continue;
            const d = decision.resolvedData;
            if (!d) continue;

            const dateStr = d.date || null;

            // Collect payer name
            // Always collect paidByName for membership-date tracking.
            // When paidById is already resolved (e.g. via UNKNOWN_PAYER_SUGGESTION
            // → use_suggestion), we record the alias → resolvedId mapping so
            // Phase 2 can use the real user instead of creating a ghost.
            if (d.paidByName) {
                const key = d.paidByName.trim().toLowerCase();
                if (key) {
                    rawNames.add(d.paidByName.trim());
                    if (!nameDateMap[key]) nameDateMap[key] = [];
                    if (dateStr) nameDateMap[key].push(dateStr);
                    // Track alias → resolved user ID so Phase 2 skips ghost creation
                    if (d.paidById) {
                        resolvedPayerMap[key] = d.paidById;
                    }
                }
            }

            // Collect split member names
            if (Array.isArray(d.splitWithNames)) {
                for (const n of d.splitWithNames) {
                    const key = n.trim().toLowerCase();
                    if (!key) continue;
                    rawNames.add(n.trim());
                    if (!nameDateMap[key]) nameDateMap[key] = [];
                    if (dateStr) nameDateMap[key].push(dateStr);
                }
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // PHASE 2 — Resolve each name: find existing user OR create guest user,
        // then ensure a group membership exists.
        // ─────────────────────────────────────────────────────────────────────
        const guestPasswordHash = await bcrypt.hash("guest-placeholder", 10);

        for (const rawName of rawNames) {
            const key = rawName.toLowerCase();

            // Skip the "unknown" sentinel — it's handled by unknownUser
            if (key === "unknown" || key === "unknown user") continue;

            // 1a. If this name is an alias for an already-resolved user (e.g. "Priya S"
            //     was resolved to Priya via UNKNOWN_PAYER_SUGGESTION), fetch by ID.
            //     This avoids spawning a ghost user for the alias.
            let user = null;
            if (resolvedPayerMap[key]) {
                user = await prisma.user.findUnique({ where: { id: resolvedPayerMap[key] } });
            }

            // 1b. Fall back to case-insensitive name search
            if (!user) {
                user = await prisma.user.findFirst({
                    where: { name: { equals: rawName, mode: "insensitive" } },
                });
            }

            // 2. If not found, create a new guest user
            if (!user) {
                const guestEmail = `${rawName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${crypto.randomBytes(3).toString("hex")}@splitwise.local`;
                user = await prisma.user.create({
                    data: {
                        name: rawName,
                        email: guestEmail,
                        passwordHash: guestPasswordHash,
                        isGuest: true,
                    },
                });
                results.createdUsers.push({ name: user.name, id: user.id, email: user.email });
                console.log(`[confirm] created guest user: ${user.name} (${user.email})`);
            }

            // 3. Upsert membership — skip if any row already exists for this user+group
            const existingMembership = await prisma.groupMembership.findFirst({
                where: { groupId, userId: user.id },
            });

            if (!existingMembership) {
                // Infer joinedAt from the earliest date this name appears in decisions
                const dates = (nameDateMap[key] || [])
                    .map((ds) => new Date(ds))
                    .filter((d) => !isNaN(d.getTime()))
                    .sort((a, b) => a - b);
                const joinedAt = dates.length > 0 ? dates[0] : new Date();

                await prisma.groupMembership.create({
                    data: { userId: user.id, groupId, joinedAt },
                });
                console.log(`[confirm] created membership for ${user.name} in group ${groupId} (joinedAt: ${joinedAt.toISOString().split("T")[0]})`);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // PHASE 3 — Process decisions (memberships now guaranteed to exist)
        // ─────────────────────────────────────────────────────────────────────

        // ── Process decisions sequentially ────────────────────────────────────
        for (const decision of decisions) {

            const { rowNumber, action, resolvedData: data } = decision;

            try {
                // ── SKIP ───────────────────────────────────────────────────────
                if (action === "skip" || action === "skip_both") {
                    await prisma.importLog.create({
                        data: {
                            groupId,
                            sessionId,
                            rowNumber,
                            rawData: JSON.stringify(data || {}),
                            anomalyType: "USER_SKIPPED",
                            actionTaken: "SKIP",
                            status: "SKIPPED",
                        },
                    });
                    results.skipped++;
                    continue;
                }

                // ── IMPORT AS SETTLEMENT ───────────────────────────────────────
                if (action === "import_as_settlement") {
                    // ── Resolve payee: prefer splits[0], fall back to splitWithNames ──
                    // When the preview couldn't resolve a split member into splits[]
                    // (e.g. settlement row with unresolved payee name), we look up
                    // the first splitWithNames entry directly — matches seeder behaviour
                    // of using split_with[0] as the payee.
                    let settlementPayeeId = data.splits?.[0]?.userId || null;

                    if (!settlementPayeeId && Array.isArray(data.splitWithNames) && data.splitWithNames.length > 0) {
                        const payeeName = data.splitWithNames[0];
                        const payeeUser = await prisma.user.findFirst({
                            where: { name: { equals: payeeName, mode: "insensitive" } },
                        });
                        settlementPayeeId = payeeUser?.id || null;
                    }

                    if (!settlementPayeeId) {
                        throw new Error(
                            `Row ${rowNumber}: import_as_settlement — could not resolve a payee from splits or splitWithNames.`
                        );
                    }

                    const settlementPayerId   = data.paidById;

                    // ── Guard: payer must be a real (non-unknown) user ─────────
                    // Matches seeder: `payer.id !== unknownUser.id`
                    if (!settlementPayerId || settlementPayerId === unknownUser?.id) {
                        throw new Error(
                            `Row ${rowNumber}: settlement skipped — payer is unknown/unresolved.`
                        );
                    }

                    // ── Guard: payer and payee must be different people ─────────
                    // Matches seeder: `payer.id !== payee.id`
                    if (settlementPayerId === settlementPayeeId) {
                        throw new Error(
                            `Row ${rowNumber}: settlement skipped — payer and payee are the same person.`
                        );
                    }

                    // ── Use INR-converted amount (matches seeder amountINR) ─────
                    // Seeder multiplies by exRate before storing; raw data.amount
                    // is in the original currency, so apply exchangeRate here too.
                    const settlementExRate = Number(data.exchangeRate) || 1;
                    const settlementAmountINR =
                        Math.round(Math.abs(Number(data.amount)) * settlementExRate * 100) / 100;

                    await prisma.settlement.create({
                        data: {
                            groupId,
                            payerId: settlementPayerId,
                            payeeId: settlementPayeeId,
                            amount: new Prisma.Decimal(settlementAmountINR),
                            date: new Date(data.date),
                            notes: data.notes || null,
                        },
                    });

                    await prisma.importLog.create({
                        data: {
                            groupId,
                            sessionId,
                            rowNumber,
                            rawData: JSON.stringify(data),
                            actionTaken: "IMPORT_AS_SETTLEMENT",
                            status: "IMPORTED_AS_SETTLEMENT",
                        },
                    });

                    results.importedAsSettlements++;
                    continue;
                }

                // ── DEFAULT: IMPORT AS EXPENSE ────────────────────────────────
                // Handles: 'import', 'import_as_refund', 'import_this', 'import_both',
                //          'import_anyway', 'import_as_expense', 'use_suggestion',
                //          'use_dd_mm', 'use_mm_dd', 'assume_inr', 'apply_rate',
                //          'normalize_to_100', 'remove_inactive', 'remove_from_split',
                //          'assign_to_<userId>', etc.

                console.log(
                    `[confirm] row ${rowNumber}: action=${action} ` +
                    `paidById=${data?.paidById} date=${data?.date} ` +
                    `splitType=${data?.splitType} splits=${JSON.stringify(data?.splits)}`
                );

                // Guard: payer must be resolved
                const paidById = data.paidById || unknownUser?.id;
                if (!paidById) {
                    throw new Error(
                        `Row ${rowNumber}: paidById is null. The payer name could not be matched ` +
                        `to a group member. Check the 'paid_by' column and ensure the user is a member.`
                    );
                }

                // Guard: date must be parseable
                if (!data.date) {
                    throw new Error(`Row ${rowNumber}: date is null/invalid — cannot persist.`);
                }

                const exchangeRate = Number(data.exchangeRate) || 1;
                const rawAmount = Math.abs(Number(data.amount));
                const amountINR = Math.round(rawAmount * exchangeRate * 100) / 100;

                const splitType = data.splitType || "EQUAL";

                // Resolve splits input — parse splitDetails into actual values
                // for EXACT / PERCENTAGE / RATIO when the preview left them as 0.
                let splitsInput = Array.isArray(data.splits) ? data.splits : [];

                if (splitType === "EQUAL") {
                    // Sentinel: resolved inside the transaction against active membership
                    splitsInput = null;
                } else {
                    // Check if all split values are zero (preview placeholder)
                    const allZero =
                        splitsInput.length > 0 &&
                        splitsInput.every((s) => (s.value || 0) === 0);

                    if (allZero && data.splitDetails) {
                        // ── Parse splitDetails into numeric values ──────────────
                        // Builds a userId → value map from the raw split_details string.
                        // Supports: "Rohan 700; Priya 400" (EXACT)
                        //           "Aisha 30%; Rohan 30%" (PERCENTAGE, % stripped)
                        //           "Rohan 2; Priya 1; Dev 2" (RATIO)
                        //
                        // We resolve each name against the system-wide users list so
                        // we can match back to the userIds stored in splits[].userId.
                        const detailEntries = data.splitDetails
                            .split(";")
                            .map((s) => s.trim())
                            .filter(Boolean);

                        // Build a system-wide name → userId cache for this row
                        const allUsersForRow = await prisma.user.findMany({
                            where: { id: { in: splitsInput.map((s) => s.userId) } },
                            select: { id: true, name: true },
                        });
                        const nameToId = {};
                        for (const u of allUsersForRow) {
                            nameToId[u.name.toLowerCase()] = u.id;
                        }

                        const valueMap = {}; // userId → numeric value
                        for (const entry of detailEntries) {
                            // Match patterns like: "Rohan 700", "Rohan 30%", "Rohan 2"
                            const m = entry.match(/^(.+?)\s+([\d.]+)%?\s*$/);
                            if (!m) continue;
                            const entryName = m[1].trim().toLowerCase();
                            const entryValue = parseFloat(m[2]);
                            if (isNaN(entryValue)) continue;

                            // Find the userId for this name (exact or case-insensitive)
                            const uid = nameToId[entryName];
                            if (uid) valueMap[uid] = entryValue;
                        }

                        // Apply parsed values to the splits array
                        const patchedSplits = splitsInput
                            .map((s) => ({
                                userId: s.userId,
                                value: valueMap[s.userId] ?? 0,
                            }))
                            .filter((s) => s.value > 0); // keep only members with a value

                        if (patchedSplits.length > 0 && patchedSplits.every((s) => s.value > 0)) {
                            splitsInput = patchedSplits;
                        } else {
                            // Could not parse details — fall back to EQUAL
                            console.warn(
                                `[confirm] row ${rowNumber}: could not parse splitDetails for ${splitType}, falling back to EQUAL`
                            );
                            splitsInput = null;
                        }
                    } else if (allZero) {
                        // No splitDetails available — fall back to EQUAL
                        console.warn(
                            `[confirm] row ${rowNumber}: all split values are 0 for ${splitType} and no splitDetails, falling back to EQUAL`
                        );
                        splitsInput = null;
                    }
                }

                // Compute dedup hash
                const hash = computeRowHash(data.date, data.description, amountINR, paidById);

                // Currency enum guard
                const currencyValue = ["INR", "USD", "EUR", "GBP"].includes(
                    (data.currency || "").toUpperCase()
                )
                    ? data.currency.toUpperCase()
                    : "INR";

                // Persist expense + splits in one transaction
                await prisma.$transaction(async (tx) => {
                    let finalSplitsInput = splitsInput;

                    if (finalSplitsInput === null) {
                        // Resolve active members on the expense date inside the tx
                        const activeMembers = await getActiveMembersOnDate(
                            groupId,
                            new Date(data.date),
                            tx
                        );
                        if (activeMembers.length === 0) {
                            throw new Error(
                                `Row ${rowNumber}: no active members found on ${data.date}. ` +
                                `Check membership join/leave dates for group ${groupId}.`
                            );
                        }
                        finalSplitsInput = activeMembers.map((m) => ({
                            userId: m.userId,
                            value: 0,
                        }));
                    }

                    const effectiveSplitType = splitsInput === null ? "EQUAL" : splitType;
                    const finalSplits = calculateSplits(
                        effectiveSplitType,
                        amountINR,
                        finalSplitsInput
                    );

                    if (finalSplits.length === 0) {
                        throw new Error(
                            `Row ${rowNumber}: calculateSplits returned empty array for splitType=${effectiveSplitType}.`
                        );
                    }

                    const expense = await tx.expense.create({
                        data: {
                            groupId,
                            description: String(data.description || "").trim(),
                            amount: new Prisma.Decimal(data.isRefund ? -rawAmount : rawAmount),
                            currency: currencyValue,
                            exchangeRate: new Prisma.Decimal(exchangeRate),
                            amountInr: new Prisma.Decimal(data.isRefund ? -amountINR : amountINR),
                            paidById,
                            date: new Date(data.date),
                            splitType: effectiveSplitType,
                            isRefund: data.isRefund || false,
                            isSettlement: false,
                            notes: data.notes || null,
                            importedRowHash: hash,
                        },
                    });

                    await tx.expenseSplit.createMany({
                        data: finalSplits.map((s) => ({
                            expenseId: expense.id,
                            userId: s.userId,
                            amountOwed: new Prisma.Decimal(s.amountOwed),
                        })),
                    });
                });

                await prisma.importLog.create({
                    data: {
                        groupId,
                        sessionId,
                        rowNumber,
                        rawData: JSON.stringify(data),
                        actionTaken: action.toUpperCase().slice(0, 50), // VarChar(50) cap
                        status: "IMPORTED",
                    },
                });

                results.imported++;
            } catch (err) {
                console.error(`[confirm] row ${rowNumber} failed:`, err.message);

                // Best-effort log — don't let a logging failure mask the real error
                try {
                    await prisma.importLog.create({
                        data: {
                            groupId,
                            sessionId,
                            rowNumber,
                            rawData: JSON.stringify(data || {}),
                            anomalyType: "IMPORT_ERROR",
                            actionTaken: "ERROR",
                            status: "ERRORED",
                        },
                    });
                } catch (logErr) {
                    console.error(
                        `[confirm] importLog write failed for row ${rowNumber}:`,
                        logErr.message
                    );
                }

                results.errored++;
                results.errors.push({ rowNumber, reason: err.message });
            }
        }

        // ── Respond ───────────────────────────────────────────────────────────
        return res.status(200).json({
            sessionId,
            imported: results.imported,
            importedAsSettlements: results.importedAsSettlements,
            skipped: results.skipped,
            errored: results.errored,
            errors: results.errors,
            createdUsers: results.createdUsers,
            totalProcessed: decisions.length,
        });
    } catch (err) {
        console.error("[POST /:groupId/confirm]", err);
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// ROUTE 3: GET /api/import/:groupId/report
//
// Generates and returns a CSV report of the import logs for the current group.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:groupId/report", async (req, res) => {
    try {
        const { groupId } = req.params;
        const { sessionId } = req.query;

        // Build where clause — filter by sessionId if provided, otherwise all logs for the group
        const where = sessionId
            ? { sessionId }
            : { groupId };

        // Fetch logs
        const logs = await prisma.importLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
        });

        if (!logs || logs.length === 0) {
            return res.status(404).json({ error: "No import logs found for this group." });
        }

        // Generate CSV
        const headers = ["ID", "Session ID", "Row Number", "Anomaly Type", "Action Taken", "Status", "Created At", "Raw Data"];
        const rows = logs.map(log => [
            log.id,
            log.sessionId,
            log.rowNumber !== null ? log.rowNumber : "",
            log.anomalyType || "",
            log.actionTaken || "",
            log.status,
            log.createdAt.toISOString(),
            log.rawData ? log.rawData.replace(/"/g, '""') : "" // Escape quotes in JSON
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map(row => row.map(v => `"${v}"`).join(","))
        ].join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="import_report_${groupId}.csv"`);
        return res.status(200).send(csvContent);
    } catch (err) {
        console.error("[GET /:groupId/report]", err);
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /:groupId/direct
//
// "Seeder-mode" import. Runs the exact same CSV processing pipeline as
// seed.js (via the shared csvImporter library) in a single API call.
// No preview / confirm round-trips needed.
//
// Request: multipart/form-data  { file: <csv> }
// Response: { imported, settlements, skipped, excluded, errored, errors, log }
// ─────────────────────────────────────────────────────────────────────────────

const { processCsvBuffer } = require("../lib/csvImporter");

router.post("/:groupId/direct", upload.single("file"), async (req, res) => {
    const { groupId } = req.params;

    if (!req.file) {
        return res.status(400).json({ error: "No CSV file uploaded." });
    }

    try {
        const result = await processCsvBuffer({
            csvBuffer: req.file.buffer,
            groupId,
            prisma,
        });

        return res.status(200).json({
            sessionId:            null,
            imported:             result.imported,
            importedAsSettlements: result.settlements,
            skipped:              result.skipped,
            excluded:             result.excluded,
            errored:              result.errored,
            errors:               result.errors,
            log:                  result.log,
            totalProcessed:       result.imported + result.skipped + result.excluded + result.errored,
        });
    } catch (err) {
        console.error("[POST /:groupId/direct]", err);
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
});

module.exports = router;
