import type { Config } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

// drizzle-kit runs outside Next, so load .env.local the same way Next does.
loadEnvConfig(process.cwd());

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
} satisfies Config;
