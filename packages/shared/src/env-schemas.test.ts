import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";
import {
  DEFAULT_SCANNER_USER_AGENT,
  adminEnvSchema,
  alertsEnvSchema,
  cronEnvSchema,
  loggingEnvSchema,
  scannerEnvSchema,
} from "./env-schemas";

describe("environment schemas", () => {
  it("gives the scanner safe defaults", () => {
    expect(parseEnv(scannerEnvSchema, {})).toEqual({
      SCANNER_USER_AGENT: DEFAULT_SCANNER_USER_AGENT,
      SCANNER_TIMEOUT_MS: 15_000,
      SCANNER_MAX_RESPONSE_BYTES: 5_000_000,
    });
  });

  it("rejects scanner timeouts outside the supported range", () => {
    expect(() => parseEnv(scannerEnvSchema, { SCANNER_TIMEOUT_MS: "500" })).toThrow(
      /SCANNER_TIMEOUT_MS/,
    );
  });

  it("normalizes the admin email list", () => {
    const env = parseEnv(adminEnvSchema, { ADMIN_EMAILS: " Owner@Example.com, ops@example.com ," });

    expect(env.ADMIN_EMAILS).toEqual(["owner@example.com", "ops@example.com"]);
  });

  it("rejects an admin list with an invalid email", () => {
    expect(() => parseEnv(adminEnvSchema, { ADMIN_EMAILS: "owner@example.com, nope" })).toThrow(
      /ADMIN_EMAILS/,
    );
  });

  it("requires a long cron secret", () => {
    expect(() => parseEnv(cronEnvSchema, { CRON_SECRET: "short" })).toThrow(
      /CRON_SECRET: must be at least 32 characters/,
    );
  });

  it("keeps the alert webhook optional", () => {
    expect(parseEnv(alertsEnvSchema, {})).toEqual({});
  });

  it("only accepts known log levels", () => {
    expect(parseEnv(loggingEnvSchema, {}).LOG_LEVEL).toBe("info");
    expect(() => parseEnv(loggingEnvSchema, { LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});
