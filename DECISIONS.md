# DECISIONS.md — Engineering & Product Decision Log

Every significant decision made during the build of Splitmate, the options considered, and the
reasoning behind each choice.

---

## DECISION 1 — ORM Choice: Prisma 7 over raw pg

**Context:** The project requires PostgreSQL. Options were raw `pg` pool queries, Knex.js, or
Prisma ORM.

**Options considered:**

| Option | Pros | Cons |
|--------|------|------|
| Raw `pg` | Maximum control, no abstraction overhead | Manual query construction, no type safety, verbose |
| Knex.js | SQL-like builder, lightweight | Still requires manual migrations, no schema source of truth |
| **Prisma 7** | Type-safe client, schema as source of truth, migration system, readable relations | Larger dependency, Prisma 7 breaking change (config moved to prisma.config.ts) |

**Decision:** Prisma 7 with `@prisma/adapter-pg` driver adapter.

**Reason:** For a project evaluated on code clarity and maintainability, Prisma's generated client
produces self-documenting code. The type-safe client also prevents entire classes of runtime
errors (wrong column names, wrong types). The Prisma 7 breaking change (datasource URL must live
in `prisma.config.ts`, not `schema.prisma`) was discovered during development and documented.

**Key discovery during build:** `new PrismaClient()` with no arguments throws in Prisma 7 with
the driver adapter model — the adapter must be passed explicitly. This was fixed by creating
`Server/lib/prisma.js` as a shared singleton that instantiates `PrismaClient` with the
`@prisma/adapter-pg` adapter.

---

## DECISION 2 — Architecture: `prisma.config.ts` vs `schema.prisma` for URL

**Context:** Prisma 7 removed `url = env("DATABASE_URL")` from the `datasource db {}` block in
`schema.prisma`. The correct property moved to `prisma.config.ts` under `datasource.url`.

**Options considered:**
- Downgrade to Prisma 6 to avoid the breaking change.
- Read the actual type definition file (`@prisma/config/dist/index.d.ts`) and implement correctly.

**Decision:** Stay on Prisma 7.8.0 and fix the config correctly.

**Reason:** Downgrading just to avoid learning the new API is a short-term fix. Reading the
actual type definitions (`datasource.url`, not `migrate.url`, not `migrations.url`) and verifying
with `npx prisma validate` is the correct engineering approach. Documented in AI_USAGE.md as a
case where the AI initially produced wrong code.

---

## DECISION 3 — Auth: JWT in httpOnly Cookies vs localStorage

**Context:** The app needs persistent authentication across page reloads.

**Options considered:**

| Option | Pros | Cons |
|--------|------|------|
| localStorage | Simple to implement | Accessible to JavaScript — XSS vulnerability |
| **httpOnly cookies** | Immune to XSS — JS cannot read the token | Requires CORS `credentials: true`, SameSite config |
| Session (server-side) | No token exposure | Requires server-side session store, not stateless |

**Decision:** JWT stored in `httpOnly` cookie with `sameSite: 'lax'`.

**Reason:** Industry-standard for web apps. The auth middleware reads `req.cookies.token`, verifies
the JWT, and populates `req.user = { userId, email, name }`. The Axios instance sets
`withCredentials: true` so all requests include the cookie automatically. The 401 interceptor
guards against redirect loops by checking `window.location.pathname !== '/login'` before
redirecting.

---

## DECISION 4 — Membership Model: Row-per-Period vs Single Row with Dates

**Context:** Meera left March 31; Sam joined April 15. The same user can theoretically leave and
rejoin a group.

**Options considered:**

| Option | Description |
|--------|-------------|
| Single row with `joined_at` and `left_at` | Cannot handle re-joins without workaround |
| **New row per membership period** | Each join creates a new `group_memberships` row |

**Decision:** New row per membership period, with a partial unique index:
`UNIQUE(user_id, group_id) WHERE left_at IS NULL`.

**Reason:** This makes re-joins a natural operation (just insert a new row with the new `joined_at`
and `left_at = NULL`). The partial unique index prevents two active memberships for the same
user/group combination while allowing historical records. The `CHECK(left_at >= joined_at)`
constraint prevents invalid date ranges at the database level.

---

## DECISION 5 — Currency: Store `amount_inr` Permanently vs Recalculate

**Context:** Some expenses are in USD with no exchange rate in the CSV. The rate needs to come
from somewhere.

**Options considered:**

| Option | Description | Problem |
|--------|-------------|---------|
| Store only original amount + currency | Recalculate INR on every request | Historical amounts change as rates change |
| **Store original + rate + amount_inr** | Lock in the rate at import/creation time | Slightly more storage |
| Require user to enter exchange rate | Maximum accuracy | Too much friction for users |

**Decision:** Store `amount`, `currency`, `exchange_rate`, and `amount_inr` on every expense.

**Reason:** Priya explicitly asked "Half the trip was in dollars. The sheet pretends a dollar is
a rupee." The exchange rate used must be locked at the time of import and never change. If USD/INR
moves from ₹83.50 to ₹86.00 next month, the August trip expenses do not retroactively change.
The Frankfurter API (`api.frankfurter.app/latest?from=USD&to=INR`) provides a live rate at
preview time; if unavailable, ₹83.50 is used as fallback (documented in the import report).

---

## DECISION 6 — Import Flow: Two-Step Preview + Confirm vs Single-Step

**Context:** The CSV has at least 22 data problems. The assignment says "a crashed import and a
silent guess are both failing answers."

**Options considered:**

| Option | Description | Problem |
|--------|-------------|---------|
| Single-step import | Parse, auto-fix, import | User has no visibility into what was changed |
| **Two-step: preview then confirm** | Show anomalies, let user decide, then import | More complex but gives full user control |

**Decision:** Two-step flow — `POST /preview` then `POST /confirm`.

**Reason:** Meera's request: "Clean up the duplicates — but I want to approve anything the app
deletes or changes." A two-step flow lets the user see every anomaly, choose an action, and only
then commit. The `sessionId` UUID ties the preview to the confirm call. Every row decision is
logged to `import_logs` with the action taken.

---

## DECISION 7 — Duplicate Detection: Hash-based vs Field Comparison

**Context:** The CSV contains exact duplicates (Rows 5/6 — Marina Bites) and potential duplicates
(Rows 24/25 — Thalassa). Both need to be caught without false positives.

**Options considered:**

| Method | Detects | False positive risk |
|--------|---------|---------------------|
| Check every combination of fields | Exact and near-exact | High if descriptions vary slightly |
| **MD5 hash of date+description.lowercase+amount+paidById** | Exact duplicates only | Very low |
| Levenshtein on description only | Near-duplicates | High — "rent" would match "March rent" |

**Decision:** MD5 hash for exact deduplication + Levenshtein (≤3) for conflict detection, as two
separate anomaly types.

**Reason:** The hash gives a definitive "this row was already imported" check (stored in
`imported_row_hash` with a partial unique index). The Levenshtein check with threshold ≤3 catches
near-matches (same date, similar description, different amount/payer) without catching unrelated
expenses. The Thalassa rows (distance ~10) correctly do not auto-flag — their conflict is
surfaced via the import notes instead.

---

## DECISION 8 — Rounding: Floor-then-Last vs Round-Each vs Banker's Rounding

**Context:** Splitting ₹10 among 3 people yields ₹3.333... per person. The splits must sum to
exactly ₹10 for the balance engine to be correct.

**Options considered:**

| Method | Description | Problem |
|--------|-------------|---------|
| Round each to 2dp | ₹3.33 + ₹3.33 + ₹3.33 = ₹9.99 | Off by ₹0.01 — accumulates over many splits |
| Banker's rounding | Round half to even | More complex, same accumulation risk |
| **Floor-then-last** | Floor all, add remainder to last person | Guaranteed to sum exactly |

**Decision:** Floor each raw share to 2 decimal places; compute remainder; add to last person.

**Reason:** The last person absorbs at most ±₹0.01 rounding delta per split. This is the same
algorithm used by Splitwise. The advantage is mathematical certainty: `SUM(amount_owed)` always
equals `amount_inr` exactly, so the balance engine cannot accumulate floating-point drift across
hundreds of expenses.

---

## DECISION 9 — Debt Simplification: Greedy vs Optimal

**Context:** Aisha asked for "one number per person. Who pays whom, how much, done." A group of
5 people with complex cross-debts could require up to 10 transactions to settle. Debt simplification
reduces this.

**Options considered:**

| Algorithm | Description | Complexity |
|-----------|-------------|------------|
| **Greedy (largest first)** | Sort creditors/debtors by amount, pair largest-to-largest | O(n log n) |
| Min-cost flow (optimal) | Guaranteed minimum number of transactions | O(n³) |

**Decision:** Greedy algorithm.

**Reason:** For groups of ≤20 people (the expected use case), the greedy algorithm produces
near-optimal results in constant time. The optimal algorithm would never save more than 1–2
transactions for groups this size, making the implementation complexity unjustifiable. The greedy
approach is also easier to trace during the live review session.

---

## DECISION 10 — Settlement Storage: Separate Table vs `is_settlement` Flag

**Context:** Row 14 ("Rohan paid Aisha back") is a payment between two people, not a shared
expense. Rows 38 ("Sam deposit share") is similar.

**Options considered:**

| Option | Description | Problem |
|--------|-------------|---------|
| `is_settlement = true` flag on `expenses` | Simple, single table | Settlements pollute the expenses list; split semantics don't apply |
| **Separate `settlements` table** | Clean separation | Slightly more complex queries |

**Decision:** Separate `settlements` table, with `is_settlement` flag on `expenses` as a fallback
for rows the user explicitly imports as expenses despite looking like settlements.

**Reason:** Settlements have a fundamentally different structure (payer → payee, no splits) and
should not appear in the expense list. The balance engine queries expenses and settlements
separately and applies them additionally. Having both mechanisms means the importer can handle
"import_as_settlement" (creates Settlement record) and "import_as_expense" (creates Expense with
`is_settlement = true` flag) without losing the user's choice.

---

## DECISION 11 — Unknown Members: Create Guest vs Remove from Split

**Context:** Row 23 includes "Dev's friend Kabir" — not a registered user. The system cannot
add an unregistered person to a split that links to `users.id`.

**Options considered:**

| Option | Description |
|--------|-------------|
| Auto-create guest user | Adds a User record with `is_guest = true` |
| **Remove from split (default)** | Kabir's share is redistributed to other active members |
| Skip the whole row | Parasailing expense is lost entirely |

**Decision:** Default action is `remove_from_split`. `create_guest_user` is offered as an
alternative option.

**Reason:** The expense happened and should be recorded. Kabir's presence doesn't invalidate
the fact that Aisha, Rohan, Priya, and Dev went parasailing. Removing Kabir from the split
and redistributing among the four is the least-bad default. If the group wants Kabir tracked,
they can manually create a guest account.

---

## DECISION 12 — Inactive Member Handling: Auto-Remove vs Skip Row

**Context:** Row 36 lists Meera in the split on 02-04-2026, after she left on 31-03-2026.

**Options considered:**

| Option | Description |
|--------|-------------|
| Skip entire row | The expense is lost |
| **Remove inactive member, import with remaining** | Expense is recorded; Meera excluded |
| Import as-is and let user fix balances manually | Incorrect balances |

**Decision:** `remove_inactive` as the default — Meera is dropped from the April splits, and the
remaining active members (Aisha, Rohan, Priya) share the cost. This directly implements Sam's
request.

**Reason:** The expense is real (groceries were bought). The data error is only in the membership
list. Removing the inactive member and distributing among active members on the expense date is
the most accurate representation of what actually happened.

---

## DECISION 13 — Promise.all for Preview Route vs Sequential Awaits

**Context:** The preview route originally made three sequential `await` calls: fetch memberships,
fetch existing hashes, fetch USD rate. The Frankfurter API from India takes 5–17 seconds. During
this time, Supabase's free-tier killed the idle pg connections. The next request hit a
"Connection terminated unexpectedly" error.

**Options considered:**
- Sequential `await` — simple but causes connection starvation
- **`Promise.all()`** — fires all three concurrently

**Decision:** `Promise.all([memberships, hashes, usdRate])`.

**Reason:** DB connections are acquired and released in ~100ms. The HTTP call to Frankfurter
runs in parallel. By the time `fetchUsdRate()` returns (even if it takes 17 seconds), the DB
connections have long been released. This is a correctness requirement, not a performance
optimisation.

---

## DECISION 14 — Split Type Mapping: CSV Labels to Internal Enum

**Context:** The CSV uses `"equal"`, `"unequal"`, `"share"`, `"percentage"`. The database enum
uses `EQUAL`, `EXACT`, `RATIO`, `PERCENTAGE`.

**Mapping:**
```
"equal"      → EQUAL
"unequal"    → EXACT  (each person's exact amount specified)
"share"      → RATIO  (proportional share counts, e.g. "Aisha 1; Rohan 2")
"percentage" → PERCENTAGE
```

**Reason:** "Unequal" is ambiguous — it could mean any non-equal split. The CSV's `split_details`
for unequal rows always specifies exact rupee amounts ("Rohan 700; Priya 400; Meera 400"), making
`EXACT` the correct mapping. "Share" with ratio values maps cleanly to `RATIO`.

---

## DECISION 15 — Percentage Normalisation: Reject vs Normalise

**Context:** Rows 15 and 32 have percentages that sum to 110% (30+30+30+20).

**Options considered:**

| Option | Description |
|--------|-------------|
| Reject the row, require user to fix CSV | User cannot edit CSV (assignment rule) |
| **Normalise proportionally to 100%** | Preserve relative weights, auto-correct |
| Use as-is and let amounts not sum correctly | Balance engine breaks |

**Decision:** Flag as `PERCENTAGE_SUM_INVALID`, offer `normalize_to_100` as the default action.
The `normalizeSplits()` function scales each value: `newValue = (value / totalSum) * 100`.

**Reason:** The assignment explicitly forbids editing the CSV. The relative percentages (30:30:30:20)
are almost certainly correct — only the scale is wrong (the percentages should have been out of
100, not 110). Normalisation preserves the intent.

---

## DECISION 16 — Import Button: Disabled vs Always Enabled

**Context:** The original import button was `disabled={importCount === 0}`. With this CSV, almost
every row was flagged with a `SKIP` default anomaly, so `importCount` was always 0 and the button
could never be clicked.

**Root cause:** The effective action logic treated any anomaly with a `skip` default as a
row-level skip, even if the user hadn't touched the radio buttons.

**Decision:** Remove the `disabled` guard. Change the effective action logic so that `skip`
only wins if the user explicitly selects it. Defaults are treated as the intended import action,
not as veto votes.

**Reason:** The button being permanently disabled is a broken UX. The backend handles empty
decisions arrays gracefully. Trusting the server-side validation over client-side early-exit
is the correct approach.

---

## DECISION 17 — Balance Engine: membership-aware vs flat total

**Context:** Sam joined April 15. If balances are computed by naively summing all expenses in
`split_with`, Sam would be charged for February rent even though he wasn't there.

**Decision:** The balance engine checks `isActiveOnDate(membership, expenseDate)` for every
participant in every expense before adding to their balance.

```js
function isActiveOnDate(membership, date) {
  return (
    membership.joinedAt <= date &&
    (membership.leftAt === null || membership.leftAt >= date)
  );
}
```

**Reason:** This is the core correctness requirement that makes Splitmate accurate rather than
just a calculator. Sam's and Meera's requests both depend on this.