"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// csvImporter.js
//
// Shared CSV processing pipeline — extracted from seed.js so that both the
// seed script and the /import/:groupId/direct API endpoint run exactly the
// same logic and produce identical results.
//
// Usage:
//   const { processCsvBuffer } = require('./csvImporter');
//   const result = await processCsvBuffer({ csvBuffer, groupId, prisma });
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");
const { parse } = require("csv-parse/sync");
const { Prisma } = require("@prisma/client");

// ─── Constants ────────────────────────────────────────────────────────────────

const USD_TO_INR = 85;
const MONTH_MAP = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

const SPLIT_TYPE_MAP = {
    equal: "EQUAL", unequal: "EXACT", exact: "EXACT",
    percentage: "PERCENTAGE", share: "RATIO", ratio: "RATIO",
};

// Keywords that indicate a row is a settlement (money transfer between members)
const SETTLE_KEYWORDS = ["paid back", "settled", "transfer", "reimbursed", "clearing", "deposit share", "deposit"];

// These are EXCLUDED entirely — not imported as expense OR settlement.
const EXCLUDE_KEYWORDS = [];

// External (non-member) participants that appear in split_with.
// Their equal share is computed but removed from group splits.
const KNOWN_EXTERNALS = ["dev's friend kabir", "kabir"];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function roundCurrency(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseDate(str) {
    if (!str) return null;
    const s = str.trim();

    // DD-MM-YYYY
    let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (m) { const d = new Date(Date.UTC(+m[3], +m[2]-1, +m[1])); return isNaN(d) ? null : d; }

    // YYYY-MM-DD
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) { const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3])); return isNaN(d) ? null : d; }

    // DD/MM/YYYY
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) { const d = new Date(Date.UTC(+m[3], +m[2]-1, +m[1])); return isNaN(d) ? null : d; }

    // MMM-DD  (e.g. "Mar-14")
    m = s.match(/^([A-Za-z]{3})-(\d{1,2})$/);
    if (m) {
        const idx = MONTH_MAP[m[1].toLowerCase()];
        if (idx !== undefined) {
            const d = new Date(Date.UTC(2026, idx, +m[2]));
            return isNaN(d) ? null : d;
        }
    }
    return null;
}

function rowHash(dateStr, description, amountINR, payerId) {
    const input = `${dateStr}|${String(description).toLowerCase().trim()}|${amountINR}|${payerId}`;
    return crypto.createHash("md5").update(input).digest("hex");
}

// Normalise a description for near-duplicate detection:
// strips punctuation/case/extra-whitespace so "Dinner at Marina Bites" and
// "dinner - marina bites" both normalise to "dinner marina bites".
function normalizeDesc(description) {
    return String(description)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Build a levenshtein-based user resolver from a list of { id, name } users.
function buildResolver(users) {
    return function resolveUser(rawName) {
        if (!rawName) return null;
        const n = rawName.trim().toLowerCase();

        // Exact match
        for (const u of users) {
            if (u.name.toLowerCase() === n) return u;
        }
        // Starts-with (e.g. "Priya S" → "Priya")
        for (const u of users) {
            const low = u.name.toLowerCase();
            if (n.startsWith(low + " ") || n.startsWith(low + ".")) return u;
        }
        // Levenshtein ≤ 2
        let best = null, bestDist = Infinity;
        for (const u of users) {
            const a = u.name.toLowerCase(), b = n;
            const mat = Array.from({ length: b.length + 1 }, (_, i) => [i]);
            for (let j = 0; j <= a.length; j++) mat[0][j] = j;
            for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                    mat[i][j] = b[i-1] === a[j-1]
                        ? mat[i-1][j-1]
                        : Math.min(mat[i-1][j]+1, mat[i][j-1]+1, mat[i-1][j-1]+1);
                }
            }
            const d = mat[b.length][a.length];
            if (d <= 2 && d < bestDist) { bestDist = d; best = u; }
        }
        return best;
    };
}

// Split calculation matching seed.js computeSplits
function floorSplits(rawShares, total, userIds) {
    const floored = rawShares.map(v => Math.floor(v * 100) / 100);
    const floorSum = floored.reduce((a, b) => a + b, 0);
    const rem = Math.round((total - floorSum) * 100) / 100;
    floored[floored.length - 1] = Math.round((floored[floored.length - 1] + rem) * 100) / 100;
    return userIds.map((uid, i) => ({ userId: uid, amountOwed: floored[i] }));
}

function computeSplits(splitType, amountINR, members) {
    const ids = members.map(m => m.userId);
    let shares;
    switch (splitType) {
        case "EQUAL":      shares = members.map(() => amountINR / members.length); break;
        case "EXACT":      shares = members.map(m => m.value); break;
        case "PERCENTAGE": shares = members.map(m => (m.value / 100) * amountINR); break;
        case "RATIO": {
            const total = members.reduce((s, m) => s + m.value, 0);
            shares = members.map(m => (m.value / total) * amountINR);
            break;
        }
        default: throw new Error(`Unknown splitType: ${splitType}`);
    }
    return floorSplits(shares, amountINR, ids);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Process a raw CSV buffer and write expenses/settlements to the database.
 *
 * @param {object}  opts
 * @param {Buffer}  opts.csvBuffer   - Raw CSV file content
 * @param {string}  opts.groupId     - Target group ID
 * @param {object}  opts.prisma      - Prisma client instance
 *
 * @returns {Promise<{imported, settlements, skipped, excluded, errored, errors, log}>}
 */
async function processCsvBuffer({ csvBuffer, groupId, prisma }) {
    // Generate a unique session ID for this import run (used by the report endpoint)
    const sessionId = crypto.randomUUID();
    // ── Load group + memberships ──────────────────────────────────────────────
    const group = await prisma.group.findUnique({
        where: { id: groupId },
        include: {
            memberships: {
                include: { user: { select: { id: true, name: true, email: true } } },
            },
        },
    });
    if (!group) throw new Error(`Group ${groupId} not found`);

    // Build membership windows for active-member-on-date lookups
    const memberships = group.memberships.map(m => ({
        userId:   m.user.id,
        name:     m.user.name,
        joinedAt: m.joinedAt,
        leftAt:   m.leftAt,
    }));

    // Build system-wide user list for name resolution
    const allUsers = await prisma.user.findMany({
        where: { isGuest: false },
        select: { id: true, name: true, email: true },
    });
    const resolveUser = buildResolver(allUsers);

    function activeMembersOn(date) {
        return memberships.filter(m => {
            const joined = new Date(m.joinedAt);
            const left   = m.leftAt ? new Date(m.leftAt) : null;
            return joined <= date && (left === null || left >= date);
        });
    }

    function isActiveMemberOn(userId, date) {
        const m = memberships.find(mm => mm.userId === userId);
        if (!m) return false;
        const joined = new Date(m.joinedAt);
        const left   = m.leftAt ? new Date(m.leftAt) : null;
        return joined <= date && (left === null || left >= date);
    }

    // ── Parse CSV ─────────────────────────────────────────────────────────────
    const rows = parse(csvBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: false,
    });

    // ── Existing hash set for idempotency ─────────────────────────────────────
    const existingHashes = new Set(
        (await prisma.expense.findMany({
            where: { groupId, importedRowHash: { not: null } },
            select: { importedRowHash: true },
        })).map(e => e.importedRowHash)
    );

    const seenDescSignatures = new Set();
    let imported = 0, skipped = 0, errored = 0, settlements = 0, excluded = 0;
    const errors = [];
    const log = [];

    const ok  = msg => log.push({ type: "ok",   msg });
    const wrn = msg => log.push({ type: "warn",  msg });
    const err = msg => log.push({ type: "error", msg });

    // Helper: write a row's outcome to import_logs
    async function writeLog({ rowNumber, rawData, anomalyType, actionTaken, status }) {
        try {
            await prisma.importLog.create({
                data: {
                    sessionId,
                    rowNumber,
                    rawData:     JSON.stringify(rawData),
                    anomalyType: anomalyType || null,
                    actionTaken: actionTaken || null,
                    status,
                },
            });
        } catch (_) { /* non-critical — don't let log errors break the import */ }
    }

    // ── Process rows ──────────────────────────────────────────────────────────
    for (let i = 0; i < rows.length; i++) {
        const row    = rows[i];
        const rowNum = i + 2; // 1-indexed + header

        try {
            // ── Date ────────────────────────────────────────────────────────
            const expDate = parseDate((row.date || "").trim());
            if (!expDate) {
                wrn(`Row ${rowNum}: unparseable date "${row.date}" — skipped`);
                await writeLog({ rowNumber: rowNum, rawData: row, anomalyType: "UNPARSEABLE_DATE", actionTaken: "SKIP", status: "SKIPPED" });
                skipped++; continue;
            }

            // ── Amount ──────────────────────────────────────────────────────
            const rawAmt = parseFloat((row.amount || "").replace(/,/g, ""));
            if (isNaN(rawAmt) || rawAmt === 0) {
                wrn(`Row ${rowNum}: zero/invalid amount — skipped`);
                await writeLog({ rowNumber: rowNum, rawData: row, anomalyType: "ZERO_AMOUNT", actionTaken: "SKIP", status: "SKIPPED" });
                skipped++; continue;
            }

            const rawCcy    = (row.currency || "INR").trim().toUpperCase();
            const currency  = ["INR","USD","EUR","GBP"].includes(rawCcy) ? rawCcy : "INR";
            const exRate    = currency === "USD" ? USD_TO_INR : 1;
            const absAmt    = Math.abs(rawAmt);
            const amountINR = roundCurrency(absAmt * exRate);
            const isRefund  = rawAmt < 0;

            // ── Description ─────────────────────────────────────────────────
            const description = (row.description || "").trim();
            if (!description) { wrn(`Row ${rowNum}: no description — skipped`); skipped++; continue; }

            // ── Payer ───────────────────────────────────────────────────────
            const rawPayer = (row.paid_by || "").trim();
            if (!rawPayer) {
                wrn(`Row ${rowNum}: missing payer — excluded ("${description}")`);
                await writeLog({ rowNumber: rowNum, rawData: row, anomalyType: "MISSING_PAYER", actionTaken: "SKIP", status: "SKIPPED" });
                excluded++; continue;
            }
            const payer = resolveUser(rawPayer);
            if (!payer) {
                wrn(`Row ${rowNum}: payer "${rawPayer}" cannot be resolved — skipped`);
                await writeLog({ rowNumber: rowNum, rawData: row, anomalyType: "UNKNOWN_PAYER", actionTaken: "SKIP", status: "SKIPPED" });
                skipped++; continue;
            }

            // ── Exclude direct transfers ─────────────────────────────────────
            const descLowerEarly = description.toLowerCase();
            if (EXCLUDE_KEYWORDS.some(k => descLowerEarly.includes(k))) {
                ok(`Row ${rowNum}: "${description}" — direct transfer, excluded from balances`);
                await writeLog({ rowNumber: rowNum, rawData: row, actionTaken: "SKIP", status: "SKIPPED" });
                excluded++;
                continue;
            }

            // ── Dedup (exact hash) ───────────────────────────────────────────
            const dateStr = expDate.toISOString().split("T")[0];
            const hash    = rowHash(dateStr, description, amountINR, payer.id);
            if (existingHashes.has(hash)) {
                wrn(`Row ${rowNum}: already imported — skipped`);
                await writeLog({ rowNumber: rowNum, rawData: row, anomalyType: "DUPLICATE_EXACT", actionTaken: "SKIP", status: "SKIPPED" });
                skipped++; continue;
            }

            // ── Dedup (near-duplicate description) ───────────────────────────
            const descSig = `${dateStr}|${payer.id}|${amountINR}|${normalizeDesc(description)}`;
            if (seenDescSignatures.has(descSig)) {
                wrn(`Row ${rowNum}: near-duplicate of an earlier row ("${description}") — skipped`);
                await writeLog({ rowNumber: rowNum, rawData: row, anomalyType: "DUPLICATE_NEAR_EXACT", actionTaken: "SKIP", status: "SKIPPED" });
                skipped++;
                continue;
            }

            // ── Settlement detection ─────────────────────────────────────────
            const descLower  = description.toLowerCase();
            const splitNames = (row.split_with || "").split(";").map(n => n.trim()).filter(Boolean);
            const isSettlement = SETTLE_KEYWORDS.some(k => descLower.includes(k)) ||
                (splitNames.length === 1 && !(row.split_type || "").trim());

            if (isSettlement && splitNames.length >= 1) {
                const payee = resolveUser(splitNames[0]);
                if (payee && payer.id !== payee.id) {
                    // Ensure both users are members of the group
                    const payerIsMember = memberships.some(m => m.userId === payer.id);
                    const payeeIsMember = memberships.some(m => m.userId === payee.id);
                    if (payerIsMember && payeeIsMember) {
                        await prisma.settlement.create({
                            data: {
                                groupId,
                                payerId:  payer.id,
                                payeeId:  payee.id,
                                amount:   new Prisma.Decimal(amountINR),
                                date:     expDate,
                                notes:    row.notes || null,
                            },
                        });
                        ok(`Row ${rowNum}: settlement  ${payer.name} → ${payee.name}  ₹${amountINR}`);
                        await writeLog({ rowNumber: rowNum, rawData: row, actionTaken: "IMPORT_AS_SETTLEMENT", status: "IMPORTED" });
                        existingHashes.add(hash);
                        seenDescSignatures.add(descSig);
                        imported++;
                        settlements++;
                        continue;
                    }
                }
            }

            // From here on: this row produces an Expense.
            existingHashes.add(hash);
            seenDescSignatures.add(descSig);

            // ── Split type + details ─────────────────────────────────────────
            const rawSplitType = (row.split_type || "equal").trim().toLowerCase();
            const splitType    = SPLIT_TYPE_MAP[rawSplitType] || "EQUAL";
            const splitDetails = (row.split_details || "").trim();

            // ── Separate externals from member splits ────────────────────────
            const externalNamesInSplit = splitNames.filter(n => KNOWN_EXTERNALS.includes(n.trim().toLowerCase()));
            const memberSplitNames     = splitNames.filter(n => !KNOWN_EXTERNALS.includes(n.trim().toLowerCase()));
            const numExternals         = externalNamesInSplit.length;

            // ── Resolve split members ────────────────────────────────────────
            let splitsInput       = [];
            let externalShareINR  = 0;

            if (splitType === "EQUAL") {
                let resolved;
                let totalParticipants;
                if (memberSplitNames.length > 0 || numExternals > 0) {
                    resolved          = memberSplitNames.map(n => resolveUser(n)).filter(Boolean);
                    totalParticipants = resolved.length + numExternals;
                } else {
                    const active      = activeMembersOn(expDate);
                    resolved          = active.map(m => allUsers.find(u => u.id === m.userId)).filter(Boolean);
                    totalParticipants = resolved.length;
                }

                // Drop members whose membership ended before this expense
                const beforeCount = resolved.length;
                resolved = resolved.filter(u => isActiveMemberOn(u.id, expDate));
                if (resolved.length !== beforeCount) {
                    wrn(`Row ${rowNum}: removed inactive member(s) from split per membership dates`);
                    totalParticipants = resolved.length + numExternals;
                }

                if (numExternals > 0) {
                    const perHead       = roundCurrency(amountINR / totalParticipants);
                    externalShareINR    = roundCurrency(perHead * numExternals);
                    ok(`Row ${rowNum}: external participant(s) [${externalNamesInSplit.join(", ")}] — ` +
                       `₹${externalShareINR} excluded from group split (collected by ${payer.name} directly)`);
                    const amountForGroup   = roundCurrency(amountINR - externalShareINR);
                    splitsInput            = resolved.map(u => ({ userId: u.id, value: 0 }));
                    splitsInput._amountOverride = amountForGroup;
                } else {
                    splitsInput = resolved.map(u => ({ userId: u.id, value: 0 }));
                }

            } else if (splitType === "EXACT") {
                for (const part of splitDetails.split(";").map(s => s.trim()).filter(Boolean)) {
                    const m = part.match(/^(.+?)\s+([\d.]+)$/);
                    if (m) {
                        const u = resolveUser(m[1].trim());
                        if (u) splitsInput.push({ userId: u.id, value: parseFloat(m[2]) });
                    }
                }
                if (splitsInput.length === 0)
                    splitsInput = activeMembersOn(expDate).map(m => ({ userId: m.userId, value: 0 }));

            } else if (splitType === "PERCENTAGE") {
                for (const part of splitDetails.split(";").map(s => s.trim()).filter(Boolean)) {
                    const m = part.match(/^(.+?)\s+([\d.]+)%$/);
                    if (m) {
                        const u = resolveUser(m[1].trim());
                        if (u) splitsInput.push({ userId: u.id, value: parseFloat(m[2]) });
                    }
                }
                // Normalise percentages if they don't sum to 100
                const pSum = splitsInput.reduce((s, x) => s + x.value, 0);
                if (pSum > 0 && Math.abs(pSum - 100) > 0.1)
                    splitsInput = splitsInput.map(x => ({ ...x, value: (x.value / pSum) * 100 }));
                if (splitsInput.length === 0)
                    splitsInput = activeMembersOn(expDate).map(m => ({ userId: m.userId, value: 0 }));

            } else if (splitType === "RATIO") {
                for (const part of splitDetails.split(";").map(s => s.trim()).filter(Boolean)) {
                    const m = part.match(/^(.+?)\s+([\d.]+)$/);
                    if (m) {
                        const u = resolveUser(m[1].trim());
                        if (u) splitsInput.push({ userId: u.id, value: parseFloat(m[2]) });
                    }
                }
                if (splitsInput.length === 0)
                    splitsInput = activeMembersOn(expDate).map(m => ({ userId: m.userId, value: 1 }));
            }

            if (splitsInput.length === 0) {
                wrn(`Row ${rowNum}: no split members resolved — skipped`);
                await writeLog({ rowNumber: rowNum, rawData: row, actionTaken: "SKIP", status: "SKIPPED" });
                skipped++;
                continue;
            }

            // ── Compute per-person amounts ────────────────────────────────────
            const effectiveSplitType = (splitType === "EXACT" && splitsInput.every(s => s.value === 0))
                ? "EQUAL" : splitType;
            const splitAmount   = splitsInput._amountOverride !== undefined
                ? splitsInput._amountOverride : amountINR;
            const finalSplits   = computeSplits(effectiveSplitType, splitAmount, splitsInput);

            // ── Persist expense + splits ─────────────────────────────────────
            await prisma.$transaction(async tx => {
                const expense = await tx.expense.create({
                    data: {
                        groupId,
                        description,
                        amount:      new Prisma.Decimal(isRefund ? -absAmt : absAmt),
                        currency,
                        exchangeRate: new Prisma.Decimal(exRate),
                        amountInr:   new Prisma.Decimal(isRefund ? -amountINR : amountINR),
                        paidById:    payer.id,
                        date:        expDate,
                        splitType:   effectiveSplitType,
                        isRefund,
                        isSettlement: false,
                        notes: row.notes
                            ? (externalShareINR
                                ? `${row.notes} [₹${externalShareINR} of this expense is owed by an external participant (${externalNamesInSplit.join(", ")}), collected directly by ${payer.name} and excluded from group balances]`
                                : row.notes)
                            : (externalShareINR
                                ? `₹${externalShareINR} of this expense is owed by an external participant (${externalNamesInSplit.join(", ")}), collected directly by ${payer.name} and excluded from group balances`
                                : null),
                        importedRowHash: hash,
                    },
                });

                await tx.expenseSplit.createMany({
                    data: finalSplits.map(s => ({
                        expenseId:  expense.id,
                        userId:     s.userId,
                        amountOwed: new Prisma.Decimal(s.amountOwed),
                    })),
                });
            });

            const refundTag = isRefund ? " [refund]" : "";
            ok(`Row ${rowNum}: ${description}  ₹${amountINR}  paid by ${payer.name}${refundTag}`);
            await writeLog({ rowNumber: rowNum, rawData: row, actionTaken: isRefund ? "IMPORT_AS_REFUND" : "IMPORT", status: "IMPORTED" });
            imported++;

        } catch (e) {
            err(`Row ${rowNum}: ${e.message}`);
            await writeLog({ rowNumber: rowNum, rawData: row, actionTaken: "ERROR", status: "ERROR" });
            errors.push({ rowNumber: rowNum, reason: e.message });
            errored++;
        }
    }

    return { sessionId, imported, settlements, skipped, excluded, errored, errors, log };
}

module.exports = { processCsvBuffer };
