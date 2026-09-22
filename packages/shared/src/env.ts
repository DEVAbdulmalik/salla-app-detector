import type { z } from "zod";

export type EnvSource = Readonly<Record<string, string | undefined>>;

export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";

  constructor(readonly problems: readonly string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
  }
}

/**
 * Validates environment variables against a schema at startup, so a missing or
 * malformed setting fails fast with a readable message instead of surfacing later
 * as an obscure runtime error. Blank values are treated as unset, which matches how
 * hosting dashboards represent a variable that was cleared.
 */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: EnvSource = process.env,
): z.output<Schema> {
  const values = withoutBlankValues(source);
  const result = schema.safeParse(values);
  if (result.success) {
    return result.data;
  }

  const problems = result.error.issues.map((issue) => {
    const key = issue.path.map(String).join(".") || "(root)";
    const isMissing = issue.code === "invalid_type" && !(key in values);
    return isMissing ? `${key} is required` : `${key}: ${issue.message}`;
  });
  throw new EnvValidationError(problems);
}

function withoutBlankValues(source: EnvSource): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") {
      values[key] = value;
    }
  }
  return values;
}
