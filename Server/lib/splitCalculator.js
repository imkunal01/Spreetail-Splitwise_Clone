"use strict";

const crypto = require("crypto");

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies the standard floor-and-remainder rounding rule to an array of raw
 * float shares, guaranteeing that the resulting amountOwed values always sum
 * to exactly `total`.
 *
 * Algorithm:
 *  1. Floor each raw value to 2 decimal places.
 *  2. Compute remainder = total − sum(floored).
 *  3. Add the remainder to the LAST element to absorb any floating-point drift.
 *
 * @param {number[]} rawShares   - Full-precision floats, one per member.
 * @param {number}   total       - The target sum (amountINR).
 * @param {string[]} userIds     - Parallel array of userId strings.
 * @returns {{ userId: string, amountOwed: number }[]}
 */
function _applyRounding(rawShares, total, userIds) {
    const floored = rawShares.map((v) => Math.floor(v * 100) / 100);

    const flooredSum = floored.reduce((acc, v) => acc + v, 0);
    const remainder = Math.round((total - flooredSum) * 100) / 100;

    // Add remainder to the last person
    floored[floored.length - 1] =
        Math.round((floored[floored.length - 1] + remainder) * 100) / 100;

    return userIds.map((userId, i) => ({ userId, amountOwed: floored[i] }));
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 1: calculateSplits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates how much each member owes for a given expense.
 *
 * @param {'EQUAL'|'EXACT'|'PERCENTAGE'|'RATIO'} splitType
 *   The splitting strategy to apply.
 *
 * @param {number} amountINR
 *   Total expense amount already converted to INR.
 *
 * @param {{ userId: string, value: number }[]} members
 *   Each member and their split value. Semantics per splitType:
 *     EQUAL      – value is ignored; everyone pays an equal share.
 *     EXACT      – value is the exact INR amount this person owes.
 *     PERCENTAGE – value is their percentage (30 → 30%).
 *     RATIO      – value is their share count (2 → 2 shares out of the total).
 *
 * @returns {{ userId: string, amountOwed: number }[]}
 *   One entry per member. Values are rounded to 2 d.p. and guaranteed to sum
 *   to exactly `amountINR`.
 */
function calculateSplits(splitType, amountINR, members) {
    const userIds = members.map((m) => m.userId);
    let rawShares;

    switch (splitType) {
        case "EQUAL": {
            const share = amountINR / members.length;
            rawShares = members.map(() => share);
            break;
        }

        case "EXACT": {
            // Values are already the target amounts; rounding still corrects
            // any accumulated floating-point drift on the last person.
            rawShares = members.map((m) => m.value);
            break;
        }

        case "PERCENTAGE": {
            rawShares = members.map((m) => (m.value / 100) * amountINR);
            break;
        }

        case "RATIO": {
            const totalShares = members.reduce((acc, m) => acc + m.value, 0);
            rawShares = members.map((m) => (m.value / totalShares) * amountINR);
            break;
        }

        default:
            throw new Error(`Unknown splitType: "${splitType}"`);
    }

    return _applyRounding(rawShares, amountINR, userIds);
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 2: validateSplits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates member split values before calculating or persisting a split.
 *
 * @param {'EQUAL'|'EXACT'|'PERCENTAGE'|'RATIO'} splitType
 * @param {{ userId: string, value: number }[]} members
 * @param {number} amountINR - Required for EXACT validation.
 *
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateSplits(splitType, members, amountINR) {
    switch (splitType) {
        case "EQUAL":
            // Always valid — values are ignored
            return { valid: true, error: null };

        case "EXACT": {
            const sum = members.reduce((acc, m) => acc + m.value, 0);
            const rounded = Math.round(sum * 100) / 100;
            if (Math.abs(rounded - amountINR) > 0.01) {
                return {
                    valid: false,
                    error: `Split amounts sum to ${rounded} but expense total is ${amountINR}`,
                };
            }
            return { valid: true, error: null };
        }

        case "PERCENTAGE": {
            const sum = members.reduce((acc, m) => acc + m.value, 0);
            const rounded = Math.round(sum * 100) / 100;
            if (rounded < 99.99 || rounded > 100.01) {
                return {
                    valid: false,
                    error: `Percentages sum to ${rounded}%, must equal 100%`,
                };
            }
            return { valid: true, error: null };
        }

        case "RATIO": {
            const allPositive = members.every((m) => typeof m.value === "number" && m.value > 0);
            if (!allPositive) {
                return {
                    valid: false,
                    error: "All ratio values must be greater than 0",
                };
            }
            return { valid: true, error: null };
        }

        default:
            return { valid: false, error: `Unknown splitType: "${splitType}"` };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 3: normalizeSplits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a PERCENTAGE member array so their values sum to exactly 100.
 *
 * Used during CSV import when raw percentages are proportionally correct but
 * don't add up to 100 (e.g. they sum to 110 because the CSV uses a different
 * base). Each value is scaled proportionally and rounded to 4 decimal places.
 *
 * @param {{ userId: string, value: number }[]} members
 *   Members with raw percentage values that may not sum to 100.
 *
 * @returns {{ userId: string, value: number }[]}
 *   New array with corrected percentage values (4 d.p.).
 *
 * @example
 *   normalizeSplits([{ userId: 'a', value: 55 }, { userId: 'b', value: 55 }])
 *   // → [{ userId: 'a', value: 50 }, { userId: 'b', value: 50 }]
 */
function normalizeSplits(members) {
    const totalSum = members.reduce((acc, m) => acc + m.value, 0);

    if (totalSum === 0) {
        throw new Error("Cannot normalize: total of member values is 0");
    }

    // Calculate each raw normalized value
    const rawValues = members.map((m) => (m.value / totalSum) * 100);

    // Floor to 4 decimal places
    const floored = rawValues.map((v) => Math.floor(v * 10000) / 10000);

    // Compute remainder and add to last entry so the total is exactly 100
    const flooredSum = floored.reduce((acc, v) => acc + v, 0);
    const remainder = Math.round((100 - flooredSum) * 10000) / 10000;
    floored[floored.length - 1] =
        Math.round((floored[floored.length - 1] + remainder) * 10000) / 10000;

    return members.map((m, i) => ({ userId: m.userId, value: floored[i] }));
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 4: computeRowHash
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes an MD5 fingerprint for a single CSV row to detect duplicate imports.
 *
 * The hash is built from a pipe-delimited string:
 *   `${date}|${description.toLowerCase().trim()}|${amountINR}|${paidById}`
 *
 * @param {string|number} date         - Expense date (e.g. "2026-06-13").
 * @param {string}        description  - Expense description (case-insensitive, trimmed).
 * @param {string|number} amountINR    - Amount in INR.
 * @param {string}        paidById     - UUID of the user who paid.
 *
 * @returns {string} 32-character lowercase MD5 hex string.
 *
 * @example
 *   computeRowHash("2026-06-13", "  Dinner  ", 1200, "uuid-123")
 *   // → "d41d8cd98f00b204e9800998ecf8427e" (illustrative)
 */
function computeRowHash(date, description, amountINR, paidById) {
    const input = `${date}|${String(description).toLowerCase().trim()}|${amountINR}|${paidById}`;
    return crypto.createHash("md5").update(input).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    calculateSplits,
    validateSplits,
    normalizeSplits,
    computeRowHash,
};
