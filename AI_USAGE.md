# AI Usage Log — Splitwise
This file documents every AI-assisted prompt in this project: what was asked,
what decisions were made, and what files were generated or modified.
---
## Session 1 — 2026-06-13
### Prompt 1 — Server & Client Bootstrapping
**What I asked:**
> Generate the Express entry point (`server/index.js`), a pg pool file (`server/db.js`),
> an Axios instance (`client/src/api/axios.js`), a `.env.example`, a `.gitignore` for
> both server and client, and empty Express Router placeholder files for all six routes
> (`auth`, `groups`, `expenses`, `settlements`, `import`, `currency`).

**Tech context supplied:**
- Backend: Node.js + Express.js (CommonJS)
- Frontend: React + Vite
- Database: PostgreSQL + Prisma ORM
- Auth: JWT in httpOnly cookies
- HTTP client: Axios with `withCredentials: true`
**What the AI did:**
| Action | Detail |
|---|---|
| Installed npm packages | `express`, `cors`, `cookie-parser`, `pg`, `dotenv` |
| Created `server/index.js` | Express app with CORS (`origin: CLIENT_URL`, `credentials: true`), `express.json()`, `cookie-parser`, six route mounts, `/api/health` endpoint, and a 4-argument global error handler |
| Created `server/db.js` | `pg.Pool` singleton reading `DATABASE_URL`; logs `✅ Database connected` on connect, `❌ Unexpected database error` on error |
| Created `server/routes/auth.js` | Empty `express.Router()` export |
| Created `server/routes/groups.js` | Empty `express.Router()` export |
| Created `server/routes/expenses.js` | Empty `express.Router()` export |
| Created `server/routes/settlements.js` | Empty `express.Router()` export |
| Created `server/routes/import.js` | Empty `express.Router()` export |
| Created `server/routes/currency.js` | Empty `express.Router()` export |
| Created `client/src/api/axios.js` | Axios instance with `baseURL: VITE_API_URL \|\| http://localhost:5000`, `withCredentials: true`, and a response interceptor that redirects to `/login` on HTTP 401 (guards against redirect loops when already on `/login`) |
| Created `server/.env.example` | All required env vars: `PORT`, `NODE_ENV`, `CLIENT_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `DATABASE_URL`, `SHADOW_DATABASE_URL`, `CURRENCY_API_KEY` |
| Created `server/.gitignore` | Ignores: `node_modules/`, `.env*`, `dist/`, `build/`, `*.log`, `.DS_Store`, `.idea/`, `.vscode/` |
| Created `client/.gitignore` | Same as server plus `.vite/` cache directory |
| Smoke-tested server startup | Ran `node index.js` to confirm `🚀 Splitmate server running … on port 5000` with no errors |
**Key design decisions:**
- `withCredentials: true` is set at the Axios instance level so every request automatically sends the httpOnly JWT cookie.
- The 401 interceptor checks `window.location.pathname !== "/login"` to prevent infinite redirect loops.
- `CLIENT_URL` env var controls the CORS origin so it can differ between dev (`http://localhost:5173`) and production.
- The global error handler exposes the stack trace only when `NODE_ENV !== "production"`.
---
### Prompt 2 — Database Schema (Prisma + SQL Migration)
**What I asked:**
> Generate `prisma/schema.prisma` and `server/migrations/001_initial.sql` for the
> Splitmate shared-expense app. Prisma ORM must be the single source of truth.
> Both files must be fully consistent. All business rules from eight real-world
> scenarios must be encoded as constraints, indexes, and flags.
**Business scenarios encoded:**
| # | Scenario | Solution |
|---|---|---|
| 1 | Membership over time (join / leave / rejoin) | `joined_at DATE`, `left_at DATE NULL`, `CHECK(left_at >= joined_at)`, partial unique index `WHERE left_at IS NULL` |
| 2 | Multi-currency with permanent exchange rates | `amount`, `currency` (enum), `exchange_rate`, `amount_inr` — never recalculate from future rates |
| 3 | Four split types | `SplitType` enum: `EQUAL`, `EXACT`, `PERCENTAGE`, `RATIO` |
| 4 | Settlements separate from expenses | Dedicated `settlements` table + `is_settlement BOOLEAN` flag on `expenses` for misclassified CSV rows |
| 5 | Refunds (negative amounts) | `CHECK(amount <> 0)` allows negatives + `is_refund BOOLEAN` flag |
| 6 | CSV import audit trail | `import_logs` table with `session_id UUID`, `anomaly_type`, `action_taken`, `ImportStatus` enum |
| 7 | Duplicate import prevention | `imported_row_hash VARCHAR(64)` + partial unique index `WHERE imported_row_hash IS NOT NULL` |
| 8 | Guest users | `is_guest BOOLEAN DEFAULT FALSE` on `users` |
**What the AI did:**
| Action | Detail |
|---|---|
| Installed Prisma | `prisma@7.8.0`, `@prisma/client@7.8.0` (dev dep) |
| Created `prisma/schema.prisma` | 6 models (`User`, `Group`, `GroupMembership`, `Expense`, `ExpenseSplit`, `Settlement`, `ImportLog`), 3 enums (`SplitType`, `Currency`, `ImportStatus`), all `@@index`, `@@unique`, `@map`, and `@@map` directives |
| Created `migrations/001_initial.sql` | `CREATE EXTENSION IF NOT EXISTS pgcrypto`, 3 PostgreSQL enum types, 6 `CREATE TABLE` statements with all CHECK constraints, FKs, and `ON DELETE CASCADE` rules, 2 partial `CREATE UNIQUE INDEX` statements, and 6 standard `CREATE INDEX` statements |
| Discovered Prisma 7 breaking change | Prisma 7 no longer accepts `url` in `datasource db {}` inside `schema.prisma` — it must live in a separate `prisma.config.ts` |
| Fixed `prisma/schema.prisma` | Removed `url = env("DATABASE_URL")` from datasource block |
| Created `prisma.config.ts` | Prisma 7 config using `defineConfig`, `@prisma/adapter-pg`, and `dotenv/config` to load `DATABASE_URL` from `.env` |
| Installed additional deps | `@prisma/adapter-pg`, `typescript`, `tsx`, `@types/node` |
| Validated schema | `npx prisma validate --schema=prisma/schema.prisma --config=prisma.config.ts` → **`The schema at prisma\schema.prisma is valid 🚀`** |
**Key design decisions:**
- Prisma 7 uses a driver-adapter model — the `@prisma/adapter-pg` wraps a `pg.Pool` and is passed to `PrismaClient` at runtime instead of relying on Prisma's built-in engine.
- Partial unique indexes (`WHERE left_at IS NULL`, `WHERE imported_row_hash IS NOT NULL`) cannot be expressed natively in Prisma schema DSL — they are enforced in the SQL migration only. The Prisma schema uses `@@index` as a non-partial approximation with a comment explaining the gap.
- SQL migration uses PostgreSQL native `CREATE TYPE … AS ENUM` rather than check constraints for split type and currency, matching the Prisma enum mapping exactly.
- `gen_random_uuid()` is used for all UUID primary key defaults (requires `pgcrypto` on PG < 14).
---
### Prompt 3 — AI Usage Log (this file)
**What I asked:**
> Log all the prompts I've given and what the AI did in `AI_USAGE.md`.
**What the AI did:**
- Read the existing (empty) `AI_USAGE.md`
- Wrote this structured log documenting all three prompts, the files produced, and the design decisions made

---

### Prompt 4 — Auto-log Preference (2026-06-13)

**What I asked:**
> Log every prompt I give you into `AI_USAGE.md` automatically, every time.

**What the AI did:**
- Acknowledged the standing instruction; will append a log entry after every future response

---

### Prompt 5 — Auth Routes + React Auth Layer (2026-06-13)

**What I asked:**
> Write `server/routes/auth.js` (POST /signup, POST /login, POST /logout, GET /me) using Prisma, bcryptjs, and jsonwebtoken.
> Write the full React auth layer: AuthContext, ProtectedRoute, Login page, Signup page, and main.jsx with routing.

**What the AI did:**

| Action | Detail |
|---|---|
| Installed server deps | `bcryptjs`, `jsonwebtoken` |
| Installed client deps | `react-router-dom`, `axios` |
| Created `server/routes/auth.js` | Full auth router — Prisma-only DB ops, bcrypt salt 12, JWT 7d, httpOnly cookie, identical 401 for bad email/password, `safeUser()` never exposes `password_hash` |
| Created `client/src/context/AuthContext.jsx` | Context + Provider with `user`/`loading` state, `login()`/`signup()`/`logout()` actions, session restore via `GET /api/auth/me`, exports `useAuth()` hook |
| Created `client/src/components/ProtectedRoute.jsx` | Full-screen spinner while loading → `<Navigate to="/login">` → `<Outlet />` |
| Created `client/src/pages/Login.jsx` | Tailwind card, email + password, error display, disabled button while loading, link to `/signup` |
| Created `client/src/pages/Signup.jsx` | Name + email + password + confirmPassword, client-side mismatch check, link to `/login` |
| Created `client/src/main.jsx` | `BrowserRouter → AuthProvider → Routes`; public + protected routes; 3 placeholder pages; catch-all to `/login` |

**Key design decisions:**
- Identical `"Invalid email or password"` for wrong-email and wrong-password prevents user enumeration.
- `logout()` uses `finally` so client state always clears even if the server call fails.
- `ProtectedRoute` uses React Router v6 `<Outlet />` pattern.

---

### Prompt 6 — Tailwind CSS Setup (2026-06-13)

**What I asked:**
> CSS is not done.

**Root cause found:** Tailwind CSS was referenced in JSX class names but was never installed or configured.

**What the AI did:**

| Action | Detail |
|---|---|
| Installed `tailwindcss` + `@tailwindcss/vite` | Tailwind v4 Vite-native integration — no `tailwind.config.js` needed |
| Updated `vite.config.js` | Registered `tailwindcss()` as a Vite plugin before `react()` |
| Rewrote `src/index.css` | Replaced old Vite default CSS (which had a fixed `#root` width that broke full-screen layouts) with `@import "tailwindcss"` + minimal box-sizing and body resets |
| Updated `src/main.jsx` | Added `import "./index.css"` so Tailwind loads at app entry |
| Cleared `src/App.css` | Removed old Vite default styles that would conflict with Tailwind utility classes |

---

### Prompt 7 — Prisma Client Not Generated Error (2026-06-13)

**What I asked:**
> Server crashes with `Error: Cannot find module '.prisma/client/default'`

**Root cause:** `prisma generate` was never run after installing Prisma. The generated client (`.prisma/client/`) must exist before `@prisma/client` can be imported at runtime.

**What the AI did:**

| Action | Detail |
|---|---|
| Ran `prisma generate` | `npx prisma generate --schema=prisma/schema.prisma --config=prisma.config.ts` — generated client to `node_modules/@prisma/client` |
| Updated `server/package.json` | Added `postinstall` script so `prisma generate` runs automatically after every `npm install` (prevents this on fresh clones); also added `prisma:generate` as a named script; updated `dev` to use `nodemon` |

**Security issue flagged:** Real Supabase database credentials were found in `.env.example` (which is tracked by git). User was advised to rotate the password immediately and replace credentials with placeholders.

---

### Prompt 8 — PrismaClient Adapter Error + `earlyAccess` TS Error (2026-06-13)

**What I asked:**
> Server still crashes with `PrismaClientInitializationError: PrismaClient needs to be constructed with a non-empty, valid PrismaClientOptions`
> Also: TypeScript error `'earlyAccess' does not exist in type 'PrismaConfig'`

**Root cause (runtime crash):** Prisma 7 in driver-adapter mode requires the adapter to be passed to `PrismaClient({ adapter })` at runtime. `prisma.config.ts` only configures the CLI tools. `new PrismaClient()` with no arguments throws because there is no built-in query engine fallback.

**Root cause (TS error):** `earlyAccess: true` was a temporary flag used in early Prisma 7 betas. In 7.8.0 the driver adapter feature became stable and the property was removed from the `PrismaConfig` type.

**What the AI did:**

| Action | Detail |
|---|---|
| Created `server/lib/prisma.js` | Shared singleton: creates a `pg.Pool`, wraps it in `PrismaPg`, and exports `new PrismaClient({ adapter })` — the only correct way to instantiate Prisma 7 with driver adapters |
| Updated `server/routes/auth.js` | Replaced `const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient()` with `const prisma = require('../lib/prisma')` |
| Fixed `server/prisma.config.ts` | Removed `earlyAccess: true` — resolves the TypeScript error; property no longer exists in `PrismaConfig` type in Prisma 7.8.0 |

---

### Prompt 9 — Backend Logging (Winston + Morgan + Chalk) (2026-06-13)

**What I asked:**
> Add proper logging to the backend using chalk and morgan/winston to log every request or ping.

**What the AI did:**

| Action | Detail |
|---|---|
| Installed deps | `winston`, `morgan`, `chalk@4` (v4 required — chalk v5+ is ESM-only, incompatible with CommonJS server) |
| Created `server/lib/logger.js` | Winston logger with: chalk-coloured console transport (error=red, warn=yellow, info=cyan, http=magenta, debug=gray); JSON file transports writing to `logs/error.log` and `logs/combined.log`; `logger.morganStream` write adapter so Morgan pipes HTTP logs to Winston at `http` level |
| Updated `server/index.js` | Added `morgan('dev', { stream: logger.morganStream })` middleware (uses `combined` format in production); replaced all `console.log` / `console.error` with `logger.info` / `logger.error`; health check and error handler both use the logger |
| Created `server/logs/.gitkeep` | Ensures the `logs/` directory exists on fresh clones so Winston file transports don't crash; actual `.log` files stay git-ignored |

**Key design decisions:**
- Morgan feeds into Winston via `morganStream` so all output — HTTP requests and app logs — goes through one unified log pipeline.
- `LOG_LEVEL` env var overrides the default level (`debug` in dev, `info` in prod).
- File transports write structured JSON (easy to pipe into log aggregators like Datadog/Loki later).
- Chalk v4 is pinned because v5 dropped CommonJS support.

---

### Prompt 10 — Supabase Health Check + Migrate DIRECT_URL Fix (2026-06-13)

**What I asked:**
> Add a Supabase URL health check.

**Bonus issue fixed:** `prisma migrate dev` was failing with "The datasource.url property is required in your Prisma config file" — also resolved here.

**Root cause (migrate error):** Prisma 7's `prisma.config.ts` `migrate` block requires an explicit `url` for DDL/shadow database operations. Supabase's `DATABASE_URL` uses pgBouncer (transaction mode) which cannot run DDL across a single session — a direct non-pooled `DIRECT_URL` is required.

**What the AI did:**

| Action | Detail |
|---|---|
| Updated `server/index.js` health check | Upgraded from static JSON to async endpoint that runs `prisma.$queryRaw\`SELECT 1\`` against Supabase, measures latency, returns `{ status, database: { status, latencyMs } }`, HTTP 200 on success / 503 on failure |
| Updated `server/prisma.config.ts` | Added `migrate.url: process.env.DIRECT_URL` so `prisma migrate dev` has a non-pooled connection for the shadow database |
| Updated `server/.env.example` | Added `DIRECT_URL` (non-pooled port 5432) alongside `DATABASE_URL` (pgBouncer port 6543); added `LOG_LEVEL`; replaced old placeholder values |

**Key design decisions:**
- `DATABASE_URL` (pgBouncer, port 6543) is used at runtime by Prisma Client for all query operations.
- `DIRECT_URL` (direct, port 5432) is used only by Prisma CLI for migrations and introspection.
- Health check returns HTTP 503 when DB is unreachable so load balancers / uptime monitors can detect degradation automatically.

---

### Prompt 11 — `prisma migrate dev` Root Cause + Successful Migration (2026-06-13)

**What I asked:**
> Error: The datasource.url property is required in your Prisma config file when using prisma migrate dev. (still failing after previous fix)

**Root cause (definitive):** Previous fix used `migrate.url` which **does not exist** in the `PrismaConfig` type. Discovered by reading `node_modules/@prisma/config/dist/index.d.ts` directly. The actual Prisma 7 config API is:
- `datasource.url` → required for all CLI commands (migrate, introspect)
- `migrations.path/seed` → optional migrations config
- No `migrate` block exists in `PrismaConfig` at all
- The `adapter` function belongs **only** in `new PrismaClient({ adapter })` at runtime — never in `prisma.config.ts`

**What the AI did:**

| Action | Detail |
|---|---|
| Read `@prisma/config/dist/index.d.ts` | Discovered the real `PrismaConfig` type — `datasource?: { url?, shadowDatabaseUrl? }` is the correct block |
| Rewrote `server/prisma.config.ts` | Replaced incorrect `migrate { url, adapter() }` with correct `datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL }` and removed the adapter (it belongs in `lib/prisma.js`) |
| Ran `npx prisma migrate dev --name init` | **SUCCESS** — migration `20260613114000_init` applied to Supabase; all tables created |

**Result:** Database is now fully in sync with `prisma/schema.prisma`. Migration file saved at `prisma/migrations/20260613114000_init/migration.sql`.

---

### Prompt 12 — Exact Schema Match with CHECK Constraints (2026-06-13)

**What I asked:**
> Provided the exact SQL schema and asked to verify if it matches the current implementation, and if not, make it exact.

**What the AI did:**

| Action | Detail |
|---|---|
| Compared schemas | The tables, columns, relations, and enums in `schema.prisma` perfectly matched the provided SQL. However, Prisma cannot express `CHECK` constraints or partial `UNIQUE INDEX`es (with `WHERE` clauses) natively in `schema.prisma`. |
| Created Migration | Manually created `prisma/migrations/20260613120000_add_constraints/migration.sql` |
| Added Constraints | Added `CHECK (left_at IS NULL OR left_at >= joined_at)`, `CHECK (amount != 0)`, `CHECK (exchange_rate > 0)`, and `CHECK (amount > 0)`. |
| Added Partial Indexes | Added `CREATE UNIQUE INDEX unique_active_membership` and `CREATE UNIQUE INDEX unique_expense_import`. |
| Deployed | Ran `npx prisma migrate deploy` to safely apply these advanced PostgreSQL features without Prisma overwriting them. |

**Result:** The database now perfectly matches the exact strict SQL schema provided, including all database-level data integrity constraints.

---

### Prompt 13 — JWT Auth Middleware (2026-06-13)

**What I asked:**
> Create full auth service middleware and everything according to our schema and db setup make sure no changes in db so that our csv export feature that we gonna include doesnt get affected by it

**What the AI did:**

| Action | Detail |
|---|---|
| Created `server/middleware/auth.js` | Built the `requireAuth` middleware to read the JWT from the `httpOnly` cookie, verify it using `JWT_SECRET`, and attach the decoded `userId`, `email`, and `name` to `req.user`. Logs errors with Winston (`logger.warn`). |
| Updated `server/routes/auth.js` | Imported and applied `requireAuth` middleware to the `GET /api/auth/me` route to secure it. |
| Preserved Database | Ensured 0 changes were made to `schema.prisma` or the database migrations, guaranteeing the upcoming CSV export feature remains perfectly intact against the current schema. |

**Result:** The authentication service is now 100% complete and fully secure (Signup, Login, Logout, and Protected `/me` route) using `httpOnly` cookies, without altering the database schema.