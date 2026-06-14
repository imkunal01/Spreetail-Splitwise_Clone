// ─── Seed Script ─────────────────────────────────────────────────────────────
//
// Creates all test users, the flat group, memberships with realistic dates,
// and imports all CSV expenses so the Balances tab shows real data right away.
//
// Usage:
//   npm run seed              — idempotent, skips anything that already exists
//   npm run seed -- --reset   — wipes expenses / memberships / group first, then re-seeds
//
// Login credentials (all passwords: password123)
//   aisha@splitmate.com   rohan@splitmate.com   priya@splitmate.com
//   meera@splitmate.com   dev@splitmate.com      sam@splitmate.com
//
// ─────────────────────────────────────────────────────────────────────────────

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
const CSV_PATH = path.resolve(__dirname, '../../Expenses Export.csv')
const SHARED_PASSWORD = 'password123'
const USD_TO_INR = 84   // fixed rate for seeding — no network call

const USER_DEFS = [
  { name: 'Aisha', email: 'aisha@splitwire.com' },
  { name: 'Rohan', email: 'rohan@splitwire.com' },
  { name: 'Priya', email: 'priya@splitwire.com' },
  { name: 'Meera', email: 'meera@splitwire.com' },
  { name: 'Dev', email: 'dev@splitwire.com' },
  { name: 'Sam', email: 'sam@splitwire.com' },
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

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

const hr = () => console.log(chalk.gray('─'.repeat(56)))
const ok = msg => console.log(chalk.green('  ✓ ') + msg)
const inf = msg => console.log(chalk.cyan('  → ') + msg)
const wrn = msg => console.log(chalk.yellow('  ⚠ ') + msg)
const err = msg => console.log(chalk.red('  ✗ ') + msg)

// Parse dates in the messy CSV formats
const MONTH_MAP = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

function parseDate(str) {
  if (!str) return null
  const s = str.trim()

  // DD-MM-YYYY
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
    where: { isGuest: true, NOT: { email: 'unknown@splitmate.local' } },
  })
  ok('Group, memberships, expenses, and guest users wiped')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const doReset = process.argv.includes('--reset')

  hr()
  console.log(chalk.bold('\n  🌱  SplitMate Seed Script\n'))
  hr()

  // ── 0. Reset if requested ───────────────────────────────────────────────────
  if (doReset) await resetGroup(SEED_GROUP_ID)

  // ── 1. Unknown User placeholder ─────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'unknown@splitmate.local' },
    update: {},
    create: {
      name: 'Unknown User',
      email: 'unknown@splitmate.local',
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
  const unknownUser = await prisma.user.findFirst({ where: { email: 'unknown@splitmate.local' } })

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

  // Pre-fetch existing hashes so duplicate rows are skipped on re-run
  const existingHashes = new Set(
    (await prisma.expense.findMany({
      where: { groupId: group.id, importedRowHash: { not: null } },
      select: { importedRowHash: true },
    })).map(e => e.importedRowHash)
  )

  const SPLIT_TYPE_MAP = {
    equal: 'EQUAL', unequal: 'EXACT', exact: 'EXACT',
    percentage: 'PERCENTAGE', share: 'RATIO', ratio: 'RATIO',
  }

  // Settlement detection keywords
  const SETTLE_KEYWORDS = ['paid back', 'settled', 'transfer', 'reimbursed', 'clearing', 'deposit share']

  let imported = 0, skipped = 0, errored = 0

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
      const amountINR = Math.round(absAmt * exRate * 100) / 100
      const isRefund = rawAmt < 0

      // ── Description ───────────────────────────────────────────────────────────
      const description = (row.description || '').trim()
      if (!description) { wrn(`Row ${rowNum}: no description — skipped`); skipped++; continue }

      // ── Payer ─────────────────────────────────────────────────────────────────
      const payer = resolveUser((row.paid_by || '').trim()) || unknownUser

      // ── Dedup ─────────────────────────────────────────────────────────────────
      const dateStr = expDate.toISOString().split('T')[0]
      const hash = rowHash(dateStr, description, amountINR, payer.id)
      if (existingHashes.has(hash)) { inf(`Row ${rowNum}: already imported — skipped`); skipped++; continue }
      existingHashes.add(hash)

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
          imported++
          continue
        }
      }

      // ── Split type ────────────────────────────────────────────────────────────
      const rawSplitType = (row.split_type || 'equal').trim().toLowerCase()
      const splitType = SPLIT_TYPE_MAP[rawSplitType] || 'EQUAL'
      const splitDetails = (row.split_details || '').trim()

      // ── Resolve split members ─────────────────────────────────────────────────
      let splitsInput = []

      if (splitType === 'EQUAL') {
        const resolved = splitNames.length > 0
          ? splitNames.map(n => resolveUser(n)).filter(Boolean)
          : activeMembersOn(expDate)
        splitsInput = resolved.map(u => ({ userId: u.id, value: 0 }))

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
      const finalSplits = computeSplits(effectiveSplitType, amountINR, splitsInput)

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
            notes: row.notes || null,
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
  printSummary(group.id, { imported, skipped, errored })
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
    if (csvStats.imported) console.log(chalk.green(`    ✓ ${csvStats.imported} rows imported`))
    if (csvStats.skipped) console.log(chalk.yellow(`    ⚠ ${csvStats.skipped} rows skipped`))
    if (csvStats.errored) console.log(chalk.red(`    ✗ ${csvStats.errored} rows errored`))
  }

  console.log('')
  hr()
}

main()
  .catch(e => { console.error(chalk.red('\n  Fatal: ' + e.message)); process.exit(1) })
  .finally(() => prisma.$disconnect())
