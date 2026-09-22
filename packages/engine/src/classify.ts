import type { PageStatus } from "./types";

export interface PageInput {
  readonly status: number;
  readonly finalUrl: string;
  readonly html: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface PageClassification {
  readonly status: PageStatus;
  readonly detail?: string;
}

const MAINTENANCE_MARKERS = ["/css/maintenance.css", "stores/css/maintenance.css"];

const SALLA_MARKERS = [
  "salla.event.dispatchEvents(",
  "cdn.assets.salla.network",
  "cdn.salla.network",
  "twilight.esm.js",
];

/**
 * Titles of the interstitials themselves. The `/cdn-cgi/challenge-platform/` script is
 * deliberately not listed: Cloudflare injects it into ordinary pages as well, so treating
 * it as a block would reject nearly every storefront.
 */
const CHALLENGE_MARKERS = [
  "Just a moment...",
  "Checking your browser before accessing",
  "Attention Required! | Cloudflare",
  "Verifying you are human",
];

const BLOCKED_STATUSES = new Set([401, 403, 429, 503]);

/**
 * Decides what a fetched page actually is before anything tries to read apps out of it.
 * `unsupported` is the interesting one: Salla is clearly serving the page but its
 * configuration could not be read, which usually means the platform changed its markup.
 */
export function classifyPage(page: PageInput, configFound: boolean): PageClassification {
  const looksLikeSalla = SALLA_MARKERS.some((marker) => page.html.includes(marker));

  // The header is set by the edge itself, so it is conclusive. The body wording is only
  // trustworthy when the page is not already recognisable as a storefront.
  if (
    BLOCKED_STATUSES.has(page.status) ||
    wasMitigated(page) ||
    (!looksLikeSalla && hasChallengeWording(page))
  ) {
    return { status: "blocked", detail: `HTTP ${page.status}` };
  }
  if (page.status === 410) {
    return { status: "closed", detail: "HTTP 410" };
  }
  if (MAINTENANCE_MARKERS.some((marker) => page.html.includes(marker))) {
    return { status: "maintenance" };
  }
  if (!looksLikeSalla) {
    return { status: "not-salla", detail: `HTTP ${page.status}` };
  }
  if (!configFound) {
    return { status: "unsupported", detail: "Salla page without a readable configuration" };
  }
  return { status: "live" };
}

function wasMitigated(page: PageInput): boolean {
  const mitigated = page.headers?.["cf-mitigated"];
  return mitigated !== undefined && mitigated !== "";
}

function hasChallengeWording(page: PageInput): boolean {
  return CHALLENGE_MARKERS.some((marker) => page.html.includes(marker));
}
