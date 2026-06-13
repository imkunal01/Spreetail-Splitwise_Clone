import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 config — loads env vars for CLI commands (migrate, generate, introspect).
// The runtime adapter (PrismaClient + pg pool) lives in server/lib/prisma.js.
import "dotenv/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),

  // datasource.url is required for all CLI commands (migrate dev / introspect).
  // Use DIRECT_URL (non-pooled, port 5432) so the shadow database works correctly.
  // Falls back to DATABASE_URL when DIRECT_URL is not yet configured.
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
