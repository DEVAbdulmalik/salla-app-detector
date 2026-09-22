import { parse } from "tldts";

export interface HostInfo {
  readonly host: string;
  /** Registrable domain, resolved with private suffixes so each tenant of a shared host is distinct. */
  readonly domain: string;
  /**
   * True when the registrable domain only exists because of a hosting provider's suffix,
   * such as `client-do9.pages.dev`. Matching those by their public suffix alone would tie
   * unrelated vendors together.
   */
  readonly isSharedHosting: boolean;
}

export function describeHost(hostOrUrl: string): HostInfo | undefined {
  const host = toHost(hostOrUrl);
  if (host === undefined) {
    return undefined;
  }
  const withPrivate = parse(host, { allowPrivateDomains: true }).domain;
  if (withPrivate === null) {
    return undefined;
  }
  const withoutPrivate = parse(host, { allowPrivateDomains: false }).domain;
  return {
    host,
    domain: withPrivate,
    isSharedHosting: withoutPrivate !== withPrivate,
  };
}

export function hostOf(url: string): string | undefined {
  return toHost(url);
}

function toHost(hostOrUrl: string): string | undefined {
  const value = hostOrUrl.trim();
  if (value === "") {
    return undefined;
  }
  if (value.includes("/") || value.includes(":")) {
    try {
      const parsed = new URL(value.startsWith("//") ? `https:${value}` : value);
      return parsed.hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }
  return value.toLowerCase();
}
