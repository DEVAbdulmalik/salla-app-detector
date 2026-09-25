import { err, ok, type Result } from "@salla-app-detector/shared";
import type { z } from "zod";
import type { HostLimiter } from "./limiter";
import {
  safeFetch,
  type FetchFailure,
  type FetchedPage,
  type SafeFetchOptions,
} from "./safe-fetch";
import {
  appDetailsSchema,
  appReviewsSchema,
  catalogPageSchema,
  themeCatalogSchema,
  menuListSchema,
  productListSchema,
  searchTokenSchema,
  type AppDetailsPayload,
  type AppReviewPayload,
  type CatalogHit,
  type MenuEntry,
} from "./schemas";

const STORE_API = "https://api.salla.dev/store/v1";
const MARKETPLACE_API = "https://api.salla.dev/marketplace/v2";
/** Themes are not on the marketplace API; the theme store publishes its own listing. */
const THEME_CATALOG = "https://salla.com/themes/api/themes";
const ALGOLIA_APP_ID = "VLRNJKLRFI";
const ALGOLIA_INDEX = "apps_index";
const CATALOG_PAGE_SIZE = 1000;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0 Safari/537.36";

export type ApiFailure =
  | FetchFailure
  | { readonly code: "http"; readonly status: number; readonly endpoint: string }
  | { readonly code: "invalid-json"; readonly endpoint: string }
  | {
      readonly code: "schema-drift";
      readonly endpoint: string;
      readonly issues: readonly string[];
    };

export interface ProductSummary {
  readonly sku?: string;
  readonly imageUrls: readonly string[];
}

export interface AppDetails {
  readonly id: string;
  readonly name: string;
  readonly companyId?: string;
  readonly companyName?: string;
  readonly categories: readonly string[];
  /** Every site the vendor points at, which is what links a domain back to an app. */
  readonly domains: readonly string[];
}

export interface AppReviewer {
  readonly reviewId: string;
  readonly storeName: string;
  /** Present when the avatar reveals which store left the review. */
  readonly storeId?: string;
  /** The other avatar form: a CDN code that the scan index can turn into a host. */
  readonly storeCode?: string;
  readonly date?: string;
}

export interface AppReviews {
  readonly reviewers: readonly AppReviewer[];
  readonly nextPage?: number;
}

export interface CatalogTheme {
  readonly id: string;
  readonly name: string;
  readonly listingId: string;
  readonly developer?: string;
  readonly version?: string;
  readonly rating?: number;
  readonly ratingsCount?: number;
  readonly isBeta?: boolean;
}

export interface CatalogApp {
  readonly id: string;
  readonly name: string;
  readonly nameEn?: string;
  readonly company?: string;
  readonly categories: readonly string[];
  readonly isSalla: boolean;
  readonly installs?: number;
}

export type PageFetcher = (
  url: string,
  options: SafeFetchOptions,
) => Promise<Result<FetchedPage, FetchFailure>>;

export interface SallaClientOptions {
  readonly userAgent?: string;
  readonly timeoutMs?: number;
  /** Retries double the wait for a host that is refusing us, so callers can opt out. */
  readonly attempts?: number;
  /** Paces requests so a burst against one host is queued rather than refused. */
  readonly limiter?: HostLimiter;
  /** Replaced in tests so the client can be exercised without network access. */
  readonly fetchPage?: PageFetcher;
  readonly now?: () => Date;
}

const AVATAR_STORE_ID = /\/theme\/(\d+)\//;
const AVATAR_STORE_CODE = /cdn\.salla\.sa\/([A-Za-z0-9_-]{4,12})\//;

export class SallaClient {
  readonly #fetchPage: PageFetcher;
  readonly #userAgent: string;
  readonly #timeoutMs: number | undefined;
  readonly #attempts: number | undefined;
  readonly #limiter: HostLimiter | undefined;
  readonly #now: () => Date;
  #searchToken: { value: string; expiresAt: Date } | undefined;

  constructor(options: SallaClientOptions = {}) {
    this.#fetchPage = options.fetchPage ?? safeFetch;
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.#timeoutMs = options.timeoutMs;
    this.#attempts = options.attempts;
    this.#limiter = options.limiter;
    this.#now = options.now ?? (() => new Date());
  }

  /** Fetches a storefront page as a browser would, following the store's redirects. */
  async fetchStorefront(url: string): Promise<Result<FetchedPage, FetchFailure>> {
    return this.#fetchPage(url, {
      ...this.#common(),
      headers: {
        "user-agent": this.#userAgent,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ar,en;q=0.8",
      },
    });
  }

  async fetchProducts(
    storeId: number,
    perPage = 30,
  ): Promise<Result<ProductSummary[], ApiFailure>> {
    const endpoint = `${STORE_API}/products?per_page=${String(perPage)}`;
    const payload = await this.#json(endpoint, productListSchema, {
      headers: this.#storeHeaders(storeId),
    });
    if (!payload.ok) {
      return payload;
    }

    return ok(
      payload.value.data.map((product) => ({
        ...(typeof product.sku === "string" && product.sku !== "" ? { sku: product.sku } : {}),
        imageUrls: [
          product.image?.url,
          typeof product.original_image === "string" ? product.original_image : undefined,
          ...(product.images ?? []).map((image) => image.url),
        ].filter((url): url is string => typeof url === "string" && url.startsWith("http")),
      })),
    );
  }

  /**
   * Finds where a store lives from its numeric id. Menus usually carry absolute links; a
   * store with an empty menu still exposes product URLs.
   */
  async resolveStoreUrl(storeId: number): Promise<Result<string, ApiFailure>> {
    for (const path of ["menus/header", "menus/footer"]) {
      const payload = await this.#json(`${STORE_API}/${path}`, menuListSchema, {
        headers: this.#storeHeaders(storeId),
      });
      if (!payload.ok) {
        return payload;
      }
      const origin = firstOrigin(payload.value.data);
      if (origin !== undefined) {
        return ok(origin);
      }
    }

    const products = await this.#json(`${STORE_API}/products?per_page=1`, productListSchema, {
      headers: this.#storeHeaders(storeId),
    });
    if (!products.ok) {
      return products;
    }
    const url = products.value.data
      .map((product) => product.url)
      .find((value): value is string => typeof value === "string");
    const origin = url === undefined ? undefined : originOf(url);

    return origin === undefined
      ? err({ code: "http", status: 404, endpoint: `${STORE_API}/menus/header` })
      : ok(origin);
  }

  async fetchAppDetails(appId: string): Promise<Result<AppDetails, ApiFailure>> {
    const endpoint = `${MARKETPLACE_API}/apps/${appId}`;
    const payload = await this.#json(endpoint, appDetailsSchema, {});
    if (!payload.ok) {
      return payload;
    }
    return ok(toAppDetails(payload.value.data));
  }

  async fetchAppReviews(appId: string, page = 1): Promise<Result<AppReviews, ApiFailure>> {
    const endpoint = `${MARKETPLACE_API}/apps/${appId}/reviews?page=${String(page)}`;
    const payload = await this.#json(endpoint, appReviewsSchema, {});
    if (!payload.ok) {
      return payload;
    }

    const reviewers = payload.value.data.map((review): AppReviewer => {
      const storeId = storeIdFromAvatar(review);
      const storeCode = storeCodeFromAvatar(review);
      return {
        reviewId: String(review.id),
        storeName: review.name,
        ...(storeId === undefined ? {} : { storeId }),
        ...(storeCode === undefined ? {} : { storeCode }),
        ...(typeof review.date === "string" ? { date: review.date } : {}),
      };
    });
    const next = payload.value.cursor?.next;

    return ok({ reviewers, ...(typeof next === "number" ? { nextPage: next } : {}) });
  }

  /**
   * Reads Salla's theme store. A store reports its theme by the identifier in that theme's
   * preview link, so a listing without one cannot be tied to anything and is left out.
   */
  async fetchThemes(): Promise<Result<CatalogTheme[], ApiFailure>> {
    const payload = await this.#json(THEME_CATALOG, themeCatalogSchema, {
      headers: { accept: "application/json" },
    });
    if (!payload.ok) {
      return payload;
    }

    const themes: CatalogTheme[] = [];
    for (const listing of payload.value) {
      const id = previewThemeId(listing.demo_stores);
      if (id === undefined) {
        continue;
      }
      const rating = listing.ratings?.rating;
      const ratingsCount = listing.ratings?.count;
      themes.push({
        id,
        name: listing.name,
        listingId: String(listing.id),
        ...(typeof listing.developer === "string" ? { developer: listing.developer } : {}),
        ...(typeof listing.version === "string" ? { version: listing.version } : {}),
        ...(typeof rating === "number" ? { rating } : {}),
        ...(typeof ratingsCount === "number" ? { ratingsCount } : {}),
        ...(listing.is_beta === true ? { isBeta: true } : {}),
      });
    }
    return ok(themes);
  }

  /** Reads the public app catalogue, refreshing the short-lived search token as needed. */
  async fetchCatalog(): Promise<Result<CatalogApp[], ApiFailure>> {
    const token = await this.#catalogToken();
    if (!token.ok) {
      return token;
    }

    const apps: CatalogApp[] = [];
    let page = 0;
    let pages = 1;

    while (page < pages) {
      const endpoint = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;
      const payload = await this.#json(endpoint, catalogPageSchema, {
        method: "POST",
        headers: {
          "x-algolia-application-id": ALGOLIA_APP_ID,
          "x-algolia-api-key": token.value,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          params: `query=&hitsPerPage=${String(CATALOG_PAGE_SIZE)}&page=${String(page)}&attributesToHighlight=[]`,
        }),
      });
      if (!payload.ok) {
        return payload;
      }
      apps.push(...payload.value.hits.map(toCatalogApp));
      pages = payload.value.nbPages;
      page += 1;
    }

    return ok(apps);
  }

  async #catalogToken(): Promise<Result<string, ApiFailure>> {
    const cached = this.#searchToken;
    if (cached && cached.expiresAt.getTime() > this.#now().getTime()) {
      return ok(cached.value);
    }

    const endpoint = `${MARKETPLACE_API}/users/search-token`;
    const payload = await this.#json(endpoint, searchTokenSchema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ index: ALGOLIA_INDEX }),
    });
    if (!payload.ok) {
      return payload;
    }

    const expiresAt = new Date(payload.value.data.expires_at ?? "");
    this.#searchToken = {
      value: payload.value.data.token,
      // Expire early so a long job never dies on a token that lapses mid-run.
      expiresAt: Number.isNaN(expiresAt.getTime())
        ? new Date(this.#now().getTime() + 60 * 60 * 1000)
        : new Date(expiresAt.getTime() - 60 * 60 * 1000),
    };

    return ok(payload.value.data.token);
  }

  async #json<Schema extends z.ZodType>(
    endpoint: string,
    schema: Schema,
    options: SafeFetchOptions,
  ): Promise<Result<z.output<Schema>, ApiFailure>> {
    const response = await this.#fetchPage(endpoint, {
      ...this.#common(),
      ...options,
      headers: {
        "user-agent": this.#userAgent,
        accept: "application/json",
        ...options.headers,
      },
    });
    if (!response.ok) {
      return response;
    }
    if (response.value.status >= 400) {
      return err({ code: "http", status: response.value.status, endpoint });
    }

    let body: unknown;
    try {
      body = JSON.parse(response.value.body);
    } catch {
      return err({ code: "invalid-json", endpoint });
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return err({
        code: "schema-drift",
        endpoint,
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.map(String).join(".")}: ${issue.message}`,
        ),
      });
    }

    return ok(parsed.data);
  }

  #common(): SafeFetchOptions {
    return {
      ...(this.#timeoutMs === undefined ? {} : { timeoutMs: this.#timeoutMs }),
      ...(this.#attempts === undefined ? {} : { attempts: this.#attempts }),
      ...(this.#limiter === undefined ? {} : { limiter: this.#limiter }),
    };
  }

  #storeHeaders(storeId: number): Record<string, string> {
    if (!Number.isSafeInteger(storeId) || storeId <= 0) {
      throw new TypeError(`store id must be a positive integer, received ${String(storeId)}`);
    }
    return { "store-identifier": String(storeId) };
  }
}

function toAppDetails(payload: AppDetailsPayload): AppDetails {
  const urls = [payload.url, payload.support?.url, payload.policy, payload.faq].filter(
    (value): value is string => typeof value === "string" && value.startsWith("http"),
  );
  const companyId = payload.company?.id;
  const companyName = payload.company?.name;

  return {
    id: String(payload.id),
    name: payload.name,
    ...(companyId === undefined || companyId === null ? {} : { companyId: String(companyId) }),
    ...(typeof companyName === "string" ? { companyName } : {}),
    categories: (payload.categories ?? []).map((category) => category.name),
    domains: [...new Set(urls.map(hostOfUrl).filter((host): host is string => host !== undefined))],
  };
}

function toCatalogApp(hit: CatalogHit): CatalogApp {
  const company = hit.company?.name.ar ?? hit.company?.name.en;
  return {
    id: hit.id,
    name: hit.name.ar,
    ...(typeof hit.name.en === "string" ? { nameEn: hit.name.en } : {}),
    ...(typeof company === "string" ? { company } : {}),
    categories: (hit.categories ?? []).map((category) => category.name.ar),
    isSalla: hit.is_salla ?? false,
    ...(typeof hit.installs_count === "number" ? { installs: hit.installs_count } : {}),
  };
}

function storeIdFromAvatar(review: AppReviewPayload): string | undefined {
  const id =
    typeof review.avatar === "string" ? AVATAR_STORE_ID.exec(review.avatar)?.[1] : undefined;
  // Some avatars point at a placeholder folder numbered zero, which names no store.
  return id === undefined || Number(id) === 0 ? undefined : id;
}

const PREVIEW_THEME_ID = /\/themes\/(\d+)\/preview/;

function previewThemeId(
  demoStores: readonly Readonly<Record<string, unknown>>[] | undefined,
): string | undefined {
  for (const store of demoStores ?? []) {
    const match =
      typeof store.preview_url === "string" ? PREVIEW_THEME_ID.exec(store.preview_url) : null;
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return undefined;
}

function storeCodeFromAvatar(review: AppReviewPayload): string | undefined {
  return typeof review.avatar === "string"
    ? (AVATAR_STORE_CODE.exec(review.avatar)?.[1] ?? undefined)
    : undefined;
}

function firstOrigin(entries: readonly MenuEntry[]): string | undefined {
  for (const entry of entries) {
    const origin = typeof entry.url === "string" ? originOf(entry.url) : undefined;
    if (origin !== undefined) {
      return origin;
    }
    const child = firstOrigin(entry.children ?? []);
    if (child !== undefined) {
      return child;
    }
  }
  return undefined;
}

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    // Stores without their own domain live under a path on salla.sa.
    if (parsed.hostname === "salla.sa" || parsed.hostname === "www.salla.sa") {
      const slug = parsed.pathname.split("/").find((segment) => segment !== "");
      return slug === undefined ? undefined : `https://salla.sa/${slug}`;
    }
    return `${parsed.origin}/`;
  } catch {
    return undefined;
  }
}

function hostOfUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
