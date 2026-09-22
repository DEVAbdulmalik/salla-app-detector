import { err, ok, type Result } from "@salla-app-detector/shared";

export type StoreTargetKind = "salla-slug" | "custom-domain";

export interface StoreTarget {
  /** Root page to fetch. */
  readonly url: string;
  readonly host: string;
  readonly kind: StoreTargetKind;
  /** Store handle, only for stores served from a salla.sa path. */
  readonly slug?: string;
}

export type TargetError =
  | { readonly code: "empty" }
  | { readonly code: "invalid-url" }
  | { readonly code: "unsupported-scheme"; readonly scheme: string }
  | { readonly code: "platform-page"; readonly host: string }
  | { readonly code: "missing-slug" }
  | { readonly code: "not-a-domain"; readonly host: string };

const SALLA_HOSTS = new Set(["salla.sa", "www.salla.sa", "salla.com", "www.salla.com"]);

/** Salla's own sites, none of which is a merchant storefront. */
const PLATFORM_HOSTS = new Set([
  "apps.salla.sa",
  "help.salla.sa",
  "s.salla.sa",
  "accounts.salla.sa",
  "accounts.salla.com",
  "docs.salla.dev",
  "api.salla.dev",
  "salla.dev",
  "www.salla.dev",
]);

/** Paths under salla.sa that belong to the platform rather than to a store. */
const RESERVED_SLUGS = new Set([
  "ar",
  "en",
  "apps",
  "blog",
  "careers",
  "contact",
  "help",
  "login",
  "logout",
  "pricing",
  "privacy",
  "register",
  "terms",
]);

const LOCALE_SEGMENTS = new Set(["ar", "en"]);

/**
 * Turns whatever a person pastes into the storefront's root URL: a bare domain, a product
 * link, a category link, or a salla.sa handle, with or without a locale prefix.
 */
export function normalizeTarget(input: string): Result<StoreTarget, TargetError> {
  const trimmed = input.trim();
  if (trimmed === "") {
    return err({ code: "empty" });
  }

  const url = parseUrl(trimmed);
  if (!url) {
    return err({ code: "invalid-url" });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err({ code: "unsupported-scheme", scheme: url.protocol.replace(":", "") });
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (PLATFORM_HOSTS.has(host)) {
    return err({ code: "platform-page", host });
  }
  if (!host.includes(".") || isIpAddress(host)) {
    return err({ code: "not-a-domain", host });
  }

  const segments = url.pathname.split("/").filter((segment) => segment !== "");

  if (SALLA_HOSTS.has(host) || host.endsWith(".salla.sa")) {
    const slug = firstMeaningfulSegment(segments);
    if (slug === undefined) {
      return err({ code: "missing-slug" });
    }
    if (SALLA_HOSTS.has(host) && RESERVED_SLUGS.has(slug)) {
      return err({ code: "platform-page", host });
    }
    const canonicalHost = host.startsWith("www.") ? host.slice(4) : host;
    return ok({
      url: `https://${canonicalHost}/${slug}`,
      host: canonicalHost,
      kind: "salla-slug",
      slug,
    });
  }

  return ok({ url: `https://${host}/`, host, kind: "custom-domain" });
}

function parseUrl(input: string): URL | undefined {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme);
  } catch {
    return undefined;
  }
}

function firstMeaningfulSegment(segments: readonly string[]): string | undefined {
  for (const segment of segments) {
    const decoded = safeDecode(segment).toLowerCase();
    if (!LOCALE_SEGMENTS.has(decoded)) {
      return decoded;
    }
  }
  return undefined;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}
