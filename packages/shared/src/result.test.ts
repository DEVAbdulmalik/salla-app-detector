import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "./result";

function parsePort(input: string): Result<number, "not-a-number" | "out-of-range"> {
  const port = Number(input);
  if (!Number.isInteger(port)) {
    return err("not-a-number");
  }
  return port > 0 && port < 65_536 ? ok(port) : err("out-of-range");
}

describe("Result", () => {
  it("carries the value on success", () => {
    const result = parsePort("8080");

    expect(result).toEqual({ ok: true, value: 8080 });
  });

  it("carries a typed error on failure", () => {
    expect(parsePort("http")).toEqual({ ok: false, error: "not-a-number" });
    expect(parsePort("70000")).toEqual({ ok: false, error: "out-of-range" });
  });

  it("narrows on the ok discriminant", () => {
    const result = parsePort("443");

    const described = result.ok ? `port ${result.value}` : `invalid: ${result.error}`;

    expect(described).toBe("port 443");
  });
});
