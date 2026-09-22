import { z } from "zod";
import { LOG_LEVELS } from "./logger";

/**
 * Configuration contract for every deployable part of the system. Each consumer
 * composes only the groups it needs, so a job that never touches the database does
 * not require database credentials. Documented in `.env.example`.
 */

export const DEFAULT_SCANNER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0 Safari/537.36";

export const loggingEnvSchema = z.object({
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export const scannerEnvSchema = z.object({
  SCANNER_USER_AGENT: z.string().min(1).default(DEFAULT_SCANNER_USER_AGENT),
  SCANNER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  SCANNER_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(100_000)
    .max(20_000_000)
    .default(5_000_000),
});

export const databaseEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export const cronEnvSchema = z.object({
  CRON_SECRET: z.string().min(32, "must be at least 32 characters"),
});

export const adminEnvSchema = z.object({
  ADMIN_EMAILS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email !== ""),
    )
    .pipe(z.array(z.email()).min(1, "must list at least one email")),
});

export const alertsEnvSchema = z.object({
  ALERT_WEBHOOK_URL: z.url().optional(),
});
