"use strict";

const { calculateSplits, validateSplits, normalizeSplits, computeRowHash } =
    require("./splitCalculator");

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function pass(label) {
    console.log(`  ✅ PASS  ${label}`);
    passed++;
}

function fail(label, expected, actual) {
    console.log(`  ❌ FAIL  ${label}`);
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual  : ${JSON.stringify(actual)}`);
    failed++;
}

function check(label, condition, expected, actual) {
    condition ? pass(label) : fail(label, expected, actual);
}

/** Sum amountOwed fields, rounded to 2 d.p. to avoid float noise. */
function sumOwed(splits) {
    return Math.round(splits.reduce((a, s) => a + s.amountOwed, 0) * 100) / 100;
}

/** Return the amountOwed for a given userId. */
function owedBy(splits, userId) {
    return splits.find((s) => s.userId === userId)?.amountOwed;
}

// ─── TEST 1 — EQUAL, clean division ───────────────────────────────────────────

console.log("\nTEST 1 — EQUAL split, 3 people, round number (1200 ÷ 3)");
{
    const members = [
        { userId: "a", value: 0 },
        { userId: "b", value: 0 },
        { userId: "c", value: 0 },
    ];
    const splits = calculateSplits("EQUAL", 1200, members);
    const sum = sumOwed(splits);

    check("a owes 400.00",   owedBy(splits, "a") === 400,   400,   owedBy(splits, "a"));
    check("b owes 400.00",   owedBy(splits, "b") === 400,   400,   owedBy(splits, "b"));
    check("c owes 400.00",   owedBy(splits, "c") === 400,   400,   owedBy(splits, "c"));
    check("sum === 1200.00", sum === 1200, 1200, sum);
}

// ─── TEST 2 — EQUAL, rounding remainder ───────────────────────────────────────

console.log("\nTEST 2 — EQUAL split, rounding remainder (100 ÷ 3)");
{
    const members = [
        { userId: "a", value: 0 },
        { userId: "b", value: 0 },
        { userId: "c", value: 0 },
    ];
    const splits = calculateSplits("EQUAL", 100, members);
    const sum = sumOwed(splits);

    check("a owes 33.33",       owedBy(splits, "a") === 33.33, 33.33, owedBy(splits, "a"));
    check("b owes 33.33",       owedBy(splits, "b") === 33.33, 33.33, owedBy(splits, "b"));
    check("c owes 33.34 (rem)", owedBy(splits, "c") === 33.34, 33.34, owedBy(splits, "c"));
    check("sum === 100.00",     sum === 100, 100, sum);
}

// ─── TEST 3 — PERCENTAGE, normal ──────────────────────────────────────────────

console.log("\nTEST 3 — PERCENTAGE split, normal (40/35/25 of 10000)");
{
    const members = [
        { userId: "a", value: 40 },
        { userId: "b", value: 35 },
        { userId: "c", value: 25 },
    ];
    const splits = calculateSplits("PERCENTAGE", 10000, members);
    const sum = sumOwed(splits);

    check("a owes 4000",    owedBy(splits, "a") === 4000,  4000,  owedBy(splits, "a"));
    check("b owes 3500",    owedBy(splits, "b") === 3500,  3500,  owedBy(splits, "b"));
    check("c owes 2500",    owedBy(splits, "c") === 2500,  2500,  owedBy(splits, "c"));
    check("sum === 10000",  sum === 10000, 10000, sum);
}

// ─── TEST 4 — RATIO, scooter rentals ──────────────────────────────────────────

console.log("\nTEST 4 — RATIO split, 1:2:1:2 of 3600");
{
    const members = [
        { userId: "aisha", value: 1 },
        { userId: "rohan", value: 2 },
        { userId: "priya", value: 1 },
        { userId: "dev",   value: 2 },
    ];
    const splits = calculateSplits("RATIO", 3600, members);
    const sum = sumOwed(splits);

    check("aisha owes 600",  owedBy(splits, "aisha") === 600,  600,  owedBy(splits, "aisha"));
    check("rohan owes 1200", owedBy(splits, "rohan") === 1200, 1200, owedBy(splits, "rohan"));
    check("priya owes 600",  owedBy(splits, "priya") === 600,  600,  owedBy(splits, "priya"));
    check("dev   owes 1200", owedBy(splits, "dev")   === 1200, 1200, owedBy(splits, "dev"));
    check("sum === 3600",    sum === 3600, 3600, sum);
}

// ─── TEST 5 — EXACT validation pass ───────────────────────────────────────────

console.log("\nTEST 5 — EXACT validation pass (700+400+400 = 1500)");
{
    const members = [
        { userId: "a", value: 700 },
        { userId: "b", value: 400 },
        { userId: "c", value: 400 },
    ];
    const result = validateSplits("EXACT", members, 1500);

    check("valid === true",  result.valid === true,  true,  result.valid);
    check("error === null",  result.error === null,  null,  result.error);
}

// ─── TEST 6 — PERCENTAGE validation fail (110%) ───────────────────────────────

console.log("\nTEST 6 — PERCENTAGE validation fail (30+30+30+20 = 110%)");
{
    const members = [
        { userId: "a", value: 30 },
        { userId: "b", value: 30 },
        { userId: "c", value: 30 },
        { userId: "d", value: 20 },
    ];
    const result = validateSplits("PERCENTAGE", members, 2200);

    check("valid === false",         result.valid === false, false, result.valid);
    check("error mentions '110'",    typeof result.error === "string" && result.error.includes("110"),
                                     "string containing '110'", result.error);
}

// ─── TEST 7 — normalizeSplits: 110% → 100% ────────────────────────────────────

console.log("\nTEST 7 — normalizeSplits, 30+30+30+20 = 110 → scaled to 100");
{
    const members = [
        { userId: "a", value: 30 },
        { userId: "b", value: 30 },
        { userId: "c", value: 30 },
        { userId: "d", value: 20 },
    ];
    const normalized = normalizeSplits(members);
    const sum = Math.round(normalized.reduce((acc, m) => acc + m.value, 0) * 10000) / 10000;

    check("normalized sum === 100", sum === 100, 100, sum);
    check("userId preserved",
        normalized.map((m) => m.userId).join(",") === "a,b,c,d",
        "a,b,c,d",
        normalized.map((m) => m.userId).join(",")
    );

    // Each value should be proportional: 30/110*100 ≈ 27.2727, 20/110*100 ≈ 18.1818
    const expectedA = Math.round((30 / 110) * 100 * 10000) / 10000;
    check(`a.value ≈ ${expectedA}`, normalized[0].value === expectedA, expectedA, normalized[0].value);
}

// ─── TEST 8 — computeRowHash deterministic ────────────────────────────────────

console.log("\nTEST 8 — computeRowHash deterministic & case/space invariant");
{
    const h1 = computeRowHash("2026-06-13", "  Scooter Rental  ", 3600, "uuid-aisha");
    const h2 = computeRowHash("2026-06-13", "scooter rental",     3600, "uuid-aisha");
    const h3 = computeRowHash("2026-06-13", "  Scooter Rental  ", 3600, "uuid-aisha");
    const hDiff = computeRowHash("2026-06-13", "Scooter Rental",  9999, "uuid-aisha");

    check("same inputs → same hash (h1 === h3)",     h1 === h3,    h1, h3);
    check("trim+lower → same hash (h1 === h2)",      h1 === h2,    h1, h2);
    check("different amount → different hash",        h1 !== hDiff, "≠ h1", hDiff);
    check("hash is 32-char hex string",
        typeof h1 === "string" && /^[0-9a-f]{32}$/.test(h1),
        "32-char hex", h1
    );
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} checks`);
if (failed === 0) {
    console.log("🎉 All tests passed!\n");
} else {
    console.log(`⚠️  ${failed} check(s) failed — review output above.\n`);
    process.exit(1);
}
