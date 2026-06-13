const jwt = require("jsonwebtoken");
const logger = require("../lib/logger");

function requireAuth(req, res, next) {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({ success: false, error: "Unauthorized: No token provided" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Contains userId, email, name, etc.
        next();
    } catch (err) {
        logger.warn(`Auth middleware error: ${err.message}`);
        return res.status(401).json({ success: false, error: "Unauthorized: Invalid or expired token" });
    }
}

module.exports = { requireAuth };
