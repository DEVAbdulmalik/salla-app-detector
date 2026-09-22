import { err, ok, type Result } from "@salla-app-detector/shared";
import { z } from "zod";

const DISPATCH_MARKER = "salla.event.dispatchEvents(";
const SERVICE_PREFIX = "services::";
const SERVICE_SUFFIX = ".init";

export interface StoreConfig {
  readonly storeId: number;
  readonly storeName?: string;
  readonly username?: string;
  readonly storeUrl?: string;
  readonly themeName?: string;
  readonly twilightVersion?: string;
  readonly paymentMethods: readonly string[];
  /** Providers the merchant actually enabled, such as tabby or tamara. */
  readonly installments: readonly string[];
  /** Built-in integrations, with the `services::` prefix and `.init` suffix removed. */
  readonly serviceKeys: readonly string[];
}

export type ConfigError =
  | { readonly code: "not-found" }
  | { readonly code: "unterminated" }
  | { readonly code: "invalid-json" }
  | { readonly code: "schema-mismatch"; readonly issues: readonly string[] };

/**
 * Only the store id is required. Everything else is read defensively: Salla serialises an
 * empty map as `[]`, themes leave fields out, and a peripheral surprise should cost that
 * one field rather than the whole scan.
 */
const optionalText = z.string().optional().catch(undefined);

const storeSchema = z.looseObject({
  id: z.number(),
  name: optionalText,
  username: optionalText,
  url: optionalText,
  settings: z
    .looseObject({
      payments: z.array(z.string()).optional().catch(undefined),
      installments: z.record(z.string(), z.unknown()).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

const initSchema = z.looseObject({
  store: storeSchema,
  theme: z
    .looseObject({
      name: optionalText,
      twilight: z.looseObject({ version: optionalText }).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

const dispatchSchema = z.looseObject({ "twilight::init": initSchema });

/**
 * Reads the configuration Salla renders into every storefront. The payload is a JSON
 * argument inside a script tag, so it is located by scanning balanced braces rather than
 * by a regular expression, which would break on the nested HTML and quotes it contains.
 */
export function extractStoreConfig(html: string): Result<StoreConfig, ConfigError> {
  const markerIndex = html.indexOf(DISPATCH_MARKER);
  if (markerIndex < 0) {
    return err({ code: "not-found" });
  }

  const start = html.indexOf("{", markerIndex + DISPATCH_MARKER.length);
  if (start < 0) {
    return err({ code: "not-found" });
  }

  const end = findObjectEnd(html, start);
  if (end === undefined) {
    return err({ code: "unterminated" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(html.slice(start, end + 1));
  } catch {
    return err({ code: "invalid-json" });
  }

  const parsed = dispatchSchema.safeParse(payload);
  if (!parsed.success) {
    return err({
      code: "schema-mismatch",
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join(".")}: ${issue.message}`,
      ),
    });
  }

  const init = parsed.data["twilight::init"];
  const store = init.store;
  const settings = store.settings;

  return ok({
    storeId: store.id,
    ...optional("storeName", store.name),
    ...optional("username", store.username),
    ...optional("storeUrl", store.url),
    ...optional("themeName", init.theme?.name),
    ...optional("twilightVersion", init.theme?.twilight?.version),
    paymentMethods: settings?.payments ?? [],
    installments: enabledInstallments(settings?.installments),
    serviceKeys: serviceKeysOf(parsed.data),
  });
}

function findObjectEnd(html: string, start: number): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return undefined;
}

function enabledInstallments(installments: Record<string, unknown> | undefined): readonly string[] {
  if (!installments) {
    return [];
  }
  return Object.entries(installments)
    .filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return typeof value === "object" && value !== null && Object.keys(value).length > 0;
    })
    .map(([provider]) => provider)
    .sort();
}

function serviceKeysOf(payload: Record<string, unknown>): readonly string[] {
  return Object.keys(payload)
    .filter((key) => key.startsWith(SERVICE_PREFIX))
    .map((key) => {
      const withoutPrefix = key.slice(SERVICE_PREFIX.length);
      return withoutPrefix.endsWith(SERVICE_SUFFIX)
        ? withoutPrefix.slice(0, -SERVICE_SUFFIX.length)
        : withoutPrefix;
    })
    .sort();
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
