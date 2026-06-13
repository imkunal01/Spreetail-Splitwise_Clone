const { Router } = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = Router();

// All routes require authentication
router.use(requireAuth);

// ─── POST / ────────────────────────────────────────────────────────────────────
// Create a new group and automatically add the creator as an active member.

router.post("/", async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Group name is required" });
        }

        const group = await prisma.$transaction(async (tx) => {
            const created = await tx.group.create({
                data: {
                    name: name.trim(),
                    createdById: req.user.userId,
                },
            });

            await tx.groupMembership.create({
                data: {
                    userId: req.user.userId,
                    groupId: created.id,
                    joinedAt: new Date(),
                },
            });

            return created;
        });

        return res.status(201).json({ group });
    } catch (err) {
        console.error("[POST /groups]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── GET / ─────────────────────────────────────────────────────────────────────
// Return all groups where the requesting user has any membership (active or past).

router.get("/", async (req, res) => {
    try {
        const memberships = await prisma.groupMembership.findMany({
            where: { userId: req.user.userId },
            include: {
                group: {
                    include: {
                        _count: {
                            select: { memberships: true },
                        },
                    },
                },
            },
            orderBy: { group: { createdAt: "desc" } },
        });

        const groups = memberships.map((m) => ({
            id: m.group.id,
            name: m.group.name,
            createdAt: m.group.createdAt,
            memberCount: m.group._count.memberships,
            userStatus: m.leftAt === null ? "active" : "left",
        }));

        return res.status(200).json({ groups });
    } catch (err) {
        console.error("[GET /groups]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── GET /:groupId ─────────────────────────────────────────────────────────────
// Return group details + full member list. User must have any membership record.

router.get("/:groupId", async (req, res) => {
    try {
        const { groupId } = req.params;

        // Verify the requesting user has a membership (active or historical)
        const callerMembership = await prisma.groupMembership.findFirst({
            where: { groupId, userId: req.user.userId },
        });

        if (!callerMembership) {
            return res.status(403).json({ error: "You are not a member of this group" });
        }

        const group = await prisma.group.findUnique({
            where: { id: groupId },
            select: {
                id: true,
                name: true,
                createdAt: true,
                createdById: true,
            },
        });

        if (!group) {
            return res.status(404).json({ error: "Group not found" });
        }

        const memberRows = await prisma.groupMembership.findMany({
            where: { groupId },
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
            orderBy: { joinedAt: "asc" },
        });

        const members = memberRows.map((m) => ({
            id: m.user.id,
            name: m.user.name,
            email: m.user.email,
            joinedAt: m.joinedAt,
            leftAt: m.leftAt,
            status: m.leftAt === null ? "active" : "left",
        }));

        return res.status(200).json({ group, members });
    } catch (err) {
        console.error("[GET /groups/:groupId]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── POST /:groupId/members ────────────────────────────────────────────────────
// Add a user (by email) to the group. Caller must be an active member.
// Re-adding a previously left member is allowed (creates a new row).

router.post("/:groupId/members", async (req, res) => {
    try {
        const { groupId } = req.params;
        const { email, joinedAt } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }
        if (!joinedAt) {
            return res.status(400).json({ error: "joinedAt is required" });
        }

        // Caller must be currently active
        const callerMembership = await prisma.groupMembership.findFirst({
            where: { groupId, userId: req.user.userId, leftAt: null },
        });

        if (!callerMembership) {
            return res
                .status(403)
                .json({ error: "You must be an active member to add members" });
        }

        // Find target user by email
        const targetUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true, name: true, email: true },
        });

        if (!targetUser) {
            return res.status(404).json({ error: "No user found with that email" });
        }

        // Check for existing ACTIVE membership (leftAt = null)
        const existingActive = await prisma.groupMembership.findFirst({
            where: { groupId, userId: targetUser.id, leftAt: null },
        });

        if (existingActive) {
            return res.status(409).json({ error: "User is already an active member" });
        }

        // Create a new membership row (allows re-adding previously left members)
        const membership = await prisma.groupMembership.create({
            data: {
                userId: targetUser.id,
                groupId,
                joinedAt: new Date(joinedAt),
            },
        });

        return res.status(201).json({ membership });
    } catch (err) {
        console.error("[POST /groups/:groupId/members]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── PATCH /:groupId/members/:userId/leave ─────────────────────────────────────
// Mark a member as having left the group.
// Caller must be the group creator OR the member being marked as left.

router.patch("/:groupId/members/:userId/leave", async (req, res) => {
    try {
        const { groupId, userId } = req.params;
        const { leftAt } = req.body;

        if (!leftAt) {
            return res.status(400).json({ error: "leftAt is required" });
        }

        // Load the group to check creator
        const group = await prisma.group.findUnique({
            where: { id: groupId },
            select: { createdById: true },
        });

        if (!group) {
            return res.status(404).json({ error: "Group not found" });
        }

        // Authorization: must be group creator OR the member themselves
        const isCreator = group.createdById === req.user.userId;
        const isSelf = req.user.userId === userId;

        if (!isCreator && !isSelf) {
            return res
                .status(403)
                .json({ error: "Not authorized to mark this member as left" });
        }

        // Find active membership
        const membership = await prisma.groupMembership.findFirst({
            where: { groupId, userId, leftAt: null },
        });

        if (!membership) {
            return res
                .status(404)
                .json({ error: "No active membership found for this user" });
        }

        // Validate leftAt >= joinedAt
        const leftDate = new Date(leftAt);
        const joinedDate = new Date(membership.joinedAt);

        if (leftDate < joinedDate) {
            return res
                .status(400)
                .json({ error: "leftAt must be on or after joinedAt" });
        }

        // Update membership
        const updated = await prisma.groupMembership.update({
            where: { id: membership.id },
            data: { leftAt: leftDate },
        });

        return res.status(200).json({ membership: updated });
    } catch (err) {
        console.error("[PATCH /groups/:groupId/members/:userId/leave]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
