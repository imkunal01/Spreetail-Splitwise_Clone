const { Router } = require("express");
const { Prisma } = require("@prisma/client");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");
const { calculateSplits, validateSplits, computeRowHash } = require("../lib/splitCalculator");

// mergeParams: true lets us access :groupId from the parent /api/groups mount
const router = Router({ mergeParams: true });
router.use(requireAuth);

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Returns all members who were active in `groupId` on `date`.
 * A member is active if:   joinedAt <= date  AND  (leftAt IS NULL OR leftAt >= date)
 *
 * @param {string}  groupId
 * @param {Date}    date
 * @param {object}  client  - prisma or a transaction client (tx)
 * @returns {{ userId: string, name: string }[]}
 */
async function getActiveMembersOnDate(groupId, date, client) {
    const memberships = await client.groupMembership.findMany({
        where: {
            groupId,
            joinedAt: { lte: date },
            OR: [{ leftAt: null }, { leftAt: { gte: date } }],
        },
        include: {
            user: { select: { id: true, name: true } },
        },
    });

    return memberships.map((m) => ({ userId: m.userId, name: m.user.name }));
}

// ─── POST /:groupId/expenses ──────────────────────────────────────────────────
// Create a new expense with automatic split calculation.

router.post("/:groupId/expenses", async (req, res) => {
    try {
        const { groupId } = req.params;
        const {
            description,
            amount,
            currency,
            exchangeRate,
            paidById,
            date,
            splitType,
            splits,
            notes,
            isRefund,
        } = req.body;

        // ── 1. Validate required fields ──────────────────────────────────────
        const missing = [];
        if (!description)  missing.push("description");
        if (amount  == null) missing.push("amount");
        if (!currency)     missing.push("currency");
        if (exchangeRate == null) missing.push("exchangeRate");
        if (!paidById)     missing.push("paidById");
        if (!date)         missing.push("date");
        if (!splitType)    missing.push("splitType");

        if (missing.length > 0) {
            return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
        }

        // ── 2. Derived values ────────────────────────────────────────────────
        const expenseDate = new Date(date);
        const amountINR = Math.round(Number(amount) * Number(exchangeRate) * 100) / 100;

        // ── 3. Resolve splits input ──────────────────────────────────────────
        let splitsInput;

        if (splitType === "EQUAL") {
            // For EQUAL, ignore splits from the body — use active members on that date
            const activeMembers = await getActiveMembersOnDate(groupId, expenseDate, prisma);
            if (activeMembers.length === 0) {
                return res.status(400).json({ error: "No active members found for this group on the expense date" });
            }
            splitsInput = activeMembers.map((m) => ({ userId: m.userId, value: 0 }));
        } else {
            splitsInput = splits;
            if (!Array.isArray(splitsInput) || splitsInput.length === 0) {
                return res.status(400).json({ error: "splits array is required for non-EQUAL split types" });
            }

            const validationResult = validateSplits(splitType, splitsInput, amountINR);
            if (!validationResult.valid) {
                return res.status(400).json({ error: validationResult.error });
            }
        }

        // ── 4. Calculate final split amounts ─────────────────────────────────
        const finalSplits = calculateSplits(splitType, amountINR, splitsInput);

        // ── 5. Compute deduplication hash ────────────────────────────────────
        const hash = computeRowHash(date, description, amountINR, paidById);

        // ── 6. Persist in a transaction ──────────────────────────────────────
        const expense = await prisma.$transaction(async (tx) => {
            const created = await tx.expense.create({
                data: {
                    groupId,
                    description: description.trim(),
                    amount: new Prisma.Decimal(amount),
                    currency,
                    exchangeRate: new Prisma.Decimal(exchangeRate),
                    amountInr: new Prisma.Decimal(amountINR),
                    paidById,
                    date: expenseDate,
                    splitType,
                    isRefund: isRefund || false,
                    notes: notes || null,
                    importedRowHash: hash,
                },
            });

            await tx.expenseSplit.createMany({
                data: finalSplits.map((s) => ({
                    expenseId: created.id,
                    userId: s.userId,
                    amountOwed: new Prisma.Decimal(s.amountOwed),
                })),
            });

            return created;
        });

        // ── 7. Fetch full expense with relations ─────────────────────────────
        const fullExpense = await prisma.expense.findUnique({
            where: { id: expense.id },
            include: {
                paidBy: { select: { id: true, name: true, email: true } },
                splits: {
                    include: { user: { select: { id: true, name: true } } },
                },
            },
        });

        // ── 8. Respond ───────────────────────────────────────────────────────
        return res.status(201).json({ expense: fullExpense });
    } catch (err) {
        console.error("[POST /:groupId/expenses]", err);

        // Surface duplicate-hash unique constraint as a meaningful error
        if (err.code === "P2002" && err.meta?.target?.includes("imported_row_hash")) {
            return res.status(409).json({ error: "A duplicate expense with the same details already exists" });
        }

        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── GET /:groupId/expenses ───────────────────────────────────────────────────
// Fetch all expenses for a group, ordered most-recent first.

router.get("/:groupId/expenses", async (req, res) => {
    try {
        const { groupId } = req.params;

        const expenses = await prisma.expense.findMany({
            where: { groupId },
            include: {
                paidBy: { select: { id: true, name: true, email: true } },
                splits: {
                    include: { user: { select: { id: true, name: true } } },
                },
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        });

        return res.status(200).json({ expenses });
    } catch (err) {
        console.error("[GET /:groupId/expenses]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── DELETE /:groupId/expenses/:expenseId ─────────────────────────────────────
// Only the expense payer or the group creator may delete an expense.
// ExpenseSplit rows are removed automatically via DB cascade.

router.delete("/:groupId/expenses/:expenseId", async (req, res) => {
    try {
        const { groupId, expenseId } = req.params;

        // ── 1. Load expense and verify it belongs to this group ──────────────
        const expense = await prisma.expense.findUnique({
            where: { id: expenseId },
            select: { id: true, groupId: true, paidById: true },
        });

        if (!expense || expense.groupId !== groupId) {
            return res.status(404).json({ error: "Expense not found" });
        }

        // ── 2. Load group to get creator ─────────────────────────────────────
        const group = await prisma.group.findUnique({
            where: { id: groupId },
            select: { createdById: true },
        });

        if (!group) {
            return res.status(404).json({ error: "Group not found" });
        }

        // ── 3. Authorise: must be the payer OR the group creator ─────────────
        const isPayer = req.user.userId === expense.paidById;
        const isCreator = req.user.userId === group.createdById;

        if (!isPayer && !isCreator) {
            return res.status(403).json({ error: "Not authorized to delete this expense" });
        }

        // ── 4. Delete (cascade removes ExpenseSplit rows automatically) ───────
        await prisma.expense.delete({ where: { id: expenseId } });

        return res.status(200).json({ message: "Expense deleted" });
    } catch (err) {
        console.error("[DELETE /:groupId/expenses/:expenseId]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── PATCH /:groupId/expenses/:expenseId/reassign ─────────────────────────────
// Reassign an expense currently paid by the Unknown User (isGuest=true) to a
// real active member of the group.
// Body: { newPayerId: string }

router.patch("/:groupId/expenses/:expenseId/reassign", async (req, res) => {
    try {
        const { groupId, expenseId } = req.params;
        const { newPayerId } = req.body;

        if (!newPayerId) {
            return res.status(400).json({ error: "newPayerId is required" });
        }

        // ── 1. Fetch expense and verify it belongs to this group ─────────────
        const expense = await prisma.expense.findUnique({
            where: { id: expenseId },
            include: {
                paidBy: { select: { id: true, name: true, isGuest: true } },
            },
        });

        if (!expense || expense.groupId !== groupId) {
            return res.status(404).json({ error: "Expense not found" });
        }

        // ── 2. Only guest/Unknown-User expenses can be reassigned ────────────
        if (!expense.paidBy.isGuest) {
            return res.status(400).json({
                error: "Only expenses paid by Unknown User can be reassigned",
            });
        }

        // ── 3. Verify newPayerId is an active member of the group ────────────
        const expenseDate = new Date(expense.date);

        const activeMembership = await prisma.groupMembership.findFirst({
            where: {
                groupId,
                userId: newPayerId,
                joinedAt: { lte: expenseDate },
                OR: [{ leftAt: null }, { leftAt: { gte: expenseDate } }],
            },
        });

        if (!activeMembership) {
            return res.status(400).json({
                error: "newPayerId is not an active member of the group on the expense date",
            });
        }

        // ── 4 & 5. Update paidById; recalculate splits if EQUAL ─────────────
        const amountINR = Number(expense.amountInr);

        const updatedExpense = await prisma.$transaction(async (tx) => {
            // Always update the payer
            const updated = await tx.expense.update({
                where: { id: expenseId },
                data:  { paidById: newPayerId },
            });

            // Recalculate splits only for EQUAL split type
            if (expense.splitType === "EQUAL") {
                const activeMembers = await getActiveMembersOnDate(groupId, expenseDate, tx);

                if (activeMembers.length === 0) {
                    throw new Error("No active members found for this group on the expense date");
                }

                const splitsInput  = activeMembers.map((m) => ({ userId: m.userId, value: 0 }));
                const newSplits    = calculateSplits("EQUAL", amountINR, splitsInput);

                // Replace old splits
                await tx.expenseSplit.deleteMany({ where: { expenseId } });
                await tx.expenseSplit.createMany({
                    data: newSplits.map((s) => ({
                        expenseId,
                        userId:     s.userId,
                        amountOwed: new Prisma.Decimal(s.amountOwed),
                    })),
                });
            }

            return updated;
        });

        // ── 6. Return full updated expense ────────────────────────────────────
        const fullExpense = await prisma.expense.findUnique({
            where: { id: updatedExpense.id },
            include: {
                paidBy: { select: { id: true, name: true, email: true, isGuest: true } },
                splits: {
                    include: { user: { select: { id: true, name: true, isGuest: true } } },
                },
            },
        });

        return res.status(200).json({ expense: fullExpense });
    } catch (err) {
        console.error("[PATCH /:groupId/expenses/:expenseId/reassign]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── GET /:groupId/balances ───────────────────────────────────────────────────
// Returns net balances, simplified settlement transactions, and a per-user
// expense breakdown for the group.

router.get("/:groupId/balances", async (req, res) => {
    try {
        const { groupId } = req.params;

        // ── STEP 1: Fetch all memberships ─────────────────────────────────────
        const memberships = await prisma.groupMembership.findMany({
            where: { groupId },
            include: { user: { select: { id: true, name: true } } },
        });

        // memberMap: { [userId]: { name, joinedAt, leftAt } }
        const memberMap = {};
        for (const m of memberships) {
            memberMap[m.userId] = {
                name: m.user.name,
                joinedAt: new Date(m.joinedAt),
                leftAt: m.leftAt ? new Date(m.leftAt) : null,
            };
        }

        // ── STEP 2: Initialise balances ───────────────────────────────────────
        const balances = {};
        for (const m of memberships) {
            balances[m.userId] = 0;
        }

        // ── Helper ────────────────────────────────────────────────────────────
        function isActiveOnDate(membership, date) {
            return (
                membership.joinedAt <= date &&
                (membership.leftAt === null || membership.leftAt >= date)
            );
        }

        // ── STEP 3: Fetch expenses (exclude settlement expenses) ───────────────
        const expenses = await prisma.expense.findMany({
            where: { groupId, isSettlement: false },
            include: { splits: true },
        });

        // ── STEP 4: Process each expense ──────────────────────────────────────
        // Also build breakdown: { [userId]: [{ expenseId, description, date, amountOwed, isRefund }] }
        const breakdown = {};
        for (const uid of Object.keys(balances)) {
            breakdown[uid] = [];
        }

        for (const expense of expenses) {
            const expenseDate = new Date(expense.date);
            const payerId = expense.paidById;
            const amountINR = Number(expense.amountInr);
            const isRefund = expense.isRefund;

            // Credit / debit the payer
            if (memberMap[payerId] && isActiveOnDate(memberMap[payerId], expenseDate)) {
                balances[payerId] += isRefund ? -amountINR : amountINR;
            }

            // Debit / credit each split participant
            for (const split of expense.splits) {
                const splitUserId = split.userId;
                const amountOwed = Number(split.amountOwed);

                if (!memberMap[splitUserId]) continue;
                if (!isActiveOnDate(memberMap[splitUserId], expenseDate)) continue;

                balances[splitUserId] += isRefund ? amountOwed : -amountOwed;

                // Append to breakdown
                if (!breakdown[splitUserId]) breakdown[splitUserId] = [];
                breakdown[splitUserId].push({
                    expenseId: expense.id,
                    description: expense.description,
                    date: expense.date,
                    amountOwed,
                    isRefund,
                });
            }
        }

        // ── STEP 5: Apply settlements ─────────────────────────────────────────
        const settlements = await prisma.settlement.findMany({ where: { groupId } });
        for (const s of settlements) {
            if (balances[s.payerId] !== undefined) balances[s.payerId] += Number(s.amount);
            if (balances[s.payeeId] !== undefined) balances[s.payeeId] -= Number(s.amount);
        }

        // ── STEP 6: Build netBalances array ───────────────────────────────────
        const netBalances = Object.entries(balances).map(([userId, balance]) => ({
            userId,
            name: memberMap[userId]?.name || "Unknown",
            balance: Math.round(balance * 100) / 100,
        }));

        // ── STEP 7: (breakdown already built in Step 4) ───────────────────────

        // ── STEP 8: Debt simplification — greedy algorithm ────────────────────
        const creditors = netBalances
            .filter((m) => m.balance > 0.01)
            .map((m) => ({ ...m }))
            .sort((a, b) => b.balance - a.balance);

        const debtors = netBalances
            .filter((m) => m.balance < -0.01)
            .map((m) => ({ ...m }))
            .sort((a, b) => a.balance - b.balance);

        const transactions = [];
        while (creditors.length > 0 && debtors.length > 0) {
            const creditor = creditors[0];
            const debtor = debtors[0];

            const amount = Math.round(
                Math.min(creditor.balance, Math.abs(debtor.balance)) * 100
            ) / 100;

            transactions.push({
                fromUserId: debtor.userId,
                fromName: debtor.name,
                toUserId: creditor.userId,
                toName: creditor.name,
                amount,
            });

            creditor.balance = Math.round((creditor.balance - amount) * 100) / 100;
            debtor.balance = Math.round((debtor.balance + amount) * 100) / 100;

            if (creditor.balance < 0.01) creditors.shift();
            if (debtor.balance > -0.01) debtors.shift();
        }

        // ── STEP 9: Respond ───────────────────────────────────────────────────
        return res.status(200).json({ netBalances, transactions, breakdown });
    } catch (err) {
        console.error("[GET /:groupId/balances]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
