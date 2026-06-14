const { Router } = require("express");
const { Prisma } = require("@prisma/client");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

// mergeParams: true so :groupId from the /api/groups parent mount is visible
const router = Router({ mergeParams: true });
router.use(requireAuth);

// ─── Helper ───────────────────────────────────────────────────────────────────
// No leftAt filter — past members are allowed to settle debts they accrued
// while they were still active.
async function findMember(groupId, userId) {
    return prisma.groupMembership.findFirst({
        where: { groupId, userId },
    });
}

// ─── POST /:groupId/settlements ───────────────────────────────────────────────
// Record that one member paid another to settle a debt.

router.post("/:groupId/settlements", async (req, res) => {
    try {
        const { groupId } = req.params;
        const { payerId, payeeId, amount, date, notes } = req.body;

        // ── 1. Amount must be a positive number ──────────────────────────────
        const amountNum = Number(amount);
        if (!amount || isNaN(amountNum) || amountNum <= 0) {
            return res.status(400).json({ error: "amount must be a positive number" });
        }

        // ── 2. Cannot settle with yourself ───────────────────────────────────
        if (!payerId || !payeeId) {
            return res.status(400).json({ error: "payerId and payeeId are required" });
        }
        if (payerId === payeeId) {
            return res.status(400).json({ error: "Cannot settle with yourself" });
        }

        // ── 3. Both must be active members ───────────────────────────────────
        const payerMembership = await findMember(groupId, payerId);
        if (!payerMembership) {
            return res.status(400).json({ error: "Payer is not a member of this group" });
        }

        const payeeMembership = await findMember(groupId, payeeId);
        if (!payeeMembership) {
            return res.status(400).json({ error: "Payee is not a member of this group" });
        }

        // ── 4. Date must be a valid date string ───────────────────────────────
        if (!date) {
            return res.status(400).json({ error: "date is required" });
        }
        const settlementDate = new Date(date);
        if (isNaN(settlementDate.getTime())) {
            return res.status(400).json({ error: "date is not a valid date string" });
        }

        // ── Create settlement ─────────────────────────────────────────────────
        const settlement = await prisma.settlement.create({
            data: {
                groupId,
                payerId,
                payeeId,
                amount: new Prisma.Decimal(amountNum),
                date: settlementDate,
                notes: notes || null,
            },
            include: {
                payer: { select: { id: true, name: true } },
                payee: { select: { id: true, name: true } },
            },
        });

        return res.status(201).json({ settlement });
    } catch (err) {
        console.error("[POST /:groupId/settlements]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── GET /:groupId/settlements ────────────────────────────────────────────────
// Fetch all settlements for a group, most-recent first.

router.get("/:groupId/settlements", async (req, res) => {
    try {
        const { groupId } = req.params;

        const settlements = await prisma.settlement.findMany({
            where: { groupId },
            include: {
                payer: { select: { id: true, name: true } },
                payee: { select: { id: true, name: true } },
            },
            orderBy: { date: "desc" },
        });

        return res.status(200).json({ settlements });
    } catch (err) {
        console.error("[GET /:groupId/settlements]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
