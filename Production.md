Splitwise  — Testing & Production Guide
Local Development Test Flow
Run these steps every time you want to do a clean test of the CSV import feature.

Option A — Quick test (wipe data only, keep schema)
bash

# Terminal: Server directory
npm run wipe        # deletes all users, groups, expenses, etc.
npm run seed        # re-creates test users + Flat 2026 group with seeded data
Then in the browser:

Log in as aisha@splitwire.com / password123
Create a new group (e.g. "Import Test")
Go to Import CSV → upload Expenses_Export.csv
Click Auto-import →
Open the Balances tab
Compare with Flat 2026 (the seeder group) — numbers should match
Option B — Full reset (wipes schema + data, re-runs migrations)
Use this if migrations have changed or you suspect schema drift.

bash

# Terminal: Server directory
npx prisma migrate reset --force --schema=prisma/schema.prisma --config=prisma.config.ts
npm run seed
WARNING

migrate reset drops and recreates the entire database. All data is lost.

Option C — Just wipe data, skip seed (blank slate)
bash

npm run wipe
Then create a group and import the CSV directly — no seeder data, full blank slate.

Available npm Scripts (Server)
Command	What it does
npm run dev	Start server with nodemon (hot reload)
npm run seed	Populate DB with test users + Flat 2026 expenses
npm run wipe	Delete ALL data (users, groups, expenses, logs) — keeps schema
npm run prisma:generate	Regenerate Prisma client from schema (run after schema changes)
npm run prisma:migrate	Apply pending migrations to DB (production-safe)
What Each Test Step Verifies
Step	What you're checking
Auto-import succeeds (0 errors)	All anomaly handlers + Prisma client working
Aisha "is owed" (positive balance)	Membership dates set correctly from CSV payer history
Row 14 imported as settlement	Settlement payee resolution from splitWithNames fallback
No "Priya S" ghost user created	resolvedPayerMap correctly redirects alias → real user
EXACT/RATIO/PERCENTAGE splits match	splitDetails parsed into real numeric values
Balances match Flat 2026	Full parity between seeder and import feature
Production Deployment
IMPORTANT

In production you never run seed, wipe, or migrate reset. Those are dev-only tools.

What runs in production
On first deploy (or schema changes):

bash

npm run prisma:migrate    # = prisma migrate deploy
This applies only new, unapplied migrations to the production DB safely. It never drops data.

On every deploy:

bash

npm install               # triggers postinstall → prisma generate automatically
npm run start             # or pm2 / your process manager
postinstall in package.json automatically runs prisma generate after every npm install, so the Prisma client is always in sync with the schema.

How the import feature works in production
The CSV import is a pure UI → API flow — no scripts needed:


User → Upload CSV → POST /api/import/:groupId/preview
                 → POST /api/import/:groupId/confirm   ← data is written here
                 → GET  /api/import/:groupId/report    ← download audit log
User creates a group (members are set up via the Members tab or invited)
User uploads a CSV file through the Import page
The server previews and auto-resolves all anomalies
User clicks Auto-import → (or reviews manually)
Server writes expenses, settlements, and import logs to the DB
Balances update immediately in real time
Production environment variables needed
The server reads from .env. In production set these in your hosting platform (Railway, Render, Fly.io, etc.):

env

DATABASE_URL=postgresql://...    # your production DB connection string
JWT_SECRET=...                   # strong random secret
NODE_ENV=production
Migration workflow when you add new schema changes

1. Locally: Edit schema.prisma
2. Locally: npx prisma migrate dev --name describe_your_change
             (creates migration file + applies to local DB)
3. Git commit the new migration file in prisma/migrations/
4. On deploy: npm run prisma:migrate
             (applies the new migration to production DB)
NOTE

The key difference: migrate dev = local only (interactive, can reset). migrate deploy = production safe (only applies new migrations, never drops data).

