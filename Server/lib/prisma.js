const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

// Prisma 7 with driver adapters requires the adapter to be passed at runtime.
// The prisma.config.ts only configures the CLI (prisma migrate / prisma generate).
// For runtime queries the adapter must be provided here explicitly.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
