"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

const { Router } = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");
const { parse } = require("csv-parse/sync");
const multer = require("multer");
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
// ROUTE 1: POST /api/import/:groupId/preview
//
// Accepts a multipart CSV upload, runs 20 anomaly checks on each row,
// and returns:
//   - cleanRows:   rows with no anomalies (ready to confirm as-is)
//   - flaggedRows: rows with one or more anomalies (require user decisions)
//   - nameResolution: summary of auto-resolved / needs-confirmation / unknown names
//   - memberLeftDateSuggestions: existing members who may have left
//   - usdRateUsed: the exchange rate that was applied for USD detection
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
        const [memberships, existingExpenses, usdRate] = await Promise.all([
            // B. Group members with isGuest flag
            prisma.groupMembership.findMany({
                where: { groupId },
                include: {
                    user: {
                        select: { id: true, name: true, email: true, isGuest: true },
                    },
                },
            }),
            // C. Existing import hashes for dedup
            prisma.expense.findMany({
                where: { groupId, importedRowHash: { not: null } },
                select: { importedRowHash: true },
            }),
            // D. Live USD→INR rate
            fetchUsdRate(),
        ]);

        const knownUsers = memberships.map((m) => m.user);
        const unknownUser = knownUsers.find((u) => u.email === "unknown@splitmate.local");
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
                    generatedEmail: `${raw.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${crypto.randomBytes(3).toString("hex")}@splitmate.local`,
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
                            .filter((u) => !u.isGuest || u.email === "unknown@splitmate.local")
                            .map((u) => ({ id: u.id, name: u.name })),
                        unknownUserId: unknownUser?.id,
                    },
                    options: [
                        "assign_to_unknown",
                        ...knownUsers
                            .filter((u) => u.email !== "unknown@splitmate.local")
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
            // CHECK 19: CONFLICTING DUPLICATE
            // Same date + similar description + different amount or payer
            // ─────────────────────────────────────────────────────────────────
            if (parsedDateResult) {
                const dateStr = parsedDateResult.date.toISOString().split("T")[0];
                const desc = (row.description || "").toLowerCase().trim();

                for (const prev of batchDescriptions) {
                    if (prev.date !== dateStr) continue;
                    const distance = levenshtein(desc, prev.description);
                    if (
                        distance <= 3 &&
                        (prev.amount !== parsedAmount || prev.payer !== (row.paid_by || "").trim())
                    ) {
                        anomalies.push({
                            type: "CONFLICTING_DUPLICATE",
                            message:
                                "Similar expense exists on the same date with different amount or payer.",
                            detail: {
                                thisRow: {
                                    description: row.description,
                                    amount: parsedAmount,
                                    payer: row.paid_by,
                                },
                                conflictingRow: prev,
                            },
                            options: ["import_this", "import_both", "skip_both"],
                            defaultAction: "import_this",
                        });
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

        // ── Return preview response ───────────────────────────────────────────
        return res.status(200).json({
            sessionId: crypto.randomUUID(),
            totalRows: rows.length,
            cleanRows,
            flaggedRows,
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
            where: { email: "unknown@splitmate.local" },
        });

        // ── Process decisions sequentially ────────────────────────────────────
        for (const decision of decisions) {
            const { rowNumber, action, resolvedData: data } = decision;

            try {
                // ── SKIP ───────────────────────────────────────────────────────
                if (action === "skip" || action === "skip_both") {
                    await prisma.importLog.create({
                        data: {
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
                    if (!data.splits || data.splits.length === 0) {
                        throw new Error(
                            "import_as_settlement requires at least one entry in splits (the payee)."
                        );
                    }

                    await prisma.settlement.create({
                        data: {
                            groupId,
                            payerId: data.paidById,
                            payeeId: data.splits[0].userId,
                            amount: new Prisma.Decimal(Math.abs(Number(data.amount))),
                            date: new Date(data.date),
                            notes: data.notes || null,
                        },
                    });

                    await prisma.importLog.create({
                        data: {
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

                // Resolve splits input
                let splitsInput = Array.isArray(data.splits) ? data.splits : [];

                if (splitType === "EQUAL") {
                    // Sentinel: resolved inside the transaction against active membership
                    splitsInput = null;
                } else {
                    // If all split values are 0 (name matching failed), fall back to EQUAL
                    const allZero =
                        splitsInput.length > 0 &&
                        splitsInput.every((s) => (s.value || 0) === 0);
                    if (allZero) {
                        console.warn(
                            `[confirm] row ${rowNumber}: all split values are 0 for ${splitType}, falling back to EQUAL`
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

module.exports = router;
