// ─── Seed Script ──────────────────────────────────────────────────────────────
// Runs ONCE before any CSV import.
// Creates all known users, the group, memberships, and the Unknown User
// placeholder. Safe to re-run — upserts/findFirst guards prevent duplicates.
// Usage: npm run seed  (from the Server directory)
// ──────────────────────────────────────────────────────────────────────────────

require('dotenv').config()          // must load before lib/prisma creates the pg Pool
const prisma = require('../lib/prisma')
const bcrypt = require('bcryptjs')

// ─── Membership definitions ───────────────────────────────────────────────────
// joinedAt / leftAt dates inferred from the CSV export.
const MEMBERSHIPS = [
  { name: 'Aisha', joinedAt: '2026-02-01', leftAt: null },
  { name: 'Rohan', joinedAt: '2026-02-01', leftAt: null },
  { name: 'Priya', joinedAt: '2026-02-01', leftAt: null },
  { name: 'Meera', joinedAt: '2026-02-01', leftAt: '2026-03-28' },
  { name: 'Dev',   joinedAt: '2026-02-08', leftAt: '2026-03-14' },
  { name: 'Sam',   joinedAt: '2026-04-10', leftAt: null },
]

// Deterministic UUID for the seed group so the value is stable across re-runs.
// Generated once from the name 'seed-flat-2026' — do not change.
const SEED_GROUP_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const SEED_GROUP_NAME = 'Flat 2026'

async function main () {
  // ── STEP 1 — Unknown User placeholder ──────────────────────────────────────
  await prisma.user.upsert({
    where:  { email: 'unknown@splitmate.local' },
    update: {},
    create: {
      name:         'Unknown User',
      email:        'unknown@splitmate.local',
      passwordHash: await bcrypt.hash('placeholder', 12),
      isGuest:      true,
    },
  })
  console.log('✓ Unknown User created')

  // ── STEP 2 — Known users ────────────────────────────────────────────────────
  // Hash the shared password once and reuse for all 6 users.
  const sharedHash = await bcrypt.hash('password123', 12)

  const userDefs = [
    { name: 'Aisha', email: 'aisha@splitmate.com' },
    { name: 'Rohan', email: 'rohan@splitmate.com' },
    { name: 'Priya', email: 'priya@splitmate.com' },
    { name: 'Meera', email: 'meera@splitmate.com' },
    { name: 'Dev',   email: 'dev@splitmate.com'   },
    { name: 'Sam',   email: 'sam@splitmate.com'   },
  ]

  /** @type {Record<string, { id: string, name: string, email: string }>} */
  const users = {}

  for (const def of userDefs) {
    const user = await prisma.user.upsert({
      where:  { email: def.email },
      update: {},
      create: {
        name:         def.name,
        email:        def.email,
        passwordHash: sharedHash,
        isGuest:      false,
      },
    })
    users[def.name] = { id: user.id, name: user.name, email: user.email }
    console.log(`✓ User: ${def.name} (${def.email})`)
  }

  // ── STEP 3 — Group ──────────────────────────────────────────────────────────
  const group = await prisma.group.upsert({
    where:  { id: SEED_GROUP_ID },
    update: {},
    create: {
      id:          SEED_GROUP_ID,
      name:        SEED_GROUP_NAME,
      createdById: users['Aisha'].id,
    },
  })
  console.log(`✓ Group: ${group.name} (id: ${group.id})`)

  // ── STEP 4 — Memberships ────────────────────────────────────────────────────
  for (const { name, joinedAt: joinedAtStr, leftAt: leftAtStr } of MEMBERSHIPS) {
    const userId = users[name].id

    // Guard: skip if a membership for this (user, group) already exists.
    const existing = await prisma.groupMembership.findFirst({
      where: { userId, groupId: group.id },
    })

    if (!existing) {
      await prisma.groupMembership.create({
        data: {
          userId,
          groupId:  group.id,
          joinedAt: new Date(joinedAtStr),
          leftAt:   leftAtStr ? new Date(leftAtStr) : null,
        },
      })
    }

    // Console label includes leftAt only when the member has departed.
    const leftLabel = leftAtStr ? `, left ${leftAtStr}` : ''
    console.log(`✓ Membership: ${name} (joined ${joinedAtStr}${leftLabel})`)
  }

  // ── Final summary ───────────────────────────────────────────────────────────
  console.log(`
✅ Seed complete!

Login credentials (all passwords: password123):
  aisha@splitmate.com
  rohan@splitmate.com
  priya@splitmate.com
  meera@splitmate.com
  dev@splitmate.com
  sam@splitmate.com

Group ID: ${group.id}
Upload expenses_export.csv to this group.`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
