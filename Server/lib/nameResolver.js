// ─── nameResolver.js ──────────────────────────────────────────────────────────
// Pure utility module — no Express, no Prisma, no I/O.
// All functions are synchronous unless noted otherwise.
// ──────────────────────────────────────────────────────────────────────────────

'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 1: levenshtein(a, b)
// Standard Levenshtein edit distance, computed with a 2-D DP matrix.
// Both strings are lowercased before comparison.
// Returns: number
// ─────────────────────────────────────────────────────────────────────────────
function levenshtein (a, b) {
  a = a.toLowerCase()
  b = b.toLowerCase()

  const m = a.length
  const n = b.length

  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        )
      }
    }
  }

  return dp[m][n]
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 2: normalizeName(raw)
// Trims and collapses inner whitespace runs to a single space.
// Returns: string
// ─────────────────────────────────────────────────────────────────────────────
function normalizeName (raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\s+/g, ' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 3: resolveName(rawName, knownUsers)
// Resolves a raw CSV name string against a list of known user records.
//
// knownUsers: Array<{ id, name, email, isGuest }>
//
// Return shapes:
//   EMPTY     — input was blank after trim
//   RESOLVED  — exact match (case-insensitive); note captures what was fixed
//   SUGGESTED — fuzzy match (levenshtein <= 2)
//   UNKNOWN   — no match at all
// ─────────────────────────────────────────────────────────────────────────────
function resolveName (rawName, knownUsers) {
  // 1. Normalize
  const normalized = (typeof rawName === 'string') ? rawName.trim() : ''

  // 2. Empty guard
  if (normalized === '') {
    return {
      status:   'EMPTY',
      raw:      '',
      resolved: null,
      action:   'MISSING_PAYER',
    }
  }

  // 3. Exact match (case-insensitive)
  const exactMatch = knownUsers.find(
    u => u.name.toLowerCase() === normalized.toLowerCase()
  )

  if (exactMatch) {
    // Determine what (if anything) needed fixing.
    let note = null
    if (rawName !== normalized) {
      note = 'trimmed'
    } else if (normalized !== exactMatch.name) {
      note = 'lowercased'
    }

    return {
      status:   'RESOLVED',
      raw:      rawName,
      resolved: { id: exactMatch.id, name: exactMatch.name, email: exactMatch.email },
      action:   'AUTO',
      note,
    }
  }

  // 4. Fuzzy match — find user with minimum Levenshtein distance
  let bestUser     = null
  let bestDistance = Infinity

  for (const u of knownUsers) {
    const d = levenshtein(normalized, u.name)
    if (d < bestDistance) {
      bestDistance = d
      bestUser     = u
    }
  }

  if (bestDistance <= 2 && bestUser !== null) {
    return {
      status:     'SUGGESTED',
      raw:        rawName,
      resolved:   null,
      suggestion: { id: bestUser.id, name: bestUser.name, email: bestUser.email },
      distance:   bestDistance,
      action:     'NEEDS_CONFIRMATION',
    }
  }

  // 5. No match
  return {
    status:     'UNKNOWN',
    raw:        rawName,
    resolved:   null,
    suggestion: null,
    action:     'UNKNOWN_NAME',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 4: extractAllNames(rows)
// Collects every unique raw name string that appears in paid_by or split_with
// across all CSV rows. Names in split_with are semicolon-delimited.
//
// rows: Array<{ paid_by: string, split_with: string, ...rest }>
// Returns: string[] — unique raw strings, empty strings excluded
// ─────────────────────────────────────────────────────────────────────────────
function extractAllNames (rows) {
  const seen = new Set()

  for (const row of rows) {
    // paid_by
    if (row.paid_by && row.paid_by.trim() !== '') {
      seen.add(row.paid_by)
    }

    // split_with — semicolon-separated list
    if (row.split_with) {
      for (const part of row.split_with.split(';')) {
        const name = part.trim()
        if (name !== '') seen.add(name)
      }
    }
  }

  return Array.from(seen)
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 5: inferMembershipDates(userName, rows)
// Scans all rows to find the earliest and latest dates on which userName
// appears (in paid_by or split_with). Used to suggest joinedAt / leftAt for
// auto-created members.
//
// userName: string — normalized name to search for (matched case-insensitively)
// rows:     Array<{ paid_by, split_with, date, ...rest }>
// Returns:  { firstSeen: Date | null, lastSeen: Date | null }
// ─────────────────────────────────────────────────────────────────────────────
function inferMembershipDates (userName, rows) {
  const target = userName.trim().toLowerCase()
  let firstSeen = null
  let lastSeen  = null

  for (const row of rows) {
    // Determine if userName appears in this row.
    const inPaidBy = typeof row.paid_by === 'string' &&
      row.paid_by.trim().toLowerCase() === target

    const inSplitWith = typeof row.split_with === 'string' &&
      row.split_with
        .split(';')
        .some(part => part.trim().toLowerCase() === target)

    if (!inPaidBy && !inSplitWith) continue

    // Parse the row date.
    const parsed = row.date ? new Date(row.date) : null
    if (!parsed || isNaN(parsed.getTime())) continue

    if (firstSeen === null || parsed < firstSeen) firstSeen = parsed
    if (lastSeen  === null || parsed > lastSeen)  lastSeen  = parsed
  }

  return { firstSeen, lastSeen }
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  levenshtein,
  normalizeName,
  resolveName,
  extractAllNames,
  inferMembershipDates,
}
