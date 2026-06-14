# AI_USAGE.md — AI Tool Usage Log

**AI tool used:** Gemini (Gemini for Google in VS Code / Android Studio) as primary development
collaborator via an in-IDE agentic planner.

**How it was used:** Kunal authored every prompt (specifications, business rules, exact API
contracts, schema requirements). The AI generated code, ran terminal commands, and edited files
in response. Every prompt is logged below. All code was reviewed before acceptance.

---

## Session 1 — 2026-06-12 / Infrastructure Setup

### Prompt 1 — Server & Client Bootstrapping

**What I asked:**
> Generate `server/index.js`, `server/db.js`, `client/src/api/axios.js`, `.env.example`,
> `.gitignore`, and empty Express Router placeholder files for all six routes: auth, groups,
> expenses, settlements, import, currency.

**Tech context supplied:** Node.js + Express (CommonJS), React + Vite, PostgreSQL + Prisma ORM,
JWT in httpOnly cookies, Axios with `withCredentials: true`.

**What the AI did:**
- Installed: `express`, `cors`, `cookie-parser`, `pg`, `dotenv`
- Created `server/index.js` — CORS, `express.json()`, `cookie-parser`, six route mounts, global error handler
- Created `server/db.js` — `pg.Pool` singleton
- Created `client/src/api/axios.js` — Axios instance with 401 interceptor
- Created all six empty Router stubs
- Smoke-tested with `node -e "require('./index.js')"` — confirmed clean boot

**Key decisions made:**
- `withCredentials: true` at the Axios instance level so every request sends the httpOnly cookie
- 401 interceptor checks `window.location.pathname !== '/login'` to prevent infinite loops
- `CLIENT_URL` env var controls the CORS origin between dev and production

---

### Prompt 2 — Database Schema (Prisma + SQL Migration)

**What I asked:**
> Generate `prisma/schema.prisma` and `server/migrations/001_initial.sql` for Splitwise.
> Both files must be fully consistent. Encode all 8 business scenarios as constraints and indexes.

**Business scenarios encoded:** Membership over time, multi-currency, four split types,
settlements separate from expenses, refunds, CSV import audit, duplicate prevention, guest users.

**What the AI did:**
- Installed: `prisma@7.8.0`, `@prisma/client@7.8.0`
- Generated `prisma/schema.prisma` with 7 models and 3 enums
- Generated `migrations/001_initial.sql` with all `CREATE TABLE`, `CHECK`, FK, and index statements

**AI error caught (#1 — see below)**

---

### Prompt 3 — Prisma 7 Config Fix

**What I asked:**
> Explain what "Object literal may only specify known properties, and 'earlyAccess' does not
> exist in type 'PrismaConfig'" means and fix it.

**What the AI did:**
- Explained that `earlyAccess: true` was a temporary Prisma 7 beta flag, now removed from the type
- Removed the flag from `prisma.config.ts`
- Fixed `lib/prisma.js` to pass the pg adapter to `PrismaClient` at runtime

---

### Prompt 4 — Auth Routes + Frontend Auth Layer

**What I asked:**
> Write `server/routes/auth.js` (POST /signup, POST /login, POST /logout, GET /me),
> `client/src/context/AuthContext.jsx`, `client/src/components/ProtectedRoute.jsx`,
> `client/src/pages/Login.jsx`, `client/src/pages/Signup.jsx`, and `client/src/main.jsx`.

**What the AI did:**
- Installed: `bcryptjs`, `jsonwebtoken` (server), `react-router-dom`, `axios` (client)
- Created all 6 files with full JWT cookie auth, protected routes, and Tailwind forms
- Created `server/middleware/auth.js` for JWT verification

**AI error caught (#2 — see below)**

---

### Prompt 5 — Tailwind CSS Not Working

**What I asked:**
> "css is not done"

**What the AI did:**
- Diagnosed that Tailwind wasn't installed despite classes being used
- Installed `tailwindcss @tailwindcss/vite`
- Updated `vite.config.js` to add the Tailwind plugin
- Replaced `index.css` with `@import "tailwindcss"` (Tailwind v4 syntax)
- Added `import "./index.css"` to `main.jsx`
- Cleared `App.css` which had conflicting Vite defaults

---

### Prompt 6 — Prisma Client Not Found Error

**What I asked:**
> Pasted the error: `Cannot find module '.prisma/client/default'`

**What the AI did:**
- Diagnosed: `prisma generate` was never run after installing `@prisma/client`
- Ran `npx prisma generate --schema=prisma/schema.prisma --config=prisma.config.ts`
- Added `"postinstall": "npx prisma generate"` to `package.json` to prevent this on future clones

---

### Prompt 7 — Prisma Migration via Supabase

**What I asked:**
> "migrate the schema to database as well"

**What the AI did:**
- Ran `npx prisma migrate dev --name init --config=prisma.config.ts`
- Discovered that Prisma 7 requires `DIRECT_URL` (port 5432) for migration, separate from the
  runtime pooled `DATABASE_URL` (port 6543 via pgBouncer)
- Updated `prisma.config.ts` to use `datasource.url` (the correct Prisma 7 property)

**AI error caught (#3 — see below)**

---

### Prompt 8 — Add Constraints Migration

**What I asked:**
> Pasted a target SQL schema with partial unique indexes and CHECK constraints. Asked if the
> current schema matches; if not, make it match.

**What the AI did:**
- Compared the target SQL against the existing Prisma migration
- Created a second migration (`20260613120000_add_constraints`) with the missing CHECK constraints
  and partial unique indexes that Prisma cannot express in schema DSL
- Deployed with `npx prisma migrate deploy`

---

### Prompt 9 — Backend Logging Setup

**What I asked:**
> "add proper logging of backend use chalk and morgan / winston to log every request or ping"

**What the AI did:**
- Installed: `winston`, `morgan`, `chalk@4` (v4 required for CommonJS compatibility — chalk v5+ is ESM-only)
- Created `Server/lib/logger.js` — Winston singleton with chalk console transport + JSON file transport
- Updated `index.js` to wire Morgan → logger stream
- Created `logs/.gitkeep` and ensured `logs/` is in `.gitignore`

---

### Prompt 10 — Health Check Endpoint

**What I asked:**
> "can you add a supabase url health check"

**What the AI did:**
- Added `GET /api/health` endpoint to `index.js`
- Runs `prisma.$queryRaw\`SELECT 1\`` and measures latency
- Returns `{ status, database: { status, latencyMs } }`, HTTP 200 on healthy, 503 on degraded

---

## Session 2 — 2026-06-12 / Group Management

### Prompt 11 — Groups Backend + Frontend (Phase 2.1 + 2.2)

**What I asked:**
> Write `server/routes/groups.js` (5 routes: create group, list groups, get group, add member,
> mark left) and `client/src/pages/Dashboard.jsx` + `client/src/pages/GroupDetail.jsx`.

**What the AI did:**
- Created `routes/groups.js` using Prisma ORM with `prisma.$transaction()` for create-group
- Created `Dashboard.jsx` with group cards, skeleton loading, create-group modal
- Created `GroupDetail.jsx` with tabs (Expenses/Members), Add Member modal, Mark Left modal

**Key design decisions:**
- Re-adding a previously-left member creates a new membership row (not updates the existing one)
- Partial unique index `WHERE left_at IS NULL` prevents two active memberships

---

### Prompt 12 — Missing `react-hot-toast` Package

**What I asked:**
> Pasted Vite error: `Failed to resolve import "react-hot-toast"`

**What the AI did:**
- Installed: `npm install react-hot-toast` (in the Client directory)
- Added `<Toaster>` component to `main.jsx` with dark theme styling

---

### Prompt 13 — `splitCalculator.js` Utility Module

**What I asked:**
> Write `Server/lib/splitCalculator.js` with `calculateSplits`, `validateSplits`,
> `normalizeSplits`, and `computeRowHash`. Exact rounding rule and hash formula specified.

**What the AI did:**
- Created the pure utility module with JSDoc on all four functions
- Smoke-tested all 8 test cases in the terminal: EQUAL, EXACT, PERCENTAGE, RATIO splits,
  all validate functions, normalize, and hash

**Verification:** All tests passed with `sum === amountINR` in every split case.

---

## Session 3 — 2026-06-13 / CSV Import Feature

### Prompt 14 — Import Route (Critical)

**What I asked:**
> Write `Server/routes/import.js` — the core of the project. Full spec: 5 helper functions,
> 15 anomaly checks, preview route, confirm route with sequential decision processing.
> "this whole logic is core heart of the whole project this fails the project fails"

**What the AI did:**
- Installed: `csv-parse`, `multer`, `axios`
- Implemented all 5 helpers: `parseDate`, `isAmbiguousDate`, `levenshtein`,
  `resolveMemberName`, `fetchUsdRate`
- Implemented all 15 anomaly checks per row
- Implemented `POST /preview` and `POST /confirm` routes
- Verified with `node -e "require('./routes/import'); console.log('import.js loaded OK')"`

---

### Prompt 15 — Import Page Frontend

**What I asked:**
> Write `Client/src/pages/ImportPage.jsx` — full 5-step state machine: upload, previewing,
> reviewing, importing, complete. Drag and drop, anomaly cards with radio groups, sticky
> action bar, complete screen with report download.

**What the AI did:**
- Created the full ImportPage with all 5 steps
- Updated `main.jsx` to replace the placeholder ImportPage with the real import
- Added "Import CSV" button to `GroupDetail.jsx` header

---

### Prompt 16 — Connection Terminated Error During Preview

**What I asked:**
> Pasted: `[GET /groups/:groupId] Error: Connection terminated unexpectedly`
> with logs showing preview took 17,870ms

**What the AI did:**
- Diagnosed: sequential `await` calls (memberships → hashes → fetchUsdRate) held the preview
  request for 17+ seconds while Frankfurter's API responded slowly from Europe. Supabase free-tier
  killed the idle pg connections during that window.
- Fixed: wrapped all three in `Promise.all()` so DB queries complete in ~100ms and connections
  are released before `fetchUsdRate()` even starts

---

### Prompt 17 — Full UI/UX Overhaul

**What I asked:**
> "fix ui its look terrible change it completely user should be able to understand what this
> website is for each feature and flow should be understandable"

**What the AI did:**
- Redesigned `Login.jsx` and `Signup.jsx` with a split-panel layout (branding left, form right)
- Added password strength bar to Signup, show/hide toggle to Login
- Redesigned `Dashboard.jsx` with proper navbar, skeleton loading, search bar, improved group cards
- Redesigned `GroupDetail.jsx` — changed default tab to Expenses, added tab subtitles, improved
  Balances empty state
- Added instruction banner and step indicator to `ImportPage.jsx`

---

### Prompt 18 — Import Not Adding to Expenses

**What I asked:**
> "after import it doesnt add to expenses and balance or anything"

**What the AI did:**
- Diagnosed 5 bugs in the confirm route:
  1. `paidById` was null for many rows — NOT NULL constraint threw silently
  2. RATIO splits with `value: 0` caused division by zero in `calculateSplits`
  3. `getActiveMembersOnDate` was called outside the `$transaction`
  4. Invalid currency string passed to Prisma enum field
  5. Wrong `splitType` variable used in `expense.create`
- Added explicit console logging: `[confirm] row X: action=... paidById=... splits=...`
- Fixed all 5 bugs with null guards, all-zero fallback to EQUAL, moved into transaction,
  currency whitelist, and `effectiveSplitType` variable

---

### Prompt 19 — Import Button Permanently Disabled

**What I asked:**
> "i cant click the import button even after selecting"

**What the AI did:**
- Diagnosed: `effectiveRowAction` returned `'skip'` for any row where any anomaly had a
  `skip` default — even if the user never interacted with it. Most CSV rows hit a SKIP-default
  anomaly, so `importCount` was always 0.
- Fixed: removed `disabled={importCount === 0}`; rewrote effective action logic so `skip`
  only wins on explicit user selection, not on default value.

---

## The Three Cases Where the AI Produced Wrong Code

### AI Error #1 — Prisma 7 Config: Wrong Property Name

**Prompt context:** Session 1, building the database schema.

**What the AI generated:**
```typescript
// prisma.config.ts — WRONG
export default defineConfig({
  earlyAccess: true,          // ← did not exist in Prisma 7.8.0 type
  migrate: {                  // ← wrong property name
    url: process.env.DIRECT_URL
  }
})
```

**How it was caught:** TypeScript threw `Object literal may only specify known properties, and
'earlyAccess' does not exist in type 'PrismaConfig'`. Then `npx prisma migrate dev` threw
`Error: The datasource.url property is required in your Prisma config file`.

**Investigation:** Ran `Get-ChildItem node_modules\@prisma\config\dist -Recurse -Filter "*.d.ts"`,
opened `index.d.ts`, and read the actual type definition. The correct property is `datasource.url`,
not `migrate.url`. The `earlyAccess` flag was removed when the driver-adapter feature graduated
from beta in Prisma 7.8.0.

**What was changed:**
```typescript
// prisma.config.ts — CORRECTED
export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL ?? '',   // ← correct property
  }
})
```

**Runtime client fix:** Also discovered that `new PrismaClient()` with no arguments throws in
Prisma 7 with driver adapters. Created `lib/prisma.js` as a singleton that passes the adapter:
```javascript
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
module.exports = prisma;
```

---

### AI Error #2 — Missing `const router = Router()`

**Prompt context:** Session 1, writing `server/routes/auth.js`.

**What the AI generated:** When fixing the Prisma adapter issue in `auth.js`, the AI ran a
targeted edit that accidentally removed `const router = Router();` from the top of the file.

**How it was caught:** The server threw `TypeError: router is not defined` immediately on reload.
The AI verified by checking the file: `const router = Router()` was missing.

**What was changed:** Re-added the line `const router = Router();` after the imports block.

**What this shows:** AI editors applying targeted diffs can drop lines when the surrounding
context shifts. Every file edit needs a follow-up read to verify the full file is intact,
especially for short but critical lines like router initialisation.

---

### AI Error #3 — `Promise.all` Still Sequential Due to Missing `await`

**Prompt context:** Session 3, fixing the Connection Terminated error in `import.js`.

**What the AI initially generated:**
```javascript
// WRONG — still sequential because Promise.all needs await
Promise.all([
  prisma.groupMembership.findMany(...),
  prisma.expense.findMany(...),
  fetchUsdRate()
]);
// execution continued immediately without waiting
const [memberships, existingHashes, usdRate] = ... // undefined
```

**How it was caught:** After the fix was applied, the server still showed sequential behaviour
in the logs (DB queries completing first, then the long pause for `fetchUsdRate`). On review,
the `await` keyword was missing before `Promise.all(...)`, so the promise was created but not
awaited — the destructuring below received `undefined`.

**What was changed:**
```javascript
// CORRECTED
const [memberships, existingHashes, usdRate] = await Promise.all([
  prisma.groupMembership.findMany(...),
  prisma.expense.findMany(...),
  fetchUsdRate()
]);
```

**What this shows:** `Promise.all` without `await` is a silent no-op from the perspective of
the sequential code below it. This is a common JavaScript async mistake — the AI generated the
structure correctly but dropped the `await`. The fix was a single keyword addition, caught by
reading the logs and noticing the timing hadn't changed.

---

## Summary of AI Tool Usage

| Aspect | Detail |
|--------|--------|
| **AI tool** | Gemini (in-IDE agentic planner) |
| **Total prompts** | 19 across 3 sessions |
| **Files AI generated** | ~25 files (all routes, pages, middleware, schema, migrations, utilities) |
| **Files AI modified** | ~15 file edits in response to errors and feature requests |
| **AI errors caught** | 3 (documented above) + ~5 smaller issues (missing imports, stray syntax) |
| **Commands AI ran** | npm installs, prisma validate/migrate, node smoke tests |
| **What Kunal provided** | Every prompt, business spec, exact API contracts, schema requirements, fix requests |
| **What AI provided** | Code generation, terminal execution, diagnosis, file edits |
| **Final responsibility** | All code reviewed and accepted by Kunal before commit |