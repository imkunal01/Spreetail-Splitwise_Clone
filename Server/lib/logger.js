const { createLogger, format, transports } = require("winston");
const chalk = require("chalk");

// ─── Chalk level palette ───────────────────────────────────────────────────────
const LEVEL_STYLES = {
    error: (t) => chalk.bold.red(t),
    warn:  (t) => chalk.bold.yellow(t),
    info:  (t) => chalk.bold.cyan(t),
    http:  (t) => chalk.bold.magenta(t),
    debug: (t) => chalk.bold.gray(t),
};

// ─── Custom console format ────────────────────────────────────────────────────
const consoleFormat = format.printf(({ level, message, timestamp, ...meta }) => {
    const styleFn = LEVEL_STYLES[level] || ((t) => t);
    const lvlTag  = styleFn(`[${level.toUpperCase().padEnd(5)}]`);
    const ts      = chalk.dim(timestamp);
    const msg     = typeof message === "object"
        ? JSON.stringify(message, null, 2)
        : message;

    const metaStr = Object.keys(meta).length
        ? chalk.dim(" " + JSON.stringify(meta))
        : "";

    return `${ts} ${lvlTag} ${msg}${metaStr}`;
});

// ─── Winston logger ───────────────────────────────────────────────────────────
const logger = createLogger({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
    format: format.combine(
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        format.errors({ stack: true }),
        format.splat(),
    ),
    transports: [
        // Pretty, coloured output in the terminal
        new transports.Console({
            format: format.combine(
                format.colorize({ all: false }),
                consoleFormat
            ),
        }),
        // Machine-readable JSON log file (errors only)
        new transports.File({
            filename: "logs/error.log",
            level: "error",
            format: format.json(),
        }),
        // All levels to a combined log file
        new transports.File({
            filename: "logs/combined.log",
            format: format.json(),
        }),
    ],
});

// ─── Morgan stream → Winston http level ──────────────────────────────────────
// Used by the morgan middleware in index.js
logger.morganStream = {
    write: (message) => {
        // Morgan appends \n — trim it before handing to Winston
        logger.http(message.trimEnd());
    },
};

module.exports = logger;
