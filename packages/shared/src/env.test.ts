import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EnvValidationError, parseEnv } from "./env";

const schema = z.object({
  API_URL: z.url(),
  RETRIES: z.coerce.number().int().min(0).default(3),
});

describe("parseEnv", () => {
  it("returns typed values and applies defaults", () => {
    const env = parseEnv(schema, { API_URL: "https://api.salla.dev" });

    expect(env).toEqual({ API_URL: "https://api.salla.dev", RETRIES: 3 });
  });

  it("coerces numeric strings", () => {
    const env = parseEnv(schema, { API_URL: "https://api.salla.dev", RETRIES: "5" });

    expect(env.RETRIES).toBe(5);
  });

  it("treats blank values as unset", () => {
    const env = parseEnv(schema, { API_URL: "https://api.salla.dev", RETRIES: "  " });

    expect(env.RETRIES).toBe(3);
  });

  it("reports a missing variable as required", () => {
    expect(() => parseEnv(schema, {})).toThrow(new EnvValidationError(["API_URL is required"]));
  });

  it("collects every problem into a single error", () => {
    let caught: unknown;
    try {
      parseEnv(schema, { API_URL: "not a url", RETRIES: "-1" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    const { problems, message } = caught as EnvValidationError;
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^API_URL: /);
    expect(problems[1]).toMatch(/^RETRIES: /);
    expect(message).toContain("Invalid environment configuration:");
  });
});
