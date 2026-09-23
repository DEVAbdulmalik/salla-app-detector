import {
  analyzeStore,
  compileKnowledge,
  type Evidence,
  type KnowledgeSnapshot,
} from "@salla-app-detector/engine";
import type { KnowledgeRepository } from "@salla-app-detector/knowledge";
import type {
  AppReviews,
  FetchFailure,
  FetchedPage,
  ProductSummary,
} from "@salla-app-detector/salla";
import type { Logger, Result } from "@salla-app-detector/shared";

export interface ValidationClient {
  fetchAppReviews(appId: string, page?: number): Promise<Result<AppReviews, unknown>>;
  resolveStoreUrl(storeId: number): Promise<Result<string, unknown>>;
  fetchStorefront(url: string): Promise<Result<FetchedPage, FetchFailure>>;
  fetchProducts(storeId: number, perPage?: number): Promise<Result<ProductSummary[], unknown>>;
}

export interface ValidateOptions {
  readonly repository: KnowledgeRepository;
  readonly client: ValidationClient;
  readonly appId: string;
  readonly signalKind: string;
  readonly signalValue: string;
  /** Reviewer pages to read; each page names ten stores, a quarter of which are resolvable. */
  readonly reviewPages?: number;
  readonly maxStores?: number;
  readonly logger?: Logger;
}

export interface ValidationResult {
  readonly appId: string;
  readonly signalValue: string;
  readonly storesChecked: number;
  /** Reviewers whose store could not be reached, which is why a verdict may be withheld. */
  readonly storesUnresolved: number;
  readonly storesWithSignal: number;
  readonly groupShare: number;
  readonly baselineShare: number;
  readonly verdict: "supported" | "inconclusive" | "contradicted";
}

interface ReviewerStore {
  readonly storeId?: number;
  readonly url?: string;
}

const DEFAULTS = { reviewPages: 3, maxStores: 12 } as const;
/** A fingerprint has to hold in the app's own stores and be rare everywhere else. */
const THRESHOLDS = { group: 0.5, baseline: 0.05 } as const;

/**
 * Checks a proposed fingerprint against stores known to run the app. Merchants who review
 * an app almost always have it installed, which gives a ground truth that no amount of
 * looking at one page can provide.
 */
export async function validateCandidate(options: ValidateOptions): Promise<ValidationResult> {
  const snapshot = await options.repository.readPublishedSnapshot();
  const stores = await reviewerStores(options);
  const shortlist = stores.slice(0, options.maxStores ?? DEFAULTS.maxStores);
  const checked: { storeId: number | undefined; hasSignal: boolean }[] = [];

  for (const store of shortlist) {
    const hasSignal = await storeCarriesSignal(options, store, snapshot);
    if (hasSignal !== undefined) {
      checked.push({ storeId: store.storeId, hasSignal });
    }
  }

  const storesWithSignal = checked.filter((entry) => entry.hasSignal).length;
  const groupShare = checked.length === 0 ? 0 : storesWithSignal / checked.length;
  const baselineShare = await options.repository.signalShareAcrossScans(
    options.signalKind,
    options.signalValue,
    30,
  );

  // A store reached through its host has no numeric id, so it cannot be filed as ground truth.
  await options.repository.recordGroundTruth(
    checked.flatMap((entry) =>
      entry.hasSignal && entry.storeId !== undefined
        ? [{ appId: options.appId, storeId: entry.storeId }]
        : [],
    ),
  );

  const verdict = decide(checked.length, groupShare, baselineShare);
  options.logger?.info("candidate validated", {
    appId: options.appId,
    signal: options.signalValue,
    groupShare,
    baselineShare,
    verdict,
  });

  return {
    appId: options.appId,
    signalValue: options.signalValue,
    storesChecked: checked.length,
    storesUnresolved: shortlist.length - checked.length,
    storesWithSignal,
    groupShare,
    baselineShare,
    verdict,
  };
}

function decide(
  checked: number,
  groupShare: number,
  baselineShare: number,
): ValidationResult["verdict"] {
  if (checked < 3) {
    return "inconclusive";
  }
  if (groupShare >= THRESHOLDS.group && baselineShare <= THRESHOLDS.baseline) {
    return "supported";
  }
  return groupShare < THRESHOLDS.group ? "contradicted" : "inconclusive";
}

/**
 * Reviewers are the only public list of merchants known to run an app. An avatar either
 * carries the store id outright or a CDN code, which earlier scans have already tied to a
 * storefront, so both forms lead back to a page we can look at.
 */
async function reviewerStores(options: ValidateOptions): Promise<ReviewerStore[]> {
  const found: ReviewerStore[] = [];
  const codes: string[] = [];

  for (let page = 1; page <= (options.reviewPages ?? DEFAULTS.reviewPages); page += 1) {
    const reviews = await options.client.fetchAppReviews(options.appId, page);
    if (!reviews.ok) {
      break;
    }
    for (const reviewer of reviews.value.reviewers) {
      const id = reviewer.storeId === undefined ? Number.NaN : Number(reviewer.storeId);
      if (Number.isSafeInteger(id)) {
        if (!found.some((store) => store.storeId === id)) {
          found.push({ storeId: id });
        }
      } else if (reviewer.storeCode !== undefined && !codes.includes(reviewer.storeCode)) {
        codes.push(reviewer.storeCode);
      }
    }
    if (reviews.value.nextPage === undefined) {
      break;
    }
  }

  const hosts = await options.repository.storeHostsByCode(codes);
  for (const host of new Set(hosts.values())) {
    found.push({ url: `https://${host}/` });
  }
  return found;
}

/** Undefined means the store could not be checked, which is different from "not found". */
async function storeCarriesSignal(
  options: ValidateOptions,
  store: ReviewerStore,
  snapshot: KnowledgeSnapshot | undefined,
): Promise<boolean | undefined> {
  const url = await storeUrl(options, store);
  if (url === undefined) {
    return undefined;
  }
  const page = await options.client.fetchStorefront(url);
  if (!page.ok) {
    return undefined;
  }

  const host = new URL(page.value.finalUrl).hostname;
  const report = analyzeStore(
    {
      target: { url: page.value.finalUrl, host },
      page: {
        status: page.value.status,
        finalUrl: page.value.finalUrl,
        html: page.value.body,
        headers: page.value.headers,
      },
    },
    compileKnowledge(snapshot ?? emptyKnowledge()),
  );

  if (report.status !== "live") {
    return undefined;
  }

  return [...report.unknownSignals, ...evidenceOf(report.apps)].some(
    (signal) => signal.kind === options.signalKind && signal.value === options.signalValue,
  );
}

async function storeUrl(
  options: ValidateOptions,
  store: ReviewerStore,
): Promise<string | undefined> {
  if (store.url !== undefined) {
    return store.url;
  }
  if (store.storeId === undefined) {
    return undefined;
  }
  const resolved = await options.client.resolveStoreUrl(store.storeId);
  return resolved.ok ? resolved.value : undefined;
}

function evidenceOf(apps: ReturnType<typeof analyzeStore>["apps"]): Evidence[] {
  return apps.flatMap((app) =>
    app.evidence.map((item) => ({ kind: item.kind, value: item.value })),
  );
}

function emptyKnowledge(): KnowledgeSnapshot {
  return {
    version: "empty",
    apps: {},
    fingerprints: [],
    noise: {
      hosts: [],
      domains: [],
      identifiers: [],
      inlineSignatures: [],
      markers: [],
      elementIds: [],
      customElements: [],
    },
  };
}
