require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");

const logger = require("./lib/logger");

const authRoutes = require("./routes/auth");
const groupRoutes = require("./routes/groups");
const expenseRoutes = require("./routes/expenses");
const settlementRoutes = require("./routes/settlements");
const importRoutes = require("./routes/import");
const currencyRoutes = require("./routes/currency");

const app = express();

// ─── HTTP Request Logger (Morgan → Winston) ───────────────────────────────────
// dev format in development; combined (Apache-style) in production
const morganFormat = process.env.NODE_ENV === "production" ? "combined" : "dev";
app.use(morgan(morganFormat, { stream: logger.morganStream }));

// ─── Core Middleware ──────────────────────────────────────────────────────────
// Trust Render's proxy so secure cookies work
app.set("trust proxy", 1);

// Safely handle trailing slashes in CLIENT_URL
const clientUrl = process.env.CLIENT_URL ? process.env.CLIENT_URL.replace(/\/$/, "") : "http://localhost:5173";

app.use(
    cors({
        origin: [clientUrl, "http://localhost:5173", "https://splitwise-one-rho.vercel.app"],
        credentials: true,
    })
);
app.use(express.json());
app.use(cookieParser());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/groups", expenseRoutes);      // handles /:groupId/expenses and /:groupId/balances
app.use("/api/groups", settlementRoutes);   // handles /:groupId/settlements
app.use("/api/import", importRoutes);
app.use("/api/currency", currencyRoutes);

// ─── Keep-Alive Cron ──────────────────────────────────────────────────────────
// GET /api/cron — lightweight endpoint for uptime bots (Render keep-alive)
app.get("/api/cron", (_req, res) => {
    res.status(200).json({ status: "active", timestamp: new Date().toISOString() });
});

// ─── Health Check ─────────────────────────────────────────────────────────────
// GET /api/health  — checks server liveness + Supabase DB connectivity
app.get("/api/health", async (_req, res) => {
    const start = Date.now();
    let dbStatus = "unreachable";
    let dbLatencyMs = null;
    let dbError = null;

    try {
        const prisma = require("./lib/prisma");
        // Lightweight query — just ask the DB for the current timestamp
        await prisma.$queryRaw`SELECT 1`;
        dbLatencyMs = Date.now() - start;
        dbStatus = "connected";
        logger.info(`Health check OK — Supabase responded in ${dbLatencyMs}ms`);
    } catch (err) {
        dbError = err.message;
        logger.warn(`Health check — Supabase unreachable: ${err.message}`);
    }

    const healthy = dbStatus === "connected";
    res.status(healthy ? 200 : 503).json({
        status: healthy ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        server: "up",
        database: {
            status: dbStatus,
            latencyMs: dbLatencyMs,
            ...(dbError && { error: dbError }),
        },
    });
});


// ─── Global Error Handler ─────────────────────────────────────────────────────
// Must be defined last, after all routes.
// Express recognises it as an error handler because it has 4 parameters.
app.use((err, _req, res, _next) => {
    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || "Internal Server Error";

    logger.error(`${statusCode} — ${message}`, {
        stack: err.stack,
    });

    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    logger.info(
        `Splitwire server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
    );
});
