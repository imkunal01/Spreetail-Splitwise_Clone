# DECISIONS.md — Engineering & Product Decision Log

Every significant decision made during the build of Splitmate, the options considered, and the reasoning behind each choice.

---

## DECISION 1 — ORM Choice: Prisma 7 over raw pg

**Context:** The project requires PostgreSQL. The backend needed a maintainable database layer that would support schema evolution, relations, and safer query handling.

**Options considered:**

| Option       | Pros                                                                                       | Cons                                                                           |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Raw `pg`     | Maximum control, direct SQL, no abstraction overhead                                       | Manual query construction, more boilerplate, higher chance of runtime mistakes |
| Knex.js      | Flexible query builder, lightweight                                                        | Still requires more manual work for model structure and migrations             |
| **Prisma 7** | Type-safe client, schema as source of truth, built-in migration system, readable relations | More setup, Prisma 7 breaking changes around config and adapter usage          |

**Decision:** Prisma 7 with the `@prisma/adapter-pg` driver adapter.

**Reason:** The project benefits from readable database access, generated types, and a schema-first workflow. That makes the code easier to reason about during development and grading. Prisma 7 also fits the project’s need for strongly defined relations such as users, groups, memberships, expenses, splits, settlements, and import logs.

**Key discovery during build:** Prisma 7 required careful configuration in `prisma.config.ts` and explicit adapter-based client initialization in `Server/lib/prisma.js`.

---

## DECISION 2 — Source of Truth: Prisma schema first, SQL migration second

**Context:** The assignment expected a consistent relational model with real constraints, indexes, defaults, and checks.

**Options considered:**

* Write SQL first and mirror it in Prisma.
* Write Prisma first and generate SQL from it.
* Maintain both manually.

**Decision:** Prisma schema as the main source of truth, with a matching SQL migration kept in sync.

**Reason:** Prisma makes the application layer safer and clearer, while the SQL migration captures the exact database behavior. Keeping both aligned reduces ambiguity and makes schema changes easier to review.

**Why this mattered:** The project had several business rules that needed to live in the database itself, not just in application code.

---

## DECISION 3 — Auth: JWT in httpOnly Cookies vs localStorage

**Context:** The app needed persistent login state across refreshes while keeping credentials reasonably safe.

**Options considered:**

| Option              | Pros                                                | Cons                                                    |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| localStorage        | Easy to implement                                   | Exposed to JavaScript and vulnerable to XSS token theft |
| **httpOnly cookie** | Not accessible to JavaScript, safer for JWT storage | Requires CORS credentials and cookie configuration      |
| Server sessions     | No token in client storage                          | Adds server-side session state and extra infrastructure |

**Decision:** JWT stored in an `httpOnly` cookie.

**Reason:** This is the best balance of simplicity and security for a modern web app. The auth middleware reads the cookie, verifies the JWT, and attaches the user to `req.user`. The frontend Axios instance sends requests with credentials enabled so the cookie is included automatically.

---

## DECISION 4 — Session Restoration: `/api/auth/me` on startup

**Context:** The user should remain logged in after refresh if the auth cookie is still valid.

**Options considered:**

* Store auth state only in React memory.
* Reload user from localStorage.
* Call the backend on app mount.

**Decision:** Use `GET /api/auth/me` on app load through the auth context.

**Reason:** The backend is the authoritative source for session validity. This avoids stale client state and ensures the app can recover from refresh, tab reopen, or partial reloads.

---

## DECISION 5 — Membership Model: row-per-period instead of a single row

**Context:** Group membership changes over time. Meera can leave. Sam can join later. A user may leave and rejoin.

**Options considered:**

| Option                                                 | Description                               |
| ------------------------------------------------------ | ----------------------------------------- |
| One row per user/group with joined and left timestamps | Simpler, but awkward for re-joins         |
| **One row per membership period**                      | Each join creates a new membership record |

**Decision:** One row per membership period.

**Reason:** This model handles historical group membership naturally. It also makes it possible to check whether a person was active on a specific date when expenses are imported or balances are computed.

**Important database rule:** A partial unique index on active memberships prevents duplicate live rows while still allowing re-joins later.

---

## DECISION 6 — Membership Uniqueness Rule: prevent duplicate active memberships only

**Context:** The same user should not be added twice as an active member of the same group, but should be allowed to rejoin after leaving.

**Options considered:**

* Unique constraint on `(user_id, group_id)` permanently.
* No uniqueness constraint.
* Partial unique index only for active rows.

**Decision:** Partial unique index on active rows only.

**Reason:** A permanent unique constraint would block legitimate re-joins. A partial unique index gives exactly the behavior needed: one active membership per user/group at a time, while preserving history.

---

## DECISION 7 — Currency Handling: store exchange rate and INR amount permanently

**Context:** Some imported expenses are in USD or other currencies. Exchange rates change over time.

**Options considered:**

| Option                                                   | Description         | Problem                                 |
| -------------------------------------------------------- | ------------------- | --------------------------------------- |
| Recalculate from live exchange rates                     | Always up to date   | Historical balances change unexpectedly |
| **Store original amount, rate, and INR conversion**      | History stays fixed | Slightly more storage                   |
| Ask the user to enter the conversion manually every time | Very explicit       | Too much friction for users             |

**Decision:** Store `amount`, `currency`, `exchange_rate`, and `amount_inr` permanently on each expense.

**Reason:** Financial records should not change retroactively just because market rates moved. The rate used during import becomes part of the audit trail.

---

## DECISION 8 — Refunds: allow negative amounts instead of banning them

**Context:** Real expenses sometimes include refunds, reversals, or corrections.

**Options considered:**

* Disallow negative expenses.
* Store refunds as separate compensation records.
* Allow negative expense amounts.

**Decision:** Allow negative expense amounts and mark them with `is_refund`.

**Reason:** Refunds are a real part of shared expense history. The system should not force them into a separate unnatural flow. Marking them explicitly also makes later reporting and balance interpretation easier.

---

## DECISION 9 — Settlements: separate table vs treating them as expenses

**Context:** A settlement is not a shared expense. It is a transfer between two people to settle balances.

**Options considered:**

| Option                           | Description                       | Problem                        |
| -------------------------------- | --------------------------------- | ------------------------------ |
| Put settlements inside expenses  | Fewer tables                      | Blurs a very different concept |
| **Separate `settlements` table** | Cleanly models balance settlement | Slightly more queries          |

**Decision:** Separate settlements table, with `is_settlement` available on expenses for import fallback behavior.

**Reason:** A settlement has a payer, a payee, an amount, and a date. It does not need split logic. Keeping settlements separate makes the data model cleaner and the reporting more accurate.

---

## DECISION 10 — Split Types: support EQUAL, EXACT, PERCENTAGE, and RATIO

**Context:** The app needs to support multiple ways of dividing an expense.

**Decision:** Support all four split types: `EQUAL`, `EXACT`, `PERCENTAGE`, and `RATIO`.

**Reason:** These four types cover the real-world formats seen in the CSV import and the assignment requirements.

**Implementation note:**

* `EQUAL` divides the expense equally.
* `EXACT` assigns exact rupee amounts.
* `PERCENTAGE` uses percentage shares.
* `RATIO` uses proportional values.

---

## DECISION 11 — Rounding rule: floor then assign the remainder to the last participant

**Context:** Splits often produce repeating decimals. The app must still balance exactly.

**Options considered:**

* Round each share independently.
* Use banker's rounding.
* Floor each share and fix the remainder at the end.

**Decision:** Floor intermediate shares to two decimals and assign the remainder to the final share.

**Reason:** This guarantees the split totals exactly match the expense amount. That is essential for reliable balance calculations.

---

## DECISION 12 — Debt simplification: greedy settlement generation

**Context:** After all expenses and settlements are applied, balances need to be simplified into practical payment suggestions.

**Options considered:**

* Use an optimal min-cost flow algorithm.
* Use a greedy pairing algorithm.

**Decision:** Greedy settlement generation.

**Reason:** The expected group sizes are small, and a greedy approach is simpler, faster to implement, and much easier to explain to users. It produces very good results without unnecessary complexity.

---

## DECISION 13 — Guest users: real user record with `is_guest`

**Context:** CSV imports may include people who are not registered app users, such as a friend who joined one meal or trip.

**Options considered:**

* Ignore unknown people.
* Force every participant to register.
* Store them as guest users.

**Decision:** Store guest participants as user records with `is_guest = true` when needed.

**Reason:** This keeps expense history complete without forcing every participant to be a fully registered account holder. It also avoids losing data during import.

---

## DECISION 14 — CSV import flow: preview then confirm

**Context:** The CSV data can contain many anomalies and ambiguous rows. A single blind import would be risky.

**Options considered:**

* Import immediately after upload.
* Reject bad rows automatically.
* Show a review step first.

**Decision:** Two-step import flow: preview first, confirm later.

**Reason:** The preview stage lets the user inspect anomalies, choose actions, and avoid hidden corrections. This makes the import process transparent and auditable.

**Important design detail:** A `session_id` groups all preview and import actions together.

---

## DECISION 15 — CSV anomaly handling: surface problems instead of silently guessing

**Context:** Real-world CSVs are messy. They may contain unknown names, ambiguous dates, missing currencies, duplicate rows, or settlement-like descriptions.

**Decision:** Detect anomalies explicitly and attach actions to them rather than silently fixing everything.

**Reason:** Financial data should not be altered invisibly. The user needs to see what the system believes is wrong and approve the final result.

**Examples of anomaly handling:**

* Missing payer
* Unknown member in split
* Inactive member in split
* Ambiguous date formats
* USD rows without exchange rate in CSV
* Settlement disguised as expense
* Duplicate row detection

---

## DECISION 16 — Duplicate detection: hash-based prevention with row audit logs

**Context:** Imported expenses can repeat, especially in exported CSVs or after re-import attempts.

**Options considered:**

* Compare rows manually in the application.
* Prevent duplicates with a hash.
* Use only description similarity.

**Decision:** Hash the canonical row data and store the hash with a unique constraint on non-null imported rows.

**Reason:** Hashing gives a deterministic and efficient duplicate check. The database-level uniqueness rule provides an extra layer of safety even if the app logic is bypassed.

---

## DECISION 17 — Import logs: audit every row

**Context:** The import feature needs to be explainable after the fact.

**Decision:** Store row-level import logs with session ID, row number, raw data, anomaly type, action taken, status, and timestamp.

**Reason:** This makes the import trail auditable. If a row was skipped or transformed, the app can later explain exactly what happened.

---

## DECISION 18 — Frontend routing: React Router with protected routes

**Context:** The app has public auth pages and private app pages.

**Options considered:**

* Manual page switching.
* Protected route wrappers.
* Global auth gates in each page.

**Decision:** React Router with a protected route wrapper.

**Reason:** This keeps the routing structure clean and avoids repeating auth checks across pages. It also makes the dashboard, group detail, and import routes easy to control.

---

## DECISION 19 — API client: shared Axios instance with credential support

**Context:** The frontend must talk to the backend using the auth cookie and handle session expiration gracefully.

**Decision:** Use a shared Axios instance with `withCredentials: true` and a 401 interceptor.

**Reason:** This centralizes request behavior and prevents repetitive configuration in each page. The interceptor also makes auth failure behavior consistent across the app.

---

## DECISION 20 — UI approach: Tailwind utility styling over custom CSS-heavy layouts

**Context:** The project needed to move quickly while staying readable and responsive.

**Decision:** Use Tailwind utility classes across the app.

**Reason:** Tailwind made it possible to build responsive cards, forms, modals, skeleton loaders, and tables without creating a large CSS architecture. It also kept the UI consistent across pages.

---

## DECISION 21 — Group dashboard: local append on create instead of refetch

**Context:** After creating a group, the dashboard should update immediately.

**Options considered:**

* Refetch the whole group list.
* Append the created group locally.

**Decision:** Append locally on success.

**Reason:** This gives the user immediate feedback and avoids unnecessary refetching. The server already returned the created group, so there is no reason to wait for a second list request.

---

## DECISION 22 — Group detail: members tab fully functional, expenses tab placeholder

**Context:** The assignment phase focused on group management first. Expense analysis came later.

**Decision:** Keep the expenses tab as a placeholder and fully implement the members tab.

**Reason:** This separated the current scope from the next phase while preserving the structure for future work.

---

## DECISION 23 — Seeder strategy: idempotent seed with upserts

**Context:** The seed script may be run more than once during development.

**Decision:** Use `upsert` for users and guard logic for memberships.

**Reason:** Rerunning the seed should not create duplicates. Idempotent seeds are easier to trust and safer to rerun while debugging.

---

## DECISION 24 — Environment loading in scripts: load dotenv before Prisma initialization

**Context:** The seed script runs outside the Express server, so environment variables are not automatically loaded.

**Decision:** Load `dotenv` before importing the Prisma singleton in scripts.

**Reason:** Prisma needs the database connection available immediately. Loading env vars too late causes connection failures.

---

## DECISION 25 — Manual review over blind AI acceptance

**Context:** The AI generated most of the project structure, but some outputs needed correction.

**Decision:** Every generated file was reviewed manually before acceptance.

**Reason:** AI accelerated development, but the final responsibility for correctness stayed with the developer. This is especially important in a financial app where incorrect logic can affect balances and imported records.

---

## Final Summary

The project was built around a few core principles:

1. Preserve historical truth.
2. Avoid silent data loss.
3. Treat financial data carefully.
4. Make membership time-aware.
5. Keep the database as the real source of truth.
6. Let the user review dangerous import decisions.
7. Use AI as a helper, not a replacement for review.

These decisions shaped the final Splitmate architecture and explain why the implementation is structured the way it is.
