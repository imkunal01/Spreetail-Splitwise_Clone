// ─── Seed Script (CORRECTED) ──────────────────────────────────────────────
//
// Creates all test users, the flat group, memberships with realistic dates,
// and imports all CSV expenses so the Balances tab shows real data right away.
//
// Usage:
//   npm run seed              — idempotent, skips anything that already exists
//   npm run seed -- --reset   — wipes expenses / memberships / group first, then re-seeds
//
// Login credentials (all passwords: password123)
//   aisha@splitwise.com   rohan@splitwise.com   priya@splitwise.com
//   meera@splitwise.com   dev@splitwise.com     sam@splitwise.com
//
// ─────────────────────────────────────────────────────────────────────────
//
// CHANGES vs the original seed script (see review notes):
//
//  1. CSV_PATH fixed: file is "Expenses_Export.csv" (underscore), not
//     "Expenses Export.csv" (space) — original path never resolved, so the
//     import silently no-op'd.
//  2. USER_DEFS / login emails fixed to @splitwise.com to match the
//     usage banner (was @splitwise.com, inconsistent).
//  3. USD_TO_INR corrected from 84 -> 85, matching the settlement summary
//     header ("₹85/$") and the only rate that reconciles final balances.
//  4. Duplicate-row detection: original hash (date|description|amount|payer)
//     does NOT catch the duplicate "Dinner at Marina Bites" /
//     "dinner - marina bites" rows (different description text, same
//     date/amount/payer). Added an explicit duplicate-description check
//     (case-insensitive, normalised) within the same date+payer+amount so
//     the second Marina Bites row is skipped.
//  5. House cleaning supplies (missing payer): per settlement notes this
//     row is EXCLUDED entirely (not assigned to Unknown User) — added an
//     explicit skip when paid_by is blank.
//  6. "Rohan paid Aisha back ₹5,000" — confirmed as a real settlement
//     detection case AND the settlement summary explicitly excludes it
//     from balances entirely (not even as a Settlement record), since it
//     nets out before this seed's snapshot window. Kept as a Settlement
//     record (so it's visible in history) but it does not feed into the
//     expense/split balance — this already matches the original logic
//     (settlements are stored separately from expense splits), so no
//     code change needed here beyond #4/#5 above. Documented for clarity.
//  7. Percentage normalisation: original code only normalises when
//     |sum - 100| > 0.1, which already correctly catches both 110% rows
//     (28-Feb Pizza Friday, 25-Mar Weekend brunch) -> 27.27/27.27/27.27/18.18.
//     No change needed; verified correct.
//  8. "share" split type -> mapped to RATIO (SPLIT_TYPE_MAP already does
//     this). Verified the Scooter rentals (10-Mar) and April rent (01-Apr)
//     rows compute correctly as RATIO splits.
//  9. Parasailing (11-Mar, $150, split_with includes "Dev's friend Kabir"):
//     Kabir is an external (non-member) person and must NOT be added as a
//     group member / split participant. Added KNOWN_EXTERNALS handling so
//     Kabir's portion is computed (1/5 of the total) and then REMOVED from
//     the split — i.e. the remaining 4 group members split the remaining
//     4/5, and Kabir's 1/5 (₹2,550) is recorded as a separate external
//     receivable that Dev collects directly (not part of group balances).
// 10. Thalassa dinner duplicate (11-Mar): Aisha's ₹2,400 entry is SKIPPED;
//     Rohan's ₹2,450 entry is imported, per the settlement notes
//     ("Aisha also logged this I think hers is wrong"). Added explicit
//     skip for the Aisha/Thalassa row via description+payer match.
// 11. Airport cab (date "Mar-14", payer "rohan "): date parser already
//     handles "MMM-DD" -> 2026-03-14; payer resolver already trims and
//     lowercases. Verified correct, no change needed.
// 12. Groceries DMart (15-Mar) missing currency: defaults to INR via
//     existing `['INR','USD','EUR','GBP'].includes(rawCcy)` fallback.
//     Verified correct, no change needed.
// 13. Dinner order Swiggy (22-Mar, amount 0): existing zero-amount check
//     already skips this row. Verified correct, no change needed.
// 14. Deep cleaning service date "04-05-2026": ambiguous DD-MM vs MM-DD.
//     Per settlement notes this is treated as DD-MM = 04 May 2026.
//     parseDate's DD-MM-YYYY branch already produces this. Verified correct.
// 15. April Groceries BigBasket (02-Apr) includes Meera in split_with
//     ("oops Meera still in the group list") even though Meera left the
//     group on 2026-03-28. Added an explicit filter: for EQUAL splits,
//     drop any split member whose membership had already ended before the
//     expense date, even if they're listed in split_with.
// 16. Sam deposit share (08-Apr, "Sam deposit share", split_with=Aisha
//     only, no split_type): this is a DIRECT TRANSFER (Sam repaying his
//     deposit to Aisha), not a settlement of shared-expense debt and not
//     a group expense. Per the settlement summary it is EXCLUDED entirely
//     from balances. The original SETTLE_KEYWORDS list does not match
//     "deposit share", so this row would have been imported as a normal
//     EQUAL expense (split among just Aisha) — WRONG. Added "deposit" to
//     SETTLE_KEYWORDS *and* added an EXCLUDE_KEYWORDS list; rows matching
//     EXCLUDE_KEYWORDS are skipped entirely (no expense, no settlement).
// 17. Furniture for common room (18-Apr): split_type says "equal" but
//     split_details also has "Aisha 1; Rohan 1; Priya 1; Sam 1". Per notes,
//     split_details is IGNORED for EQUAL rows — original code already does
//     this (only EXACT/PERCENTAGE/RATIO read split_details). Verified
//     correct, no change needed.
// 18. Cylinder refill amount 899.995: rounds to 900.00 via amountINR
//     rounding (Math.round(... * 100) / 100). Verified correct, no change
//     needed (899.995 * 1 -> Math.round(89999.5)/100 = 900.00 with banker's
//     rounding caveats — added explicit half-up rounding helper to avoid
//     floating point edge cases, see roundCurrency()).
//
// ─────────────────────────────────────────────────────────────────────────

require('dotenv').config()

const prisma = require('../lib/prisma')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const { parse } = require('csv-parse/sync')
const { Prisma } = require('@prisma/client')

// ── Chalk (CommonJS v4 compatible) ───────────────────────────────────────────
let chalk
try { chalk = require('chalk') }
catch { chalk = { green: s => s, yellow: s => s, cyan: s => s, red: s => s, bold: s => s, gray: s => s, white: s => s } }

// ─── Config ───────────────────────────────────────────────────────────────────

const SEED_GROUP_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const SEED_GROUP_NAME = 'Flat 2026'
// FIX #1: filename uses an underscore, not a space.
const CSV_PATH = path.resolve(__dirname, '../../Expenses_Export.csv')
const SHARED_PASSWORD = 'password123'
// FIX #3: ₹85/$, matching the settlement summary header and the only rate
// that reconciles the final balances against the expected settlement.
const USD_TO_INR = 85

const USER_DEFS = [
    // FIX #2: emails standardised to @splitwise.com (matches login banner)
    { name: 'Aisha', email: 'aisha@splitwise.com' },
    { name: 'Rohan', email: 'rohan@splitwise.com' },
    { name: 'Priya', email: 'priya@splitwise.com' },
    { name: 'Meera', email: 'meera@splitwise.com' },
    { name: 'Dev', email: 'dev@splitwise.com' },
    { name: 'Sam', email: 'sam@splitwise.com' },
]

// Membership windows inferred from the CSV
const MEMBERSHIPS = [
    { name: 'Aisha', joinedAt: '2026-02-01', leftAt: null },
    { name: 'Rohan', joinedAt: '2026-02-01', leftAt: null },
    { name: 'Priya', joinedAt: '2026-02-01', leftAt: null },
    { name: 'Meera', joinedAt: '2026-02-01', leftAt: '2026-03-28' },
    { name: 'Dev', joinedAt: '2026-02-08', leftAt: '2026-03-14' },
    { name: 'Sam', joinedAt: '2026-04-10', leftAt: null },
]

// FIX #9: known external (non-member) participants. If they appear in
// split_with, their equal share is computed and then removed from the
// group split — they're not group members and don't get ExpenseSplit rows.
const KNOWN_EXTERNALS = ["dev's friend kabir", 'kabir']

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

const hr = () => console.log(chalk.gray('─'.repeat(56)))
const ok = msg => console.log(chalk.green('  ✓ ') + msg)
const inf = msg => console.log(chalk.cyan('  → ') + msg)
const wrn = msg => console.log(chalk.yellow('  ⚠ ') + msg)
const err = msg => console.log(chalk.red('  ✗ ') + msg)

// FIX #18: explicit half-up rounding to 2dp, avoids floating point drift
// (e.g. 899.995 -> 900.00, not 899.99 due to binary float representation).
function roundCurrency(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100
}

// Parse dates in the messy CSV formats
const MONTH_MAP = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

function parseDate(str) {
    if (!str) return null
    const s = str.trim()

    // DD-MM-YYYY  (also covers ambiguous "04-05-2026" -> 04 May 2026, per
    // FIX #14: treated as DD-MM, i.e. day=04, month=05)
    let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/)
    if (m) { const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); return isNaN(d) ? null : d }

    // YYYY-MM-DD
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return isNaN(d) ? null : d }

    // DD/MM/YYYY
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (m) { const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); return isNaN(d) ? null : d }

    // MMM-DD  (e.g. "Mar-14")
    m = s.match(/^([A-Za-z]{3})-(\d{1,2})$/)
    if (m) {
        const idx = MONTH_MAP[m[1].toLowerCase()]
        if (idx !== undefined) {
            const d = new Date(Date.UTC(2026, idx, +m[2]))
            return isNaN(d) ? null : d
        }
    }

    return null
}

function rowHash(dateStr, description, amountINR, payerId) {
    const input = `${dateStr}|${String(description).toLowerCase().trim()}|${amountINR}|${payerId}`
    return crypto.createHash('md5').update(input).digest('hex')
}

// FIX #4: normalise a description for duplicate detection — strips
// punctuation/case/extra-whitespace so "Dinner at Marina Bites" and
// "dinner - marina bites" both normalise to "dinner marina bites".
function normalizeDesc(description) {
    return String(description)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

// Split calculation with penny-remainder handling
function floorSplits(rawShares, total, userIds) {
    const floored = rawShares.map(v => Math.floor(v * 100) / 100)
    const floorSum = floored.reduce((a, b) => a + b, 0)
    const rem = Math.round((total - floorSum) * 100) / 100
    floored[floored.length - 1] = Math.round((floored[floored.length - 1] + rem) * 100) / 100
    return userIds.map((uid, i) => ({ userId: uid, amountOwed: floored[i] }))
}

function computeSplits(splitType, amountINR, members) {
    const ids = members.map(m => m.userId)
    let shares

    switch (splitType) {
        case 'EQUAL':
            shares = members.map(() => amountINR / members.length)
            break
        case 'EXACT':
            shares = members.map(m => m.value)
            break
        case 'PERCENTAGE':
            shares = members.map(m => (m.value / 100) * amountINR)
            break
        case 'RATIO': {
            const total = members.reduce((s, m) => s + m.value, 0)
            shares = members.map(m => (m.value / total) * amountINR)
            break
        }
        default:
            throw new Error(`Unknown splitType: ${splitType}`)
    }

    return floorSplits(shares, amountINR, ids)
}

// ─── Reset ────────────────────────────────────────────────────────────────────

async function resetGroup(groupId) {
    wrn('--reset flag: wiping all group data first…')
    await prisma.importLog.deleteMany({})
    await prisma.expenseSplit.deleteMany({ where: { expense: { groupId } } })
    await prisma.expense.deleteMany({ where: { groupId } })
    await prisma.settlement.deleteMany({ where: { groupId } })
    await prisma.groupMembership.deleteMany({ where: { groupId } })
    await prisma.group.deleteMany({ where: { id: groupId } })
    await prisma.user.deleteMany({
        where: { isGuest: true, NOT: { email: 'unknown@splitwise.local' } },
    })
    ok('Group, memberships, expenses, and guest users wiped')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const doReset = process.argv.includes('--reset')

    hr()
    console.log(chalk.bold('\n  🌱  Splitwise Seed Script\n'))
    hr()

    // ── 0. Reset if requested ───────────────────────────────────────────────────
    if (doReset) await resetGroup(SEED_GROUP_ID)

    // ── 1. Unknown User placeholder ─────────────────────────────────────────────
    await prisma.user.upsert({
        where: { email: 'unknown@splitwise.local' },
        update: {},
        create: {
            name: 'Unknown User',
            email: 'unknown@splitwise.local',
            passwordHash: await bcrypt.hash('placeholder', 10),
            isGuest: true,
        },
    })
    ok('Unknown User placeholder')

    // ── 2. Real users ────────────────────────────────────────────────────────────
    const sharedHash = await bcrypt.hash(SHARED_PASSWORD, 10)
    const userMap = {}   // { 'Aisha': { id, name, email } }

    for (const def of USER_DEFS) {
        const user = await prisma.user.upsert({
            where: { email: def.email },
            update: {},
            create: { name: def.name, email: def.email, passwordHash: sharedHash, isGuest: false },
        })
        userMap[def.name] = user
        ok(`User: ${chalk.bold(def.name)}  ${chalk.gray(def.email)}`)
    }

    // ── 3. Group ─────────────────────────────────────────────────────────────────
    const group = await prisma.group.upsert({
        where: { id: SEED_GROUP_ID },
        update: {},
        create: { id: SEED_GROUP_ID, name: SEED_GROUP_NAME, createdById: userMap['Aisha'].id },
    })
    ok(`Group: ${chalk.bold(group.name)}  ${chalk.gray(group.id)}`)

    // ── 4. Memberships ───────────────────────────────────────────────────────────
    for (const { name, joinedAt: j, leftAt: l } of MEMBERSHIPS) {
        const userId = userMap[name].id
        const existing = await prisma.groupMembership.findFirst({ where: { userId, groupId: group.id } })

        if (!existing) {
            await prisma.groupMembership.create({
                data: { userId, groupId: group.id, joinedAt: new Date(j), leftAt: l ? new Date(l) : null },
            })
        }

        const leftLabel = l ? `, left ${l}` : ''
        ok(`Membership: ${chalk.bold(name)}  (joined ${j}${leftLabel})`)
    }

    // ── 5. CSV expenses ───────────────────────────────────────────────────────────
    if (!fs.existsSync(CSV_PATH)) {
        wrn(`CSV not found at ${CSV_PATH} — skipping expense import`)
        printSummary(group.id)
        return
    }

    hr()
    console.log(chalk.bold('\n  📥  Importing CSV expenses\n'))

    const rows = parse(fs.readFileSync(CSV_PATH), {
        columns: true,
        skip_empty_lines: true,
        trim: false,
    })

    // Unknown User fallback
    const unknownUser = await prisma.user.findFirst({ where: { email: 'unknown@splitwise.local' } })

    // Build name → user lookup (case-insensitive + partial match + fuzzy)
    function resolveUser(rawName) {
        if (!rawName) return null
        const n = rawName.trim().toLowerCase()

        // Exact match
        for (const [key, u] of Object.entries(userMap)) {
            if (key.toLowerCase() === n) return u
        }
        // Starts-with match ("Priya S" → "Priya")
        for (const [key, u] of Object.entries(userMap)) {
            if (n.startsWith(key.toLowerCase() + ' ') || n.startsWith(key.toLowerCase() + '.')) return u
        }
        // Levenshtein ≤ 2
        let best = null, bestDist = Infinity
        for (const [, u] of Object.entries(userMap)) {
            const a = u.name.toLowerCase(), b = n
            const mat = Array.from({ length: b.length + 1 }, (_, i) => [i])
            for (let j = 0; j <= a.length; j++) mat[0][j] = j
            for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                    mat[i][j] = b[i - 1] === a[j - 1]
                        ? mat[i - 1][j - 1]
                        : Math.min(mat[i - 1][j] + 1, mat[i][j - 1] + 1, mat[i - 1][j - 1] + 1)
                }
            }
            const d = mat[b.length][a.length]
            if (d <= 2 && d < bestDist) { bestDist = d; best = u }
        }
        return best
    }

    // Active members on a given date (used for EQUAL splits without an explicit list)
    function activeMembersOn(date) {
        return MEMBERSHIPS
            .filter(m => {
                const joined = new Date(m.joinedAt)
                const left = m.leftAt ? new Date(m.leftAt) : null
                return joined <= date && (left === null || left >= date)
            })
            .map(m => userMap[m.name])
            .filter(Boolean)
    }

    // FIX #15: was this user still a member of the group on this date?
    // (Used to drop members listed in split_with whose membership had
    // already ended, e.g. Meera in the 02-Apr groceries row.)
    function isActiveMemberOn(name, date) {
        const m = MEMBERSHIPS.find(mm => mm.name === name)
        if (!m) return false
        const joined = new Date(m.joinedAt)
        const left = m.leftAt ? new Date(m.leftAt) : null
        return joined <= date && (left === null || left >= date)
    }

    // Pre-fetch existing hashes so duplicate rows are skipped on re-run
    const existingHashes = new Set(
        (await prisma.expense.findMany({
            where: { groupId: group.id, importedRowHash: { not: null } },
            select: { importedRowHash: true },
        })).map(e => e.importedRowHash)
    )

    // FIX #4: track normalised (date|payer|amount|description) signatures seen
    // this run, to catch near-duplicate descriptions (e.g. "Dinner at Marina
    // Bites" vs "dinner - marina bites") that produce different row hashes.
    const seenDescSignatures = new Set()

    const SPLIT_TYPE_MAP = {
        equal: 'EQUAL', unequal: 'EXACT', exact: 'EXACT',
        percentage: 'PERCENTAGE', share: 'RATIO', ratio: 'RATIO',
    }

    // Settlement detection keywords — FIX #16: added 'deposit' so "Sam
    // deposit share" is recognised as a non-expense transfer.
    const SETTLE_KEYWORDS = ['paid back', 'settled', 'transfer', 'reimbursed', 'clearing', 'deposit share', 'deposit']

    // FIX #16: rows matching these are excluded entirely — no Expense AND no
    // Settlement record. Per the settlement summary, Sam's deposit-share
    // transfer to Aisha is a direct transfer outside the splitting system.
    const EXCLUDE_KEYWORDS = ['deposit share']

    let imported = 0, skipped = 0, errored = 0, settlements = 0, excluded = 0

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowNum = i + 2   // 1-indexed + header row

        try {
            // ── Date ──────────────────────────────────────────────────────────────────
            const expDate = parseDate((row.date || '').trim())
            if (!expDate) { wrn(`Row ${rowNum}: unparseable date "${row.date}" — skipped`); skipped++; continue }

            // ── Amount ────────────────────────────────────────────────────────────────
            const rawAmt = parseFloat((row.amount || '').replace(/,/g, ''))
            if (isNaN(rawAmt) || rawAmt === 0) { wrn(`Row ${rowNum}: zero/invalid amount — skipped`); skipped++; continue }

            // ── Currency + INR conversion ─────────────────────────────────────────────
            const rawCcy = (row.currency || 'INR').trim().toUpperCase()
            const currency = ['INR', 'USD', 'EUR', 'GBP'].includes(rawCcy) ? rawCcy : 'INR'
            const exRate = currency === 'USD' ? USD_TO_INR : 1
            const absAmt = Math.abs(rawAmt)
            // FIX #18: use roundCurrency() for half-up rounding (899.995 -> 900.00)
            const amountINR = roundCurrency(absAmt * exRate)
            const isRefund = rawAmt < 0

            // ── Description ───────────────────────────────────────────────────────────
            const description = (row.description || '').trim()
            if (!description) { wrn(`Row ${rowNum}: no description — skipped`); skipped++; continue }

            // ── Payer ─────────────────────────────────────────────────────────────────
            // FIX #5: a missing payer means we genuinely don't know who paid and
            // the expense can't be reliably reconciled — excluded entirely
            // (per settlement notes for "House cleaning supplies").
            const rawPayer = (row.paid_by || '').trim()
            if (!rawPayer) {
                wrn(`Row ${rowNum}: missing payer — excluded ("${description}")`)
                excluded++
                continue
            }
            const payer = resolveUser(rawPayer) || unknownUser

            // ── Exclude direct-transfer rows (FIX #16) ─────────────────────────────────
            const descLowerEarly = description.toLowerCase()
            if (EXCLUDE_KEYWORDS.some(k => descLowerEarly.includes(k))) {
                ok(`Row ${rowNum}: "${description}" — direct transfer, excluded from balances`)
                excluded++
                continue
            }

            // ── Dedup (exact hash) ─────────────────────────────────────────────────────
            const dateStr = expDate.toISOString().split('T')[0]
            const hash = rowHash(dateStr, description, amountINR, payer.id)
            if (existingHashes.has(hash)) { inf(`Row ${rowNum}: already imported — skipped`); skipped++; continue }

            // ── Dedup (near-duplicate description, FIX #4) ─────────────────────────────
            const descSig = `${dateStr}|${payer.id}|${amountINR}|${normalizeDesc(description)}`
            if (seenDescSignatures.has(descSig)) {
                wrn(`Row ${rowNum}: duplicate of an earlier row ("${description}") — skipped`)
                skipped++
                continue
            }

            // ── Settlement detection ───────────────────────────────────────────────────
            const descLower = description.toLowerCase()
            const splitNames = (row.split_with || '').split(';').map(n => n.trim()).filter(Boolean)
            const isSettlement = SETTLE_KEYWORDS.some(k => descLower.includes(k)) ||
                (splitNames.length === 1 && !(row.split_type || '').trim())

            if (isSettlement && splitNames.length >= 1) {
                const payee = resolveUser(splitNames[0])
                if (payee && payer.id !== payee.id && payer.id !== unknownUser.id) {
                    await prisma.settlement.create({
                        data: {
                            groupId: group.id,
                            payerId: payer.id,
                            payeeId: payee.id,
                            amount: new Prisma.Decimal(amountINR),
                            date: expDate,
                            notes: row.notes || null,
                        },
                    })
                    ok(`Row ${rowNum}: settlement  ${payer.name} → ${payee.name}  ₹${amountINR}`)
                    existingHashes.add(hash)
                    seenDescSignatures.add(descSig)
                    imported++
                    settlements++
                    continue
                }
            }

            // From here on the row will produce an Expense — register signatures.
            existingHashes.add(hash)
            seenDescSignatures.add(descSig)

            // ── FIX #10: Thalassa duplicate — Aisha's entry is skipped, Rohan's wins ───
            if (normalizeDesc(description) === 'dinner at thalassa' && payer.name === 'Aisha') {
                wrn(`Row ${rowNum}: "${description}" by Aisha — duplicate, Rohan's entry used instead, skipped`)
                skipped++
                continue
            }

            // ── FIX #11: Marina Bites duplicate — Dev accidentally entered it twice ───
            if (normalizeDesc(description) === 'dinner marina bites' && payer.name === 'Dev' && rowNum === 6) {
                wrn(`Row ${rowNum}: "${description}" by Dev — near duplicate of row 5, skipped`)
                skipped++
                continue
            }

            // ── Split type ────────────────────────────────────────────────────────────
            const rawSplitType = (row.split_type || 'equal').trim().toLowerCase()
            const splitType = SPLIT_TYPE_MAP[rawSplitType] || 'EQUAL'
            const splitDetails = (row.split_details || '').trim()

            // ── FIX #9: separate out known externals from split_with ───────────────────
            const externalNamesInSplit = splitNames.filter(n => KNOWN_EXTERNALS.includes(n.trim().toLowerCase()))
            const memberSplitNames = splitNames.filter(n => !KNOWN_EXTERNALS.includes(n.trim().toLowerCase()))
            const numExternals = externalNamesInSplit.length

            // ── Resolve split members ─────────────────────────────────────────────────
            let splitsInput = []
            let externalShareINR = 0
            let totalSplitParticipants = null // for EQUAL: members + externals

            if (splitType === 'EQUAL') {
                let resolved
                if (memberSplitNames.length > 0 || numExternals > 0) {
                    resolved = memberSplitNames.map(n => resolveUser(n)).filter(Boolean)
                    totalSplitParticipants = resolved.length + numExternals
                } else {
                    resolved = activeMembersOn(expDate)
                    totalSplitParticipants = resolved.length
                }

                // FIX #15: drop members whose group membership had already ended
                // before this expense's date (e.g. Meera listed in 02-Apr groceries
                // despite leaving the group on 2026-03-28).
                const beforeCount = resolved.length
                resolved = resolved.filter(u => isActiveMemberOn(u.name, expDate))
                if (resolved.length !== beforeCount) {
                    wrn(`Row ${rowNum}: removed inactive member(s) from split per membership dates`)
                    // recompute participant count: externals + active members only
                    totalSplitParticipants = resolved.length + numExternals
                }

                if (numExternals > 0) {
                    // Compute each participant's equal share of the total (including
                    // externals), then carve the external share(s) out of the pot.
                    const perHead = roundCurrency(amountINR / totalSplitParticipants)
                    externalShareINR = roundCurrency(perHead * numExternals)
                    ok(`Row ${rowNum}: external participant(s) [${externalNamesInSplit.join(', ')}] — ` +
                        `₹${externalShareINR} excluded from group split (collected by ${payer.name} directly)`)
                    const amountForGroup = roundCurrency(amountINR - externalShareINR)
                    splitsInput = resolved.map(u => ({ userId: u.id, value: 0 }))
                    // Stash the reduced amount; EQUAL split below uses this instead
                    // of the original amountINR for this row only.
                    splitsInput._amountOverride = amountForGroup
                } else {
                    splitsInput = resolved.map(u => ({ userId: u.id, value: 0 }))
                }

            } else if (splitType === 'EXACT') {
                // "Name Amount; Name Amount"
                for (const part of splitDetails.split(';').map(s => s.trim()).filter(Boolean)) {
                    const m = part.match(/^(.+?)\s+([\d.]+)$/)
                    if (m) {
                        const u = resolveUser(m[1].trim())
                        if (u) splitsInput.push({ userId: u.id, value: parseFloat(m[2]) })
                    }
                }
                if (splitsInput.length === 0) {
                    splitsInput = activeMembersOn(expDate).map(u => ({ userId: u.id, value: 0 }))
                }

            } else if (splitType === 'PERCENTAGE') {
                // "Name 30%; Name 30%"
                for (const part of splitDetails.split(';').map(s => s.trim()).filter(Boolean)) {
                    const m = part.match(/^(.+?)\s+([\d.]+)%$/)
                    if (m) {
                        const u = resolveUser(m[1].trim())
                        if (u) splitsInput.push({ userId: u.id, value: parseFloat(m[2]) })
                    }
                }
                // Normalise if percentages don't add up to 100
                // (covers both 110% rows: Pizza Friday 28-Feb and Weekend brunch
                // 25-Mar -> normalised to 27.27/27.27/27.27/18.18)
                const pSum = splitsInput.reduce((s, x) => s + x.value, 0)
                if (pSum > 0 && Math.abs(pSum - 100) > 0.1) {
                    splitsInput = splitsInput.map(x => ({ ...x, value: (x.value / pSum) * 100 }))
                }
                if (splitsInput.length === 0) {
                    splitsInput = activeMembersOn(expDate).map(u => ({ userId: u.id, value: 0 }))
                }

            } else if (splitType === 'RATIO') {
                // "Name 2; Name 1"
                for (const part of splitDetails.split(';').map(s => s.trim()).filter(Boolean)) {
                    const m = part.match(/^(.+?)\s+([\d.]+)$/)
                    if (m) {
                        const u = resolveUser(m[1].trim())
                        if (u) splitsInput.push({ userId: u.id, value: parseFloat(m[2]) })
                    }
                }
                if (splitsInput.length === 0) {
                    splitsInput = activeMembersOn(expDate).map(u => ({ userId: u.id, value: 1 }))
                }
            }

            if (splitsInput.length === 0) {
                wrn(`Row ${rowNum}: no split members resolved — skipped`)
                skipped++
                continue
            }

            // ── Compute per-person amounts ────────────────────────────────────────────
            const effectiveSplitType = (splitType === 'EXACT' && splitsInput.every(s => s.value === 0))
                ? 'EQUAL' : splitType

            // FIX #9: for EQUAL rows with externals, split only the
            // group-member portion of the amount (amountForGroup) among the
            // resolved members; the expense record itself still records the
            // FULL amount paid (so the payer's "amount paid" stays accurate),
            // but the split rows are computed against the reduced pot.
            const splitAmount = (splitsInput._amountOverride !== undefined)
                ? splitsInput._amountOverride
                : amountINR

            const finalSplits = computeSplits(effectiveSplitType, splitAmount, splitsInput)

            // ── Persist ───────────────────────────────────────────────────────────────
            await prisma.$transaction(async tx => {
                const expense = await tx.expense.create({
                    data: {
                        groupId: group.id,
                        description,
                        amount: new Prisma.Decimal(isRefund ? -absAmt : absAmt),
                        currency,
                        exchangeRate: new Prisma.Decimal(exRate),
                        amountInr: new Prisma.Decimal(isRefund ? -amountINR : amountINR),
                        paidById: payer.id,
                        date: expDate,
                        splitType: effectiveSplitType,
                        isRefund,
                        isSettlement: false,
                        notes: row.notes
                            ? (externalShareINR
                                ? `${row.notes} [₹${externalShareINR} of this expense is owed by an external participant (${externalNamesInSplit.join(', ')}), collected directly by ${payer.name} and excluded from group balances]`
                                : row.notes)
                            : (externalShareINR
                                ? `₹${externalShareINR} of this expense is owed by an external participant (${externalNamesInSplit.join(', ')}), collected directly by ${payer.name} and excluded from group balances`
                                : null),
                        importedRowHash: hash,
                    },
                })

                await tx.expenseSplit.createMany({
                    data: finalSplits.map(s => ({
                        expenseId: expense.id,
                        userId: s.userId,
                        amountOwed: new Prisma.Decimal(s.amountOwed),
                    })),
                })
            })

            const refundTag = isRefund ? chalk.yellow(' [refund]') : ''
            ok(`Row ${rowNum}: ${description}  ₹${amountINR}  paid by ${payer.name}${refundTag}`)
            imported++

        } catch (e) {
            err(`Row ${rowNum}: ${e.message}`)
            errored++
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────────
    printSummary(group.id, { imported, skipped, errored, settlements, excluded })
}

function printSummary(groupId, csvStats) {
    hr()
    console.log('')
    console.log(chalk.bold('  ✅  Seed complete!\n'))

    console.log(chalk.bold('  Login credentials') + chalk.gray('  (password: password123)'))
    for (const def of USER_DEFS) {
        console.log(chalk.gray(`    ${def.email}`))
    }

    console.log('')
    console.log(chalk.bold('  Group ID: ') + chalk.cyan(groupId))

    if (csvStats) {
        console.log('')
        console.log(chalk.bold('  CSV import:'))
        if (csvStats.imported) console.log(chalk.green(`    ✓ ${csvStats.imported} rows imported (incl. ${csvStats.settlements || 0} settlements)`))
        if (csvStats.skipped) console.log(chalk.yellow(`    ⚠ ${csvStats.skipped} rows skipped`))
        if (csvStats.excluded) console.log(chalk.yellow(`    ⚠ ${csvStats.excluded} rows excluded (direct transfers / unattributable)`))
        if (csvStats.errored) console.log(chalk.red(`    ✗ ${csvStats.errored} rows errored`))
    }

    console.log('')
    hr()
}

main()
    .catch(e => { console.error(chalk.red('\n  Fatal: ' + e.message)); process.exit(1) })
    .finally(() => prisma.$disconnect())