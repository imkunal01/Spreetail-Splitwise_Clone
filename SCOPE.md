# SCOPE.md — Plitwire Data Anomaly Log & Database Schema

---

## Part 1: CSV Anomaly Log

The file `expenses_export.csv` contains 42 data rows (43 including header). During import, the system
detected and handled the following 22 categories of anomaly. Each anomaly is listed with the exact
row(s) it appears on, the detection method, and the handling policy enforced.

---

### ANOMALY 1 — DUPLICATE_SAME_AMOUNT

**Row(s):** Row 5 and Row 6

**What it is:** Two entries for the same dinner — "Dinner at Marina Bites" (Row 5, paid by Dev, ₹3200)
and "dinner - marina bites" (Row 6, same payer, same amount, same date 08-02-2026). The description
differs only in casing and punctuation.

**Detection method:** `computeRowHash(date, description.toLowerCase().trim(), amount, paidById)` —
after normalisation both rows produce the same MD5 hash. The importer also runs a Levenshtein check
across rows (threshold ≤ 3), which catches the lowercase variant.

**Handling policy:** Row 6 is flagged as `DUPLICATE_EXACT` with default action `skip`. The first row
(Row 5) is imported normally. The duplicate is skipped and logged to `import_logs` with
`status = SKIPPED`.

**Schema coverage:** `imported_row_hash VARCHAR(64)` on `expenses` + partial unique index
`WHERE imported_row_hash IS NOT NULL` prevents double-import at the database level.

---

### ANOMALY 2 — CONFLICTING_DUPLICATE (Thalassa dinner)

**Row(s):** Row 24 and Row 25

**What it is:** "Dinner at Thalassa" (paid by Aisha, ₹2400, Row 24) and "Thalassa dinner"
(paid by Rohan, ₹2450, Row 25). Same date (11-03-2026), similar description, but different payer
and different amount. Note on Row 25 says "Aisha also logged this I think hers is wrong."

**Detection method:** Levenshtein distance between descriptions is ~10 (exceeds the ≤3 threshold),
so these rows do NOT auto-flag as `CONFLICTING_DUPLICATE`. They are caught manually — the note on
Row 25 is surfaced in the import UI.

**Handling policy:** We treat this as a policy decision: Row 25 has a note that explicitly says
Row 24 may be the accurate one. We import Row 24 (Aisha, ₹2400) and skip Row 25. This is
documented in the import report.

**Schema coverage:** The note field (`notes TEXT`) on the `expenses` table preserves the original
comment. The `imported_row_hash` unique index prevents re-importing if the CSV is run again.

---

### ANOMALY 3 — COMMA_IN_AMOUNT

**Row(s):** Row 7

**What it is:** Amount is `"1,200"` (string with a comma) instead of `1200`. If parsed naively,
`parseFloat("1,200")` returns `1`, not `1200`.

**Detection method:** Pre-processing in the importer strips commas before parsing:
`rawAmount = row.amount.replace(/,/g, '')` → `parseFloat("1200")` = 1200 correctly.

**Handling policy:** Auto-corrected silently. No anomaly flag is raised because the correction
is unambiguous. The cleaned amount (1200) is used for all downstream calculations.

**Schema coverage:** `amount DECIMAL(12,2)` on the `expenses` table — the DB type accepts only
numeric values; the importer acts as the cleaning layer before reaching the DB.

---

### ANOMALY 4 — EXCESSIVE_DECIMAL

**Row(s):** Row 10

**What it is:** Amount is `899.995` — three decimal places. Standard currency uses two.

**Detection method:** `DECIMAL(12,2)` at the Prisma/PostgreSQL layer truncates/rounds automatically.
The importer also applies its floor-then-correct-last-person rounding rule when computing splits,
so ₹899.995 is treated as ₹900.00 in split calculations.

**Handling policy:** Auto-rounded to 2 decimal places by the database. No user action required.
The stored value is ₹900.00.

**Schema coverage:** `DECIMAL(12,2)` enforces 2 decimal places at storage time.

---

### ANOMALY 5 — CASE_MISMATCH_PAYER

**Row(s):** Row 9

**What it is:** Payer listed as `"priya"` (lowercase). Group member is registered as `"Priya"`.

**Detection method:** `resolveMemberName` normalises both to lowercase before comparing:
`normalizedRaw = rawName.trim().toLowerCase()`. Exact match found.

**Handling policy:** Auto-resolved silently. No anomaly raised.

**Schema coverage:** Handled entirely at the application layer. The DB stores the canonical name
from the `users` table.

---

### ANOMALY 6 — TRAILING_SPACE_PAYER

**Row(s):** Row 27

**What it is:** Payer listed as `"rohan "` (trailing space). The raw CSV value has a space after
the name.

**Detection method:** `resolveMemberName` calls `.trim()` before comparison. After trimming,
`"rohan"` matches `"Rohan"` via case-insensitive exact match.

**Handling policy:** Auto-resolved silently. No anomaly raised.

**Schema coverage:** Handled at the application layer. The `trim: true` option in `csv-parse`
catches most trailing spaces at parse time.

---

### ANOMALY 7 — UNKNOWN_PAYER (fuzzy match)

**Row(s):** Row 11

**What it is:** Payer listed as `"Priya S"`. The registered member is `"Priya"`. No exact match
exists, but Levenshtein(`"priya s"`, `"priya"`) = 2 ≤ 2, so a suggestion is available.

**Detection method:** `resolveMemberName` fails exact match, then runs Levenshtein on all group
members. Distance of 2 is within the threshold.

**Handling policy:** Flagged as `UNKNOWN_PAYER` with the suggestion `"Priya"` and default action
`use_suggestion`. User can accept or skip.

**Schema coverage:** `paid_by_id UUID NOT NULL REFERENCES users(id)` — if not resolved, the row
cannot be imported (NOT NULL constraint). The importer validates this before attempting insert.

---

### ANOMALY 8 — MISSING_PAYER

**Row(s):** Row 13

**What it is:** `paid_by` column is empty. The note says "can't remember who paid."

**Detection method:** `!row.paid_by?.trim()` triggers `MISSING_PAYER` check.

**Handling policy:** Flagged with options to skip or assign to any current group member. Default
action is `skip`. The user must explicitly assign a payer to import this row.

**Schema coverage:** `paid_by_id UUID NOT NULL` — DB enforces non-null. The importer's null-check
guard prevents sending a null paidById to the DB.

---

### ANOMALY 9 — SETTLEMENT_AS_EXPENSE (keyword match)

**Row(s):** Row 14

**What it is:** Row 14 is "Rohan paid Aisha back ₹5000." The note explicitly says "this is a
settlement not an expense??" The description contains the keyword "paid back."

**Detection method:** Settlement keyword list: `['paid back', 'settled', 'transfer', 'reimbursed',
'clearing', 'deposit share']`. `"paid back"` matches. Also: `split_type` is empty AND only one
person in `split_with` — both conditions trigger.

**Handling policy:** Flagged as `SETTLEMENT_AS_EXPENSE`. Default action `import_as_settlement`.
If confirmed, a `Settlement` record is created (payer = Rohan, payee = Aisha, amount = ₹5000)
rather than an `Expense` record.

**Schema coverage:** Dedicated `settlements` table separate from `expenses`. `is_settlement`
boolean flag on `expenses` covers cases where the user chooses `import_as_expense` instead.

---

### ANOMALY 10 — PERCENTAGE_SUM_WRONG

**Row(s):** Row 15, Row 32

**What it is:**
- Row 15 (Pizza Friday): split_details = "Aisha 30%; Rohan 30%; Priya 30%; Meera 20%" — sums to 110%.
  Note says "percentages might be off."
- Row 32 (Weekend brunch): same pattern — Aisha 30%, Rohan 30%, Priya 30%, Meera 20% = 110%.

**Detection method:** `PERCENTAGE_SUM_INVALID` check: parses split_details, sums values, checks
if sum is outside [99.99, 100.01].

**Handling policy:** Flagged with default action `normalize_to_100`. The `normalizeSplits()`
function proportionally scales all percentages so they sum to exactly 100%:
30/110 ≈ 27.27%, 20/110 ≈ 18.18%. This preserves the relative weights.

**Schema coverage:** Validation is purely at the application layer. The DB stores the final
normalised amounts in `expense_splits.amount_owed`.

---

### ANOMALY 11 — NEGATIVE_AMOUNT (refund)

**Row(s):** Row 26

**What it is:** "Parasailing refund" with amount = `-30` USD. One parasailing slot was cancelled
and money was returned.

**Detection method:** `parsedAmount < 0` triggers `NEGATIVE_AMOUNT` check.

**Handling policy:** Flagged with default action `import_as_refund`. Imported as an `Expense`
with `is_refund = true` and the absolute amount stored. The balance engine inverts the sign when
processing refunds: payer's balance decreases, split participants' balances increase.

**Schema coverage:** `is_refund BOOLEAN DEFAULT FALSE` on `expenses`. The `CHECK(amount <> 0)`
constraint allows negatives (only disallows exactly zero).

---

### ANOMALY 12 — ZERO_AMOUNT

**Row(s):** Row 31

**What it is:** "Dinner order Swiggy" with amount = 0. Note says "counted twice earlier - fixing
later." This is a void/placeholder entry.

**Detection method:** `parsedAmount === 0` triggers `ZERO_AMOUNT` check.

**Handling policy:** Flagged with the only option `skip`. Zero-amount expenses are meaningless
for balance calculations and indicate the user intended to delete or correct this row later.

**Schema coverage:** `CHECK(amount <> 0)` on `expenses` would reject this at the DB level
regardless — the importer catches it first and presents a cleaner user-facing message.

---

### ANOMALY 13 — UNPARSEABLE_DATE / ASSUMED_DATE_YEAR

**Row(s):** Row 27

**What it is:** Date is `"Mar-14"` — month abbreviation + day with no year.

**Detection method:** `parseDate` tries all known formats in order. `"Mar-14"` matches the
`/^([A-Za-z]{3})-(\d{1,2})$/` pattern. This returns `{ date, format: 'MON-DD', assumedYear: 2026 }`.

**Handling policy:** Flagged as `ASSUMED_DATE_YEAR` (not `UNPARSEABLE_DATE`) with default action
`import`. The assumed year (current year at time of import) is shown to the user. They can accept
or skip. The imported date is 14 March 2026.

**Schema coverage:** `date DATE NOT NULL` on `expenses`. The importer validates the date parses
to a real calendar date before submitting.

---

### ANOMALY 14 — AMBIGUOUS_DATE

**Row(s):** Row 34

**What it is:** Date is `"04-05-2026"`. This could mean April 5 (DD-MM) or May 4 (MM-DD).
The note says "is this April 5 or May 4? format is a mess."

**Detection method:** `isAmbiguousDate` checks if both `d1 ≤ 12` AND `d2 ≤ 12`, meaning either
value could be a valid day or month. Both 4 and 5 satisfy this.

**Handling policy:** Flagged as `AMBIGUOUS_DATE` with both interpretations shown:
- `use_dd_mm` → April 5, 2026 (default)
- `use_mm_dd` → May 4, 2026

We default to DD-MM-YYYY since that is the format used throughout the rest of the CSV.
The `import_logs` table records which interpretation was chosen.

**Schema coverage:** `import_logs.anomaly_type` records `AMBIGUOUS_DATE`. The chosen date is
stored in `expenses.date`.

---

### ANOMALY 15 — MISSING_CURRENCY

**Row(s):** Row 28

**What it is:** Currency field is empty (NaN in pandas, blank in CSV). Note says "forgot to
set currency."

**Detection method:** `!row.currency?.trim()` triggers `MISSING_CURRENCY` check.

**Handling policy:** Flagged with options `assume_inr` (default) or `skip`. All other expenses
in the CSV are INR or USD; the context (domestic groceries) makes INR the safe assumption.
Exchange rate is set to 1.0.

**Schema coverage:** `currency Currency NOT NULL DEFAULT 'INR'` — the DB would default to INR
anyway, but the importer surfaces this to the user rather than silently defaulting.

---

### ANOMALY 16 — USD_NO_EXCHANGE_RATE

**Row(s):** Rows 20, 21, 23, 26

**What it is:** Four expenses from the Goa trip are in USD. The CSV has no exchange rate column.
The note on Row 20 says "booked on intl site."

| Row | Description | USD Amount |
|-----|-------------|------------|
| 20  | Goa villa booking | $540 |
| 21  | Beach shack lunch | $84 |
| 23  | Parasailing | $150 |
| 26  | Parasailing refund | -$30 |

**Detection method:** `row.currency?.toUpperCase() === 'USD'` triggers `USD_NO_EXCHANGE_RATE`.

**Handling policy:** Flagged with default action `apply_rate`. A live exchange rate is fetched
from `api.frankfurter.app/latest?from=USD&to=INR` at preview time. If the API is unavailable, the
fallback rate of ₹83.50 per USD is used. The rate used is stored permanently in
`expenses.exchange_rate` and `expenses.amount_inr`. Historical balances never change even if the
rate changes later.

**Schema coverage:** `exchange_rate DECIMAL(10,4)` and `amount_inr DECIMAL(12,2)` on `expenses`.
All balance calculations use `amount_inr`.

---

### ANOMALY 17 — UNKNOWN_MEMBER (guest user)

**Row(s):** Row 23

**What it is:** `split_with` includes `"Dev's friend Kabir"`. Kabir is not a registered user.
The note says "Kabir joined for the day."

**Detection method:** `resolveMemberName("Dev's friend Kabir", groupMembers)` finds no exact
match and no Levenshtein match within distance 2. Triggered as `UNKNOWN_MEMBER_IN_SPLIT`.

**Handling policy:** Flagged with options `create_guest_user`, `remove_from_split` (default),
or `skip`. The default removes Kabir from the split — the ₹150 parasailing cost is then divided
among Aisha, Rohan, Priya, and Dev only. If `create_guest_user` is chosen, a User record with
`is_guest = true` would be created.

**Schema coverage:** `is_guest BOOLEAN DEFAULT FALSE` on `users` supports guest participants.

---

### ANOMALY 18 — INACTIVE_MEMBER_IN_SPLIT

**Row(s):** Rows 36, 39, 40, 41, 42, 43 (Meera in April); Rows 38–43 (Sam before April 15)

**What it is:**
- **Meera left March 31.** Row 36 (02-04-2026 Groceries) lists Meera in `split_with`. Note:
  "oops Meera still in the group list." Sam appears correctly in April rows.
- **Sam joined April 15.** Rows 39 (10-04-2026), 40 (12-04-2026) include Sam before his join date.

**Detection method:** For each name in `split_with`, the importer looks up the membership record
and checks: `membership.joinedAt <= expenseDate && (membership.leftAt === null || membership.leftAt >= expenseDate)`.
If false, the member is inactive on that date.

**Handling policy:** Flagged as `INACTIVE_MEMBER_IN_SPLIT` with default action `remove_inactive`.
The inactive member is dropped from the split and the remaining active members share the cost.
This directly addresses Sam's request: "I moved in mid-April. Why would March electricity affect
my balance?"

**Schema coverage:** `joined_at DATE NOT NULL` and `left_at DATE NULL` on `group_memberships`.
The balance engine also enforces this: only active members on the expense date contribute to
balance calculations.

---

### ANOMALY 19 — EARLY_MEMBER (expense before join date)

**Row(s):** Row 2–33 for Sam (if Sam's membership joins April 15)

**What it is:** Sam's join date is April 15. Any expense that lists Sam in `split_with` before
April 15 should exclude him.

**Detection method:** Same as INACTIVE_MEMBER — `joinedAt <= expenseDate` check in
`getActiveMembersOnDate()`.

**Handling policy:** Same as INACTIVE_MEMBER — `remove_inactive` removes Sam from pre-April-15
splits. The balance engine independently enforces this for `EQUAL` splits by calling
`getActiveMembersOnDate()` at import confirmation time.

**Schema coverage:** `joined_at DATE NOT NULL` on `group_memberships`.

---

### ANOMALY 20 — NONSTANDARD_SPLIT_TYPE

**Row(s):** Row 14 (empty split_type)

**What it is:** `split_type` is blank (NaN in CSV) on the settlement row.

**Detection method:** The `normalizeSplitType()` helper maps CSV values to internal enum values.
An empty/unrecognised split_type passes through as-is, which would fail the Prisma enum check.

**Handling policy:** Rows with empty `split_type` that are also flagged as `SETTLEMENT_AS_EXPENSE`
are rerouted to settlement creation (which has no split_type). For any non-settlement row with
a blank split_type, the row is flagged and the user must choose an action.

**Schema coverage:** `split_type SplitType NOT NULL` with enum `EQUAL | EXACT | PERCENTAGE | RATIO`.
The DB rejects any other value.

---

### ANOMALY 21 — LIKELY_SETTLEMENT (deposit)

**Row(s):** Row 38

**What it is:** "Sam deposit share" — Sam paid Aisha ₹15,000. Note: "Sam moving in! paid Aisha
his deposit." `split_with` contains only Aisha. This is a deposit transfer, not a shared expense.

**Detection method:** `"deposit share"` is in the settlement keyword list AND `split_with` has
only one person AND `split_type = equal` (a two-person "equal" is structurally a payment).
Both keyword and structural checks fire.

**Handling policy:** Flagged as `SETTLEMENT_AS_EXPENSE` with default `import_as_settlement`.
A `Settlement` record is created: payer = Sam, payee = Aisha, amount = ₹15,000.

**Schema coverage:** Dedicated `settlements` table.

---

### ANOMALY 22 — CONTRADICTORY_SPLIT_DATA

**Row(s):** Row 42

**What it is:** "Furniture for common room" — `split_type` is `equal` but `split_details` field
contains share data (`"Aisha 1; Rohan 1; Priya 1; Sam 1"`). The note says "split_type says equal
but someone added shares anyway."

**Detection method:** The importer parses `split_details` and checks for contradiction: if
`split_type = EQUAL` but share values are present, the detail values are ignored and a true
equal split is computed.

**Handling policy:** The `split_type` field is the authority. `split_details` is treated as
metadata/annotation. The equal split is applied (₹12,000 / 4 = ₹3,000 each). No anomaly flag
is raised — this is a silent auto-resolution with the decision logged.

**Schema coverage:** Handled at the application layer. The DB stores the resolved split amounts
in `expense_splits.amount_owed`.

---

## Part 2: Database Schema

### Entity Relationship Summary

```
User
 ├── created Groups (1:many via createdById)
 ├── GroupMembership (many:many bridge to Group)
 ├── Expense.paidBy (1:many — expenses they paid)
 ├── ExpenseSplit (1:many — their share in each expense)
 ├── Settlement.payer (1:many)
 └── Settlement.payee (1:many)

Group
 ├── GroupMembership (membership records with dates)
 ├── Expense (all expenses in this group)
 └── Settlement (all settlements in this group)

Expense
 └── ExpenseSplit (one per participant)

ImportLog (audit trail, not linked to Group)
```

---

### Table: `users`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | VARCHAR(100) | NOT NULL |
| email | VARCHAR(255) | UNIQUE NOT NULL |
| password_hash | VARCHAR(255) | NOT NULL |
| is_guest | BOOLEAN | DEFAULT FALSE |
| created_at | TIMESTAMP | DEFAULT NOW() |

**Purpose:** Registered users and guest participants (e.g. Kabir).
`is_guest = true` users can appear in splits but cannot log in.

---

### Table: `groups`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | VARCHAR(100) | NOT NULL |
| created_by | UUID | FK → users(id) |
| created_at | TIMESTAMP | DEFAULT NOW() |

---

### Table: `group_memberships`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| user_id | UUID | FK → users(id) ON DELETE CASCADE |
| group_id | UUID | FK → groups(id) ON DELETE CASCADE |
| joined_at | DATE | NOT NULL |
| left_at | DATE | NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

**Constraints:**
- `CHECK(left_at IS NULL OR left_at >= joined_at)` — left date must be on or after join date.
- Partial unique index: `UNIQUE(user_id, group_id) WHERE left_at IS NULL` — only one active
  membership per user per group at a time. Users can leave and rejoin (each creates a new row).

**Why this design:** Storing `joined_at` and `left_at` per membership row allows the balance
engine to answer "who was active on this date?" for any historical expense, even after membership
changes.

---

### Table: `expenses`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| group_id | UUID | FK → groups(id) ON DELETE CASCADE |
| description | VARCHAR(255) | NOT NULL |
| amount | DECIMAL(12,2) | NOT NULL, CHECK(amount <> 0) |
| currency | Currency enum | NOT NULL, DEFAULT 'INR' |
| exchange_rate | DECIMAL(10,4) | NOT NULL, DEFAULT 1.0, CHECK(> 0) |
| amount_inr | DECIMAL(12,2) | NOT NULL |
| paid_by_id | UUID | FK → users(id), NOT NULL |
| date | DATE | NOT NULL |
| split_type | SplitType enum | NOT NULL |
| is_refund | BOOLEAN | DEFAULT FALSE |
| is_settlement | BOOLEAN | DEFAULT FALSE |
| notes | TEXT | NULL |
| imported_row_hash | VARCHAR(64) | NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

**Enums:**
- `Currency`: `INR | USD | EUR | GBP`
- `SplitType`: `EQUAL | EXACT | PERCENTAGE | RATIO`

**Partial unique index:** `UNIQUE(group_id, imported_row_hash) WHERE imported_row_hash IS NOT NULL`
— prevents re-importing the same CSV row twice. The hash is computed as MD5 of
`date|description.toLowerCase().trim()|amountINR|paidById`.

**Why `amount_inr` is stored separately:** The exchange rate used at import time is locked in
permanently. If USD/INR moves from ₹83.50 to ₹86.00 next month, historical expenses do not
change. All balance calculations use `amount_inr`.

---

### Table: `expense_splits`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| expense_id | UUID | FK → expenses(id) ON DELETE CASCADE |
| user_id | UUID | FK → users(id) |
| amount_owed | DECIMAL(12,2) | NOT NULL |

**Purpose:** One row per participant per expense. `amount_owed` is always in INR and always sums
to the parent expense's `amount_inr` (enforced by the split calculator's floor-then-remainder
rounding rule).

---

### Table: `settlements`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| group_id | UUID | FK → groups(id) ON DELETE CASCADE |
| payer_id | UUID | FK → users(id) |
| payee_id | UUID | FK → users(id) |
| amount | DECIMAL(12,2) | NOT NULL, CHECK(amount > 0) |
| date | DATE | NOT NULL |
| notes | TEXT | NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

**Purpose:** Records actual money transfers between members, separate from shared expenses.
The balance engine adds settlements after processing all expenses. Settlements cannot be negative
(use an expense with `is_refund = true` for refunds).

---

### Table: `import_logs`

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| session_id | UUID | NOT NULL |
| row_number | INT | NULL |
| raw_data | TEXT | NULL |
| anomaly_type | VARCHAR(50) | NULL |
| action_taken | VARCHAR(50) | NULL |
| status | ImportStatus enum | NOT NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

**Enum:** `ImportStatus`: `IMPORTED | SKIPPED | ERRORED | IMPORTED_AS_SETTLEMENT`

**Purpose:** Every row of every import is logged here with the anomaly type detected, the action
the user chose, and the final outcome. Grouped by `session_id` (one UUID per import run) for
per-session reporting.

---

### Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `expenses(group_id)` | Standard | Filter expenses by group — used on every group page load |
| `expenses(date)` | Standard | Range queries for date-based filtering |
| `expense_splits(expense_id)` | Standard | Load all splits for an expense |
| `expense_splits(user_id)` | Standard | Load all splits for a user (balance calculation) |
| `import_logs(session_id)` | Standard | Retrieve all rows from a specific import session |
| `group_memberships(user_id, group_id)` | Standard | Membership lookups |
| `expenses(group_id, imported_row_hash) WHERE imported_row_hash IS NOT NULL` | Partial unique | Duplicate import prevention |
| `group_memberships(user_id, group_id) WHERE left_at IS NULL` | Partial unique | One active membership per user per group |

---

### Split Calculator — Rounding Rule

All four split types use the same rounding rule to guarantee `SUM(amount_owed) == amount_inr`
exactly:

1. Calculate each person's raw share as a full-precision float.
2. Floor each value to 2 decimal places: `Math.floor(v * 100) / 100`.
3. Compute `remainder = Math.round((total - sum(floored)) * 100) / 100`.
4. Add the remainder to the **last person** in the array.

This means one person (always the last) absorbs any rounding delta (max ±1 paisa per split).
This is the same algorithm used by Splitwise and most financial applications.

---

### Balance Calculation — How It Works

For each group member, net balance is:

```
net_balance = (sum of amount_inr for expenses they paid, excluding settlements)
            - (sum of amount_owed from expense_splits where they are a participant)
            + (sum of settlements they paid out)
            - (sum of settlements they received)
```

Positive balance → the group owes them money.  
Negative balance → they owe the group money.

Debt simplification uses a greedy algorithm: sort creditors (positive) and debtors (negative),
pair the largest creditor with the largest debtor, transfer the minimum of the two, repeat.
This minimises the number of transactions needed to settle all debts.

**Membership awareness:** An expense only affects a member's balance if they were active on
the expense date (`joinedAt <= date AND (leftAt IS NULL OR leftAt >= date)`). This is enforced
both in the balance endpoint (`GET /api/groups/:groupId/balances`) and in the import confirm
route when computing EQUAL splits.