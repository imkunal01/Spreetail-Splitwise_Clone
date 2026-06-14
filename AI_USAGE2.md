# AI_USAGE.md — AI Tool Usage Log

**AI tool used:** AI coding assistants were used as development collaborators throughout the Splitmate project, primarily through prompt-driven code generation, debugging, architecture review, and test planning.

**How it was used:** Kunal authored the prompts, business rules, API contracts, schema requirements, and feature expectations. The AI generated code, proposed implementation strategies, helped debug runtime issues, and assisted with refactors. Every generated file was reviewed before acceptance, and incorrect suggestions were corrected manually or with follow-up prompts.

---

## Session 1 — Project Bootstrapping and Core Server Setup

### Prompt 1 — Initial PERN + Prisma application scaffold

**What I asked:**

> Generate `server/index.js`, `server/db.js`, `client/src/api/axios.js`, `.env.example`, `.gitignore`, and empty Express Router placeholder files for all six routes: auth, groups, expenses, settlements, import, currency.

**Tech context supplied:** Node.js + Express (CommonJS), React + Vite, PostgreSQL + Prisma ORM, JWT in httpOnly cookies, Axios with `withCredentials: true`.

**What the AI did:**

* Installed the backend dependencies required for the server to boot cleanly.
* Created `server/index.js` with CORS, `express.json()`, `cookie-parser`, route mounting, and a global error handler.
* Created `server/db.js` as the PostgreSQL pool singleton.
* Created `client/src/api/axios.js` with a shared Axios instance.
* Created `.env.example` with the basic server and client environment variables.
* Created `.gitignore` entries for Node, build outputs, and environment files.
* Created empty route placeholders so the application started without import errors.

**Key decisions made:**

* `withCredentials: true` was set on the Axios instance so httpOnly cookies would be sent on every request.
* The Axios 401 interceptor redirected to `/login` only when needed, avoiding redirect loops.
* CORS was configured to allow the React dev server origin.

**Why this mattered:**
This established the project’s foundation before any business logic was added, making later auth and route work much easier.

---

## Session 2 — Prisma Schema, Migration Design, and Data Model Rules

### Prompt 2 — Database schema and migration generation

**What I asked:**

> Generate `prisma/schema.prisma` and `server/migrations/001_initial.sql` for the shared expenses app. Both files must be fully consistent and cover all real-world scenarios, including historical memberships, multiple currencies, refunds, settlements, audit logging, duplicate prevention, and guest users.

**What the AI did:**

* Produced a Prisma schema with the core models for users, groups, memberships, expenses, splits, settlements, and import logs.
* Generated a matching SQL migration.
* Included enums for split type, currency, and import status.
* Added indexes, foreign keys, defaults, and checks.

**Business context encoded:**

* Membership changes over time.
* Imported expenses in multiple currencies.
* Four split types: EQUAL, EXACT, PERCENTAGE, RATIO.
* Settlements stored separately from expenses.
* Negative amounts allowed for refunds.
* CSV import tracking with session-level auditability.
* Duplicate import prevention using row hashes.
* Guest participants for names not tied to real accounts.

**AI issue caught:**
The initial Prisma configuration used a deprecated or incorrect Prisma 7 config shape. That was later corrected after TypeScript and migration feedback showed the exact property names required by the installed Prisma version.

---

### Prompt 3 — Prisma 7 config correction

**What I asked:**

> Explain what the Prisma config error means and fix it.

**What the AI did:**

* Identified that the config was using outdated or incorrect fields.
* Updated the Prisma config so the datasource URL was set in the correct place.
* Corrected the Prisma client initialization so the pg adapter was passed properly at runtime.

**Why this mattered:**
Without this fix, the Prisma client and migration system could not reliably connect to the database.

---

### Prompt 4 — Migration consistency and constraint tightening

**What I asked:**

> Compare the Prisma schema with the SQL migration and make them fully consistent.

**What the AI did:**

* Added missing constraints and partial indexes that Prisma DSL alone could not express cleanly.
* Ensured the migration matched the assignment’s business rules.
* Verified that the schema and SQL layer were aligned.

**Important rules enforced:**

* A user can leave and later rejoin a group.
* Duplicate active memberships are blocked.
* Imported expenses can be audited later.
* Historical data is preserved instead of overwritten.

---

## Session 3 — Authentication, JWT Session Handling, and Protected Routes

### Prompt 5 — Auth API and frontend auth layer

**What I asked:**

> Write `server/routes/auth.js` with signup, login, logout, and me endpoints. Also write `AuthContext`, `ProtectedRoute`, `Login.jsx`, `Signup.jsx`, and update `main.jsx`.

**What the AI did:**

* Created JWT-based authentication with cookies.
* Added the `requireAuth` middleware.
* Built the auth context for session state and login/logout helpers.
* Built protected routing so unauthenticated users were redirected.
* Created login and signup pages.
* Wired the app shell in `main.jsx`.

**What I reviewed manually:**

* JWT payload shape.
* Cookie behavior.
* How session restore worked on refresh.
* Whether `GET /api/auth/me` correctly repopulated the app state.

**AI issue caught:**
A short-lived edit accidentally removed a router initialization line in one file, which caused a runtime `router is not defined` error. That was restored immediately after inspection.

---

### Prompt 6 — Fixing missing package and toast infrastructure

**What I asked:**

> Vite says it cannot resolve `react-hot-toast`.

**What the AI did:**

* Installed `react-hot-toast` in the client.
* Added the `<Toaster>` component to `main.jsx`.
* Ensured toast notifications would render consistently.

**Why this mattered:**
The UI relied on toast messages for login, signup, create group, add member, and import feedback. Without the package and provider, the app compiled but the user experience was broken.

---

### Prompt 7 — Tailwind CSS setup fix

**What I asked:**

> css is not done

**What the AI did:**

* Identified the missing or incomplete Tailwind setup.
* Installed the needed Tailwind packages.
* Updated Vite configuration.
* Replaced the starter CSS with Tailwind’s import style.
* Wired the stylesheet into the React entry point.

**Why this mattered:**
The UI was being written with Tailwind utility classes, so the project needed the CSS system fully wired before later frontend work could look correct.

---

### Prompt 8 — Prisma client generation error

**What I asked:**

> Pasted the error: `Cannot find module '.prisma/client/default'`

**What the AI did:**

* Diagnosed that Prisma client generation had not been run after installation.
* Ran the Prisma generate command.
* Added a postinstall hook so future installs would generate the client automatically.

**Why this mattered:**
This prevented the backend from failing on startup after dependency installs or fresh clones.

---

### Prompt 9 — Migration through the database provider

**What I asked:**

> Migrate the schema to the database as well.

**What the AI did:**

* Ran the migration workflow.
* Discovered a distinction between the runtime database connection and the migration connection.
* Updated Prisma configuration so migrations could use the correct connection path.

**Why this mattered:**
The application needed both a runtime database connection for the API and a migration-safe connection for Prisma Migrate.

---

## Session 4 — Backend Logging, Health Checks, and Runtime Diagnostics

### Prompt 10 — Add proper backend logging

**What I asked:**

> Add proper logging of backend use chalk and morgan / winston to log every request or ping.

**What the AI did:**

* Installed Winston, Morgan, and Chalk.
* Created a logger utility.
* Wired request logging into the Express server.
* Added file-based and console-based logging.

**Why this mattered:**
Logging made it much easier to debug auth, import, and group route behavior during development.

---

### Prompt 11 — Add a database health check endpoint

**What I asked:**

> Can you add a supabase url health check

**What the AI did:**

* Added a `/api/health` endpoint.
* Made it verify the database connection with a lightweight query.
* Returned latency information and health status.

**Why this mattered:**
This provided a quick way to verify the backend and database were alive without opening the full app.

---

## Session 5 — Group Management Backend and Frontend

### Prompt 12 — Phase 2.1 backend group routes and Phase 2.2 group pages

**What I asked:**

> Write `server/routes/groups.js` and the React pages for dashboard and group detail. Use Prisma for backend operations and axios for frontend API calls.

**What the AI did:**

* Created the group routes for create, list, detail, add member, and leave member.
* Built the dashboard page with group cards, create-group modal, and loading skeletons.
* Built the group detail page with tabs, member table, add member modal, and mark-left modal.
* Wired the routes into the application.

**Design decisions made:**

* Re-adding a previously left member creates a new membership row.
* The backend prevents duplicate active memberships.
* The dashboard appends the newly created group locally rather than forcing a full refetch.
* Group detail uses a tabbed layout so expenses and members can evolve separately.

**AI issues caught:**

* The `react-hot-toast` dependency was missing at first and had to be installed.
* The development server needed a restart for Vite to re-optimize the dependency graph.

---

### Prompt 13 — Verify group workflow end to end

**What I asked:**

> Audit what I have and confirm everything works correctly end to end. Write a checklist of manual tests for all backend routes and frontend interactions.

**What the AI did:**

* Prepared a structured manual verification checklist.
* Covered authentication, dashboard access, protected routes, group creation, group membership, and edge cases.
* Included cases like duplicate member addition, marking left before join date, and unauthorized group access.

**Why this mattered:**
This turned the implementation work into a testable release checklist.

---

## Session 6 — Split Calculator Utility and Shared Expense Logic

### Prompt 14 — Core split-calculation utility module

**What I asked:**

> Write `Server/lib/splitCalculator.js` with `calculateSplits`, `validateSplits`, `normalizeSplits`, and `computeRowHash`.

**What the AI did:**

* Created the split calculator utility as a pure module.
* Implemented split calculation rules for equal, exact, percentage, and ratio splits.
* Added validation and normalization helpers.
* Implemented a deterministic row hash function for duplicate import detection.
* Smoke-tested the utility against several split scenarios.

**Why this mattered:**
The split engine is the financial core of the app. It determines how expenses are divided and later reconciled.

**Notable correctness requirement:**
The calculations had to sum exactly to the final amount, including rounding edge cases.

---

## Session 7 — Seeder and Demo Data Construction

### Prompt 15 — Build a deterministic database seeder

**What I asked:**

> Write `Server/prisma/seed.js` for Splitmate. It must create the Unknown User, known users, the group, memberships, and support idempotent reruns.

**What the AI did:**

* Created the seed script.
* Added a placeholder guest user.
* Created the six known users.
* Created the main group.
* Added memberships with inferred joined and left dates.
* Added guard logic so rerunning the seed would not create duplicates.
* Printed login credentials and group information to the console.

**Important runtime fix:**
The seed initially failed because environment variables were not loaded early enough for the Prisma client. The fix was to load dotenv before initializing Prisma.

**Why this mattered:**
The application needed realistic data right away so CSV imports and membership logic could be tested without manual setup.

---

## Session 8 — CSV Import Engine and Audit Workflow

### Prompt 16 — Build the critical import route

**What I asked:**

> Write `Server/routes/import.js`. This route is the core of the project and must handle preview, anomaly detection, date parsing, name resolution, duplicate detection, exchange rates, and import confirmations.

**What the AI did:**

* Implemented CSV parsing with `csv-parse` and file handling with `multer`.
* Added helper functions for date parsing, ambiguous dates, Levenshtein distance, member lookup, and USD rate fetching.
* Implemented the import preview route.
* Implemented anomaly detection for missing fields, zero amounts, negative amounts, ambiguous dates, unknown payers, unknown members, inactive members, missing currency, USD exchange-rate fallback, settlements disguised as expenses, and duplicate rows.
* Built the confirm flow and connected it to expense creation.

**Why this mattered:**
The CSV import feature is the highest-risk part of the app because it touches financial data and must be robust to messy real-world input.

---

### Prompt 17 — Build the frontend import workflow

**What I asked:**

> Write `Client/src/pages/ImportPage.jsx` with a full state machine for uploading, previewing, reviewing, importing, and completing.

**What the AI did:**

* Created the import page UI.
* Added drag-and-drop file selection.
* Built anomaly cards and decision controls.
* Added a sticky action bar for import actions.
* Added a completion screen.
* Wired the page into application routing.
* Added an import entry point from the group detail page.

**Why this mattered:**
The backend import engine only becomes useful if users can understand and control the review flow in the browser.

---

### Prompt 18 — Import performance and connection stability fix

**What I asked:**

> A connection is being terminated unexpectedly while previewing the import.

**What the AI did:**

* Tracked the timeout to slow sequential preview work.
* Moved independent tasks into a parallel promise workflow.
* Reduced the window in which the database connection stayed open.

**Why this mattered:**
A financial import route cannot be fragile under load or external API delay.

---

### Prompt 19 — Fix import confirmation logic and duplicate handling

**What I asked:**

> After import it does not add to expenses or balance correctly.

**What the AI did:**

* Diagnosed multiple import confirmation bugs.
* Fixed paid-by resolution problems.
* Fixed invalid currency handling.
* Fixed ratio edge cases.
* Ensured the transaction used the correct split type and resolved data.
* Added extra logging around row processing.

**Why this mattered:**
The confirm route is the point where preview decisions become permanent database records, so it had to be exact.

---

### Prompt 20 — Fix disabled import button issue

**What I asked:**

> I cannot click the import button even after selecting.

**What the AI did:**

* Diagnosed the import button state logic.
* Fixed the rule that incorrectly treated default anomaly values as if the user had already chosen them.
* Allowed the import action to proceed when valid selections existed.

**Why this mattered:**
A broken control flow in the review screen can make the entire import feature appear dead even when the backend works.

---

## Session 9 — Iterative Fixes, UX Improvements, and Quality Passes

### Prompt 21 — Improve the UI so the app is understandable

**What I asked:**

> Fix the UI. It looks terrible. Change it completely so the user understands what the website is for and each feature flow is understandable.

**What the AI did:**

* Redesign language and layout across auth, dashboard, group detail, and import screens.
* Added stronger visual hierarchy.
* Added better onboarding cues.
* Improved spacing, card structure, and state messaging.
* Added clearer instructions for the import workflow.

**Why this mattered:**
The app needed to look like a purposeful product, not just a collection of pages.

---

### Prompt 22 — Verify the whole app before moving ahead

**What I asked:**

> Confirm everything works correctly end to end and write the manual test checklist.

**What the AI did:**

* Organized backend checks for every route.
* Organized frontend browser checks for every UI interaction.
* Included edge cases for auth, groups, memberships, and import handling.

**Why this mattered:**
This ensured the project was treated like a shippable system instead of isolated features.

---

## AI Errors Identified and Corrected

### AI Error 1 — Incorrect Prisma config shape

**Issue:**
A generated Prisma config included the wrong property shape for the installed Prisma version.

**Fix:**
The config was rewritten to use the correct datasource field and client initialization pattern.

---

### AI Error 2 — Missing router initialization during a file edit

**Issue:**
A targeted edit removed `const router = Router()` from a route file.

**Fix:**
The line was restored after the runtime error was observed.

---

### AI Error 3 — Missing `await` in async promise aggregation

**Issue:**
A fix intended to parallelize import preview work missed an `await`, so the logic still behaved incorrectly.

**Fix:**
The promise aggregation was corrected to await all tasks before destructuring results.

---

### AI Error 4 — Missing package dependency for toast notifications

**Issue:**
The frontend imported `react-hot-toast` before it was installed.

**Fix:**
The package was installed and the toaster provider was added.

---

### AI Error 5 — Seed script env loading order

**Issue:**
The seed script attempted to initialize Prisma before environment variables were loaded.

**Fix:**
Dotenv was loaded before Prisma initialization.

---

## Manual Verification and Testing

AI was used to design tests, but all important behavior was verified manually in the browser and through terminal runs.

### Backend checks performed

* Auth routes with valid and invalid credentials.
* Session validation through `/api/auth/me`.
* Group creation and membership creation.
* Access denial for non-members.
* Membership leave flow validation.
* CSV import preview and confirm behavior.
* Seed script reruns for idempotence.
* Prisma generation and migration behavior.

### Frontend checks performed

* Login and signup flows.
* Redirect behavior for protected routes.
* Dashboard loading state and group cards.
* Create group modal behavior.
* Group detail tabs.
* Add member modal.
* Mark member left modal.
* Import page upload and review flow.
* Toast visibility and error handling.

### Edge cases checked

* Duplicate member addition.
* Marking someone left before join date.
* Accessing a group without membership.
* Refreshing on `/dashboard`.
* Visiting `/dashboard` while logged out.
* CSV rows with missing data.
* Settlement-like rows in expense data.
* Unknown or inactive split participants.

---

## Summary Statistics

| Category                | Detail                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AI-assisted sessions    | 9 major sessions                                                                                                 |
| Total prompts logged    | 22                                                                                                               |
| Major files generated   | Server routes, Prisma schema, migrations, auth layer, group pages, import engine, seeder, utilities              |
| Core features completed | Auth, groups, memberships, import preview, import confirm, split calculations, logging, seeding                  |
| Main debugging themes   | Prisma config, dependency installation, async timing, route runtime errors, import workflow logic                |
| Final outcome           | Full-stack shared expenses app with authenticated flows, historical membership handling, and CSV import auditing |

---

## Final Declaration

AI was used throughout development as a collaborative coding and debugging assistant.

All prompts were written by Kunal Dhangar @imkunal01.
All generated code was reviewed before being accepted.
All runtime errors, design gaps, and incorrect assumptions were checked manually and corrected where necessary.

The final codebase reflects a mix of AI-assisted generation and human review, with responsibility for the final implementation remaining with the developer.
