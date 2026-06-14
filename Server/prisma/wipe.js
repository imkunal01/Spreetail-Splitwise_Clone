// ─── wipe.js ──────────────────────────────────────────────────────────────────
// Deletes ALL data from the database in foreign-key-safe order.
// Keeps the schema and migrations intact — only data is removed.
//
// Usage:
//   node prisma/wipe.js
//   npm run wipe
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();
const prisma = require("../lib/prisma");

async function main() {
    console.log("\n────────────────────────────────────────────────────────");
    console.log("  🗑️   Splitwise Wipe Script");
    console.log("────────────────────────────────────────────────────────\n");

    // Delete in foreign-key-safe order (children before parents)
    const logs     = await prisma.importLog.deleteMany();
    console.log(`  ✓ Deleted ${logs.count} import log(s)`);

    const splits   = await prisma.expenseSplit.deleteMany();
    console.log(`  ✓ Deleted ${splits.count} expense split(s)`);

    const expenses = await prisma.expense.deleteMany();
    console.log(`  ✓ Deleted ${expenses.count} expense(s)`);

    const settles  = await prisma.settlement.deleteMany();
    console.log(`  ✓ Deleted ${settles.count} settlement(s)`);

    const members  = await prisma.groupMembership.deleteMany();
    console.log(`  ✓ Deleted ${members.count} membership(s)`);

    const groups   = await prisma.group.deleteMany();
    console.log(`  ✓ Deleted ${groups.count} group(s)`);

    const users    = await prisma.user.deleteMany();
    console.log(`  ✓ Deleted ${users.count} user(s)`);

    console.log("\n────────────────────────────────────────────────────────");
    console.log("  ✅  Wipe complete! Database is now empty.");
    console.log("      Run 'npm run seed' to repopulate with test data.");
    console.log("────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
    console.error("  ✗  Wipe failed:", err.message);
    process.exit(1);
});
