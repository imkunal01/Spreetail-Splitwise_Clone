const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("connect", () => {
  console.log("✅ Database connected");
});

pool.on("error", (err) => {
  console.error("❌ Unexpected database error:", err);
});

module.exports = pool;
