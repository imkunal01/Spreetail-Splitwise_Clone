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
const { Prisma } = require("@prisma/client");
const crypto = require("crypto");
const axios = require("axios");

const router = Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage() });

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: parseDate
// Tries multiple date formats in order, returns { date: Date, format: String }
// or null if nothing matched / resulted in an invalid date.
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_MAP = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(str) {
    if (!str || typeof str !== "string") return null;
    const s = str.trim();

    // ── DD-MM-YYYY ─────────────────────────────────────────────────────────
    {
        const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) {
            const [, dd, mm, yyyy] = m;
            const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
            if (!isNaN(date.getTime())) {
                return { date, format: "DD-MM-YYYY" };
            }
        }
    }

    // ── YYYY-MM-DD (ISO) ───────────────────────────────────────────────────
    {
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
            const [, yyyy, mm, dd] = m;
            const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
            if (!isNaN(date.getTime())) {
                return { date, format: "YYYY-MM-DD" };
            }
        }
    }

    // ── DD/MM/YYYY ─────────────────────────────────────────────────────────
    {
        const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
            const [, dd, mm, yyyy] = m;
            const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
            if (!isNaN(date.getTime())) {
                return { date, format: "DD/MM/YYYY" };
            }
        }
    }

    // ── "Mar-14" style (no year) ───────────────────────────────────────────
    {
        const m = s.match(/^([A-Za-z]{3})-(\d{1,2})$/);
        if (m) {
            const [, mon, day] = m;
            const monthIndex = MONTH_MAP[mon.toLowerCase()];
            if (monthIndex !== undefined) {
                const currentYear = new Date().getFullYear();
                const date = new Date(Date.UTC(currentYear, monthIndex, +day));
                if (!isNaN(date.getTime())) {
                    return { date, format: "MON-DD", assumedYear: currentYear };
                }
            }
        }
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: isAmbiguousDate
// Returns { ambiguous: true, ddmm: Date, mmdd: Date } when both interpretations
// of a DD-MM-YYYY string are calendar-valid (i.e. day <= 12 AND month <= 12).
// ─────────────────────────────────────────────────────────────────────────────

function isAmbiguousDate(str) {
    if (!str || typeof str !== "string") return { ambiguous: false };
    const m = str.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return { ambiguous: false };

    const [, p1, p2, yyyy] = m;
    const d1 = +p1;
    const d2 = +p2;

    // Ambiguous only when both values fit either position (1–12 each)
    if (d1 > 12 || d2 > 12) return { ambiguous: false };

    const ddmm = new Date(Date.UTC(+yyyy, d2 - 1, d1)); // p1=day, p2=month
    const mmdd = new Date(Date.UTC(+yyyy, d1 - 1, d2)); // p1=month, p2=day

    if (isNaN(ddmm.getTime()) || isNaN(mmdd.getTime())) return { ambiguous: false };

    return { ambiguous: true, ddmm, mmdd };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: levenshtein
// Iterative DP Levenshtein distance between two strings.
// ─────────────────────────────────────────────────────────────────────────────

function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    // prev[j] = edit distance between a[0..i-1] and b[0..j-1]
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
// HELPER: resolveMemberName
// Tries exact match, then fuzzy (Levenshtein <= 2).
// Returns { found, suggestion, distance }
// ─────────────────────────────────────────────────────────────────────────────

function resolveMemberName(rawName, groupMembers) {
    const normalizedRaw = rawName.trim().toLowerCase();

    // ── 1. Exact match (case-insensitive) ──────────────────────────────────
    const exact = groupMembers.find(
        (m) => m.name.toLowerCase() === normalizedRaw
    );
    if (exact) return { found: exact, suggestion: null, distance: 0 };

    // ── 2. Fuzzy match (Levenshtein <= 2) ──────────────────────────────────
    let bestMember = null;
    let bestDist = Infinity;

    for (const member of groupMembers) {
        const dist = levenshtein(normalizedRaw, member.name.toLowerCase());
        if (dist <= 2 && dist < bestDist) {
            bestDist = dist;
            bestMember = member;
        }
    }

    if (bestMember) {
        return { found: null, suggestion: bestMember, distance: bestDist };
    }

    return { found: null, suggestion: null, distance: Infinity };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: fetchUsdRate
// Fetches live USD→INR rate from Frankfurter API; falls back to 83.50.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchUsdRate() {
    try {
        const response = await axios.get(
            "https://api.frankfurter.app/latest?from=USD&to=INR",
            { timeout: 3000 }
        );
        return response.data.rates.INR;
    } catch {
        return 83.50;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: getActiveMembersOnDate
// Shared with expenses.js — returns memberships active on a given date.
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
// HELPER: parseSplitDetails
// Parses "Rohan 700; Priya 400" or "Aisha 1; Rohan 2" into
// [{ name, value }] pairs.
// ─────────────────────────────────────────────────────────────────────────────

function parseSplitDetails(raw) {
    if (!raw || !raw.trim()) return [];
    return raw
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            // Last token is the number; everything before is the name
            const tokens = part.trim().split(/\s+/);
            const value = parseFloat(tokens[tokens.length - 1]);
            const name = tokens.slice(0, tokens.length - 1).join(" ");
            return { name: name.trim(), value: isNaN(value) ? 0 : value };
        });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: normalizeSplitType
// Maps CSV split_type labels to internal enum values.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeSplitType(raw) {
    if (!raw) return raw;
    switch (raw.toLowerCase().trim()) {
        case "unequal":    return "EXACT";
        case "share":      return "RATIO";
        case "equal":      return "EQUAL";
        case "percentage": return "PERCENTAGE";
        default:           return raw;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE 1: POST /api/import/:groupId/preview
// Parses the CSV, runs all 15 anomaly checks, and returns clean + flagged rows.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/:groupId/preview", upload.single("file"), async (req, res) => {
    try {
        // ── Guard: file must exist ────────────────────────────────────────────
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded. Send a multipart/form-data request with field 'file'." });
        }

        // ── 1. Parse CSV ──────────────────────────────────────────────────────
        const rows = parse(req.file.buffer, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
        });

        // ── 2 + 3 + 4. Run DB queries and external rate fetch in parallel ────
        // IMPORTANT: do NOT await these sequentially. fetchUsdRate() calls
        // api.frankfurter.app (European server) which can take 5–15 s from India.
        // Awaiting it AFTER the DB queries leaves Supabase connections idle long
        // enough for the server to terminate them ("Connection terminated
        // unexpectedly"). Promise.all fires everything concurrently so DB
        // connections are acquired AND released in ~100 ms regardless of how
        // long the external HTTP call takes.
        const [memberships, existingHashes, usdRate] = await Promise.all([
            // 2. Group members
            prisma.groupMembership.findMany({
                where: { groupId: req.params.groupId },
                include: { user: { select: { id: true, name: true, email: true } } },
            }),
            // 3. Existing import hashes (dedup against DB)
            prisma.expense.findMany({
                where: {
                    groupId: req.params.groupId,
                    importedRowHash: { not: null },
                },
                select: { importedRowHash: true },
            }),
            // 4. Live USD→INR rate (falls back to 83.50 on timeout/error)
            fetchUsdRate(),
        ]);

        const groupMembers = memberships.map((m) => m.user);
        const hashSet = new Set(existingHashes.map((e) => e.importedRowHash));

        // ── 5. Process rows ───────────────────────────────────────────────────
        const cleanRows = [];
        const flaggedRows = [];

        // Track hashes seen within this CSV batch (for intra-batch dedup)
        const batchHashes = new Map(); // hash → rowNumber

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNumber = i + 2; // row 1 = header

            const anomalies = [];
            const parsedData = {};

            // ── PRE-PROCESSING ───────────────────────────────────────────────

            // (a) Strip commas from amount
            const rawAmount = (row.amount || "").replace(/,/g, "");
            const parsedAmount = parseFloat(rawAmount);

            // (b) Resolve payer
            const resolvedPayer = row.paid_by?.trim()
                ? resolveMemberName(row.paid_by, groupMembers)
                : { found: null, suggestion: null, distance: Infinity };

            // (c) Normalize split_type
            const normalizedSplitType = normalizeSplitType(row.split_type);

            // (d) Parse split_with names
            const names = (row.split_with || "")
                .split(";")
                .map((n) => n.trim())
                .filter(Boolean);

            // (e) Parse split_details
            const parsedSplitDetails = parseSplitDetails(row.split_details);

            // (f) Parse date
            const parsedDate = parseDate(row.date);
            const ambiguityCheck = isAmbiguousDate(row.date);

            // ── CHECK 1: MISSING_REQUIRED_FIELD ─────────────────────────────
            {
                const emptyFields = [];
                if (!row.description?.trim()) emptyFields.push("description");
                if (isNaN(parsedAmount))       emptyFields.push("amount");
                if (!row.split_with?.trim())   emptyFields.push("split_with");

                if (emptyFields.length > 0) {
                    anomalies.push({
                        type: "MISSING_REQUIRED_FIELD",
                        message: "Required field is empty (description, amount, or split_with)",
                        detail: { emptyFields },
                        options: ["skip"],
                        defaultAction: "skip",
                    });
                }
            }

            // ── CHECK 2: ZERO_AMOUNT ─────────────────────────────────────────
            if (parsedAmount === 0) {
                anomalies.push({
                    type: "ZERO_AMOUNT",
                    message: "Amount is zero. This row appears to be a void or placeholder.",
                    detail: { originalAmount: row.amount },
                    options: ["skip"],
                    defaultAction: "skip",
                });
            }

            // ── CHECK 3: NEGATIVE_AMOUNT ─────────────────────────────────────
            if (!isNaN(parsedAmount) && parsedAmount < 0) {
                anomalies.push({
                    type: "NEGATIVE_AMOUNT",
                    message: `Negative amount detected (${parsedAmount}). Could be a refund.`,
                    detail: { amount: parsedAmount, notes: row.notes },
                    options: ["import_as_refund", "skip"],
                    defaultAction: "import_as_refund",
                });
            }

            // ── CHECK 4: UNPARSEABLE_DATE / ASSUMED_YEAR ─────────────────────
            if (!parsedDate) {
                anomalies.push({
                    type: "UNPARSEABLE_DATE",
                    message: `Cannot parse date "${row.date}". Please provide the correct date.`,
                    detail: { originalDate: row.date },
                    options: ["skip"],
                    defaultAction: "skip",
                });
            } else if (parsedDate.assumedYear) {
                anomalies.push({
                    type: "ASSUMED_DATE_YEAR",
                    message: `Date "${row.date}" had no year. Assumed ${parsedDate.assumedYear}.`,
                    detail: { parsedAs: parsedDate.date, assumedYear: parsedDate.assumedYear },
                    options: ["import", "skip"],
                    defaultAction: "import",
                });
            }

            // ── CHECK 5: AMBIGUOUS_DATE ──────────────────────────────────────
            if (parsedDate && ambiguityCheck.ambiguous) {
                anomalies.push({
                    type: "AMBIGUOUS_DATE",
                    message: `Date "${row.date}" is ambiguous (DD-MM or MM-DD?).`,
                    detail: {
                        interpretationA: { label: "DD-MM (default)", date: ambiguityCheck.ddmm },
                        interpretationB: { label: "MM-DD", date: ambiguityCheck.mmdd },
                        csvNote: row.notes,
                    },
                    options: ["use_dd_mm", "use_mm_dd", "skip"],
                    defaultAction: "use_dd_mm",
                });
            }

            // ── CHECK 6: MISSING_CURRENCY ─────────────────────────────────────
            if (!row.currency?.trim()) {
                anomalies.push({
                    type: "MISSING_CURRENCY",
                    message: "Currency field is empty.",
                    detail: { notes: row.notes },
                    options: ["assume_inr", "skip"],
                    defaultAction: "assume_inr",
                });
            }

            // ── CHECK 7: USD_NO_EXCHANGE_RATE ────────────────────────────────
            if (row.currency?.toUpperCase() === "USD") {
                anomalies.push({
                    type: "USD_NO_EXCHANGE_RATE",
                    message: "Amount is in USD but no exchange rate is in the CSV.",
                    detail: {
                        usdAmount: parsedAmount,
                        suggestedRate: usdRate,
                        inrEquivalent: Math.round(parsedAmount * usdRate * 100) / 100,
                    },
                    options: ["apply_rate", "skip"],
                    defaultAction: "apply_rate",
                });
            }

            // ── CHECK 8: UNKNOWN_PAYER ───────────────────────────────────────
            if (row.paid_by?.trim() && !resolvedPayer.found) {
                if (resolvedPayer.suggestion) {
                    anomalies.push({
                        type: "UNKNOWN_PAYER",
                        message: `Payer "${row.paid_by}" not found. Did you mean "${resolvedPayer.suggestion.name}"?`,
                        detail: {
                            original: row.paid_by,
                            suggestion: resolvedPayer.suggestion,
                            distance: resolvedPayer.distance,
                        },
                        options: ["use_suggestion", "skip"],
                        defaultAction: "use_suggestion",
                    });
                } else {
                    anomalies.push({
                        type: "UNKNOWN_PAYER",
                        message: `Payer "${row.paid_by}" not found and no close match exists.`,
                        detail: { original: row.paid_by },
                        options: ["skip"],
                        defaultAction: "skip",
                    });
                }
            }

            // ── CHECK 9: MISSING_PAYER ───────────────────────────────────────
            if (!row.paid_by?.trim()) {
                anomalies.push({
                    type: "MISSING_PAYER",
                    message: "No payer specified. Who paid for this expense?",
                    detail: {
                        availableMembers: groupMembers.map((m) => ({ id: m.id, name: m.name })),
                    },
                    options: [
                        "skip",
                        ...groupMembers.map((m) => `assign_to_${m.id}`),
                    ],
                    defaultAction: "skip",
                });
            }

            // ── CHECK 10: SETTLEMENT_AS_EXPENSE ──────────────────────────────
            {
                const settlementKeywords = [
                    "paid back", "settled", "transfer",
                    "reimbursed", "clearing", "deposit share",
                ];
                const descLower = row.description?.toLowerCase() || "";
                const isOnePersonSplit = names.length === 1;
                const hasEmptySplitType = !row.split_type?.trim();

                const looksLikeSettlement =
                    settlementKeywords.some((k) => descLower.includes(k)) ||
                    (isOnePersonSplit && hasEmptySplitType);

                if (looksLikeSettlement) {
                    anomalies.push({
                        type: "SETTLEMENT_AS_EXPENSE",
                        message:
                            "This row looks like a payment/settlement between two people, not a shared expense.",
                        detail: { description: row.description, notes: row.notes },
                        options: ["import_as_settlement", "import_as_expense", "skip"],
                        defaultAction: "import_as_settlement",
                    });
                }
            }

            // ── CHECK 11: INACTIVE_MEMBER_IN_SPLIT ───────────────────────────
            if (parsedDate) {
                const inactiveMembers = [];

                for (const name of names) {
                    const resolved = resolveMemberName(name, groupMembers);
                    if (!resolved.found) continue;

                    const membership = memberships.find(
                        (ms) => ms.userId === resolved.found.id
                    );
                    if (!membership) continue;

                    const joinedAt = new Date(membership.joinedAt);
                    const leftAt = membership.leftAt ? new Date(membership.leftAt) : null;
                    const expDate = parsedDate.date;

                    const isActive =
                        joinedAt <= expDate && (leftAt === null || leftAt >= expDate);

                    if (!isActive) {
                        inactiveMembers.push(resolved.found.name);
                    }
                }

                if (inactiveMembers.length > 0) {
                    anomalies.push({
                        type: "INACTIVE_MEMBER_IN_SPLIT",
                        message: `These members were not active on ${parsedDate.date.toISOString().split("T")[0]}: ${inactiveMembers.join(", ")}`,
                        detail: { inactiveMembers, expenseDate: parsedDate.date },
                        options: ["remove_inactive", "skip"],
                        defaultAction: "remove_inactive",
                    });
                }
            }

            // ── CHECK 12: UNKNOWN_MEMBER_IN_SPLIT ────────────────────────────
            {
                const unknownMembers = [];
                const typoSuggestions = []; // not raised as separate anomaly — folded into UNKNOWN_PAYER style

                for (const name of names) {
                    const resolved = resolveMemberName(name, groupMembers);
                    if (!resolved.found && !resolved.suggestion) {
                        unknownMembers.push(name);
                    }
                    // fuzzy typos in split_with are noted but not raised as a
                    // separate anomaly — they will be accounted for in resolvedData
                }

                if (unknownMembers.length > 0) {
                    anomalies.push({
                        type: "UNKNOWN_MEMBER_IN_SPLIT",
                        message: `Unknown members in split: ${unknownMembers.join(", ")}`,
                        detail: {
                            unknownMembers,
                            note: "These people have no account. Create guest user or remove from split.",
                        },
                        options: ["create_guest_user", "remove_from_split", "skip"],
                        defaultAction: "remove_from_split",
                    });
                }
            }

            // ── CHECK 13: DUPLICATE_EXACT ─────────────────────────────────────
            if (parsedDate && resolvedPayer.found) {
                const dateStr = parsedDate.date.toISOString().split("T")[0];
                const hash = computeRowHash(
                    dateStr,
                    row.description,
                    parsedAmount,
                    resolvedPayer.found.id
                );
                parsedData._hash = hash; // store for later use in confirm

                const inDB = hashSet.has(hash);
                const inBatch = batchHashes.has(hash);

                if (inDB || inBatch) {
                    anomalies.push({
                        type: "DUPLICATE_EXACT",
                        message:
                            "This expense appears to already exist (same date, description, amount, and payer).",
                        detail: { hash, source: inDB ? "database" : "current_csv" },
                        options: ["import_anyway", "skip"],
                        defaultAction: "skip",
                    });
                } else {
                    // Register hash for intra-batch dedup of later rows
                    batchHashes.set(hash, rowNumber);
                }
            }

            // ── CHECK 14: CONFLICTING_DUPLICATE ──────────────────────────────
            if (parsedDate) {
                const dateStr = parsedDate.date.toISOString().split("T")[0];
                let conflictFound = false;

                for (let j = 0; j < rows.length; j++) {
                    if (j === i) continue;
                    const other = rows[j];
                    const otherDate = parseDate(other.date);
                    if (!otherDate) continue;

                    const otherDateStr = otherDate.date.toISOString().split("T")[0];
                    if (otherDateStr !== dateStr) continue;

                    const descDist = levenshtein(
                        (row.description || "").toLowerCase(),
                        (other.description || "").toLowerCase()
                    );
                    if (descDist > 3) continue;

                    // Same date + similar description — check for diverging amount/payer
                    const otherAmountRaw = (other.amount || "").replace(/,/g, "");
                    const otherAmount = parseFloat(otherAmountRaw);
                    const differentAmount = Math.abs(parsedAmount - otherAmount) > 0.01;
                    const differentPayer =
                        (row.paid_by || "").trim().toLowerCase() !==
                        (other.paid_by || "").trim().toLowerCase();

                    if (differentAmount || differentPayer) {
                        anomalies.push({
                            type: "CONFLICTING_DUPLICATE",
                            message:
                                "Another row has the same date and similar description but different amount or payer.",
                            detail: {
                                conflictingRow: other,
                                conflictingRowNumber: j + 2,
                            },
                            options: ["import_this", "import_other", "import_both", "skip_both"],
                            defaultAction: "import_this",
                        });
                        conflictFound = true;
                        break; // report only the first conflict
                    }
                }
            }

            // ── CHECK 15: PERCENTAGE_SUM_INVALID ─────────────────────────────
            if (normalizedSplitType === "PERCENTAGE" && parsedSplitDetails.length > 0) {
                const sum = parsedSplitDetails.reduce((acc, d) => acc + d.value, 0);
                const roundedSum = Math.round(sum * 100) / 100;
                if (roundedSum < 99.99 || roundedSum > 100.01) {
                    anomalies.push({
                        type: "PERCENTAGE_SUM_INVALID",
                        message: `Percentages sum to ${roundedSum}%, not 100%.`,
                        detail: { sum: roundedSum, members: parsedSplitDetails },
                        options: ["normalize_to_100", "skip"],
                        defaultAction: "normalize_to_100",
                    });
                }
            }

            // ── BUILD parsedData (best-guess resolved values) ─────────────────
            const resolvedPayerId = resolvedPayer.found
                ? resolvedPayer.found.id
                : resolvedPayer.suggestion?.id || null;

            const resolvedSplits = names
                .map((name) => {
                    const r = resolveMemberName(name, groupMembers);
                    const member = r.found || r.suggestion;
                    if (!member) return null;
                    // Find matching split_detail value if present
                    const detail = parsedSplitDetails.find(
                        (d) => d.name.toLowerCase() === name.toLowerCase()
                    );
                    return {
                        userId: member.id,
                        value: detail ? detail.value : 0,
                    };
                })
                .filter(Boolean);

            Object.assign(parsedData, {
                date: parsedDate ? parsedDate.date : null,
                description: row.description?.trim() || "",
                amount: parsedAmount,
                currency: row.currency?.toUpperCase() || "INR",
                exchangeRate: row.currency?.toUpperCase() === "USD" ? usdRate : 1,
                paidById: resolvedPayerId,
                splitType: normalizedSplitType || "EQUAL",
                splits: resolvedSplits,
                notes: row.notes || null,
                isRefund: parsedAmount < 0,
            });

            // ── ROUTE ROW ─────────────────────────────────────────────────────
            if (anomalies.length === 0) {
                cleanRows.push({ rowNumber, parsedData, notes: [] });
            } else {
                flaggedRows.push({ rowNumber, rawData: row, parsedData, anomalies });
            }
        }

        // ── 6. Respond ────────────────────────────────────────────────────────
        return res.status(200).json({
            sessionId: crypto.randomUUID(),
            totalRows: rows.length,
            cleanRows,
            flaggedRows,
        });
    } catch (err) {
        console.error("[POST /:groupId/preview]", err);
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE 2: POST /api/import/:groupId/confirm
// Processes user-resolved decisions and writes expenses / settlements to DB.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/:groupId/confirm", async (req, res) => {
    try {
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
        };

        // Process decisions sequentially — order matters for idempotency
        for (const decision of decisions) {
            const { rowNumber, action, resolvedData: data } = decision;

            try {
                // ── SKIP ───────────────────────────────────────────────────────
                if (action === "skip" || action === "skip_both") {
                    await prisma.importLog.create({
                        data: {
                            sessionId,
                            rowNumber,
                            rawData: JSON.stringify(data),
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
                            groupId: req.params.groupId,
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
                // Covers: 'import', 'import_as_refund', 'import_this', 'import_both',
                //         'import_anyway', 'use_suggestion', 'use_dd_mm', 'use_mm_dd',
                //         'assume_inr', 'apply_rate', 'normalize_to_100', 'remove_inactive',
                //         'remove_from_split', 'assign_to_<userId>', etc.

                console.log(`[confirm] row ${rowNumber}: action=${action} paidById=${data?.paidById} date=${data?.date} splitType=${data?.splitType} splits=${JSON.stringify(data?.splits)}`);

                // Guard: payer must be resolved — a null paidById violates the DB NOT NULL constraint
                if (!data.paidById) {
                    throw new Error(
                        `Row ${rowNumber}: paidById is null. The payer name could not be matched to a group member. ` +
                        `Check the 'paid_by' column value and ensure the user is a member of this group.`
                    );
                }

                // Guard: date must be parseable
                if (!data.date) {
                    throw new Error(`Row ${rowNumber}: date is null/invalid — cannot persist.`);
                }

                const exchangeRate = Number(data.exchangeRate) || 1;
                const rawAmount = Math.abs(Number(data.amount)); // abs for refunds
                const amountINR =
                    Math.round(rawAmount * exchangeRate * 100) / 100;

                // Resolve splits input
                let splitsInput = Array.isArray(data.splits) ? data.splits : [];

                const splitType = data.splitType || "EQUAL";

                if (splitType === "EQUAL") {
                    // For EQUAL, use active members on the expense date (run inside tx later)
                    splitsInput = null; // sentinel — resolved inside the transaction
                } else {
                    // For RATIO/PERCENTAGE/EXACT: if all values are 0 (name matching failed
                    // during preview), fall back to EQUAL so the row isn't silently errored.
                    const allZero = splitsInput.length > 0 && splitsInput.every((s) => s.value === 0);
                    if (allZero) {
                        console.warn(`[confirm] row ${rowNumber}: all split values are 0 for ${splitType}, falling back to EQUAL`);
                        splitsInput = null; // will resolve via getActiveMembersOnDate in tx
                    }
                }

                // Compute dedup hash
                const hash = computeRowHash(data.date, data.description, amountINR, data.paidById);

                // Persist expense + splits in a single transaction
                await prisma.$transaction(async (tx) => {
                    // Resolve EQUAL (and fallback) splits inside the tx so the query
                    // participates in the same connection lifecycle
                    let finalSplitsInput = splitsInput;
                    if (finalSplitsInput === null) {
                        const activeMembers = await getActiveMembersOnDate(
                            req.params.groupId,
                            new Date(data.date),
                            tx
                        );
                        if (activeMembers.length === 0) {
                            throw new Error(
                                `Row ${rowNumber}: no active members found on ${data.date}. ` +
                                `Check membership join/leave dates for group ${req.params.groupId}.`
                            );
                        }
                        finalSplitsInput = activeMembers.map((m) => ({ userId: m.userId, value: 0 }));
                    }

                    // Compute final split amounts
                    const effectiveSplitType = splitsInput === null ? "EQUAL" : (data.splitType || "EQUAL");
                    const finalSplits = calculateSplits(effectiveSplitType, amountINR, finalSplitsInput);

                    if (finalSplits.length === 0) {
                        throw new Error(`Row ${rowNumber}: calculateSplits returned empty array for splitType=${effectiveSplitType}.`);
                    }
                    const expense = await tx.expense.create({
                        data: {
                            groupId: req.params.groupId,
                            description: String(data.description || "").trim(),
                            amount: new Prisma.Decimal(rawAmount),
                            currency: (["INR", "USD", "EUR", "GBP"].includes((data.currency || "").toUpperCase())
                                ? data.currency.toUpperCase()
                                : "INR"
                            ),
                            exchangeRate: new Prisma.Decimal(exchangeRate),
                            amountInr: new Prisma.Decimal(amountINR),
                            paidById: data.paidById,
                            date: new Date(data.date),
                            splitType: effectiveSplitType,
                            isRefund: data.isRefund || false,
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

                // Best-effort log — don't let a log failure mask the real error
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
                    console.error(`[confirm] importLog write failed for row ${rowNumber}:`, logErr.message);
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
            totalProcessed: decisions.length,
        });
    } catch (err) {
        console.error("[POST /:groupId/confirm]", err);
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
});

module.exports = router;
