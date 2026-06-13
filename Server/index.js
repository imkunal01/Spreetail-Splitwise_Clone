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
app.use(
    cors({
        origin: process.env.CLIENT_URL || "http://localhost:5173",
        credentials: true,
    })
);
app.use(express.json());
app.use(cookieParser());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/settlements", settlementRoutes);
app.use("/api/import", importRoutes);
app.use("/api/currency", currencyRoutes);

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
        `Splitmate server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
    );
});
