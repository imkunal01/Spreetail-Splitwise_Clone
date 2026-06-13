const { Router } = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────


const isProduction = process.env.NODE_ENV === "production";

const COOKIE_OPTIONS = {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction, // must be true for sameSite: "none"
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

function signToken(user) {
    return jwt.sign(
        { userId: user.id, email: user.email, name: user.name },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
}

function safeUser(user) {
    return { id: user.id, name: user.name, email: user.email };
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── POST /signup ─────────────────────────────────────────────────────────────

router.post("/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Validation
        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Name is required" });
        }
        if (!email || !validateEmail(email)) {
            return res.status(400).json({ error: "A valid email is required" });
        }
        if (!password) {
            return res.status(400).json({ error: "Password is required" });
        }
        if (password.length < 8) {
            return res
                .status(400)
                .json({ error: "Password must be at least 8 characters" });
        }

        // Duplicate email check
        const existing = await prisma.user.findUnique({
            where: { email },
        });
        if (existing) {
            return res.status(409).json({ error: "Email already registered" });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const user = await prisma.user.create({
            data: {
                name: name.trim(),
                email,
                passwordHash,
            },
        });

        // Issue JWT cookie
        const token = signToken(user);
        res.cookie("token", token, COOKIE_OPTIONS);

        return res.status(201).json({ user: safeUser(user) });
    } catch (err) {
        console.error("[POST /signup]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── POST /login ──────────────────────────────────────────────────────────────

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        // Verify password
        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        // Issue JWT cookie
        const token = signToken(user);
        res.cookie("token", token, COOKIE_OPTIONS);

        return res.status(200).json({ user: safeUser(user) });
    } catch (err) {
        console.error("[POST /login]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// ─── POST /logout ─────────────────────────────────────────────────────────────

router.post("/logout", async (req, res) => {
    try {
        res.clearCookie("token");
        return res.status(200).json({ message: "Logged out successfully" });
    } catch (err) {
        console.error("[POST /logout]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

const { requireAuth } = require("../middleware/auth");

// ─── GET /me ──────────────────────────────────────────────────────────────────
// Protected — uses auth middleware to verify JWT and populate req.user

router.get("/me", requireAuth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.status(200).json({ user: safeUser(user) });
    } catch (err) {
        console.error("[GET /me]", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
