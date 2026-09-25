import type { CompiledKnowledge } from "@salla-app-detector/engine";
import type { KnowledgeRepository, ListedApp } from "@salla-app-detector/knowledge";
import type { ApiFailure, AppReviewer, AppReviews } from "@salla-app-detector/salla";
import { ok, type Logger, type Result } from "@salla-app-detector/shared";
import { recordScanOutcome } from "./record";
import { scanStore, type ScanClient, type ScanFailure, type ScanOutcome } from "./scan-store";

export interface HarvestClient extends ScanClient {
  fetchAppReviews(appId: string, page?: number): Promise<Result<AppReviews, ApiFailure>>;
  resolveStoreUrl(storeId: number): Promise<Result<string, ApiFailure>>;
}

export interface HarvestOptions {
  readonly repository: KnowledgeRepository;
  readonly client: HarvestClient;
  readonly knowledge: CompiledKnowledge;
  /** Apps to work through, in order. Those harvested recently are passed over. */
  readonly apps: readonly ListedApp[];
  /** Ten reviews to a page, newest first; recent reviewers are likelier to still run the app. */
  readonly reviewPages?: number;
  /** Stores to have scanned for each app, counting ones already scanned recently. */
  readonly storesPerApp?: number;
  readonly workers?: number;
  readonly rescanAfterDays?: number;
  readonly revisitAfterDays?: number;
  readonly budgetMs?: number;
  readonly now?: () => Date;
  readonly logger?: Logger;
  readonly onApp?: (harvest: AppHarvest) => void;
  readonly scan?: (
    url: string,
    knowledge: CompiledKnowledge,
    client: ScanClient,
  ) => Promise<Result<ScanOutcome, ScanFailure>>;
}

export interface AppHarvest {
  readonly appId: string;
  readonly name: string;
  readonly reviewers: number;
  /** Reviewer stores we could put an id to, each now recorded as a known installation. */
  readonly knownStores: number;
  /** Known stores scanned recently enough that they were not fetched again. */
  readonly alreadyScanned: number;
  /** Stores scanned now, by the status the scan ended with. */
  readonly scanned: Readonly<Record<string, number>>;
  /** Set when the reviews could not be read, so the app is tried again next time. */
  readonly reviewsFailed?: string;
}

export interface HarvestResult {
  readonly apps: readonly AppHarvest[];
  readonly groundTruth: number;
  readonly scanned: Readonly<Record<string, number>>;
  /** Why the run ended before the list did. */
  readonly stopped?: "budget" | "refused";
  /** Apps still waiting after this run. */
  readonly remaining: number;
}

const JOB = "harvest";
const DEFAULTS = {
  reviewPages: 3,
  storesPerApp: 10,
  workers: 3,
  rescanAfterDays: 14,
  revisitAfterDays: 30,
  budgetMs: 15 * 60 * 1000,
} as const;
/** This many refusals in a row means we are being kept out, and pressing on only makes it worse. */
const REFUSAL_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Categories whose apps work between Salla and the vendor's servers. Shipping apps were
 * checked against their reviewers' stores and left nothing on any page, and the others do
 * the same kind of work out of sight.
 */
const BACKEND_CATEGORIES = new Set([
  "الشحن و التوصيل",
  "المحاسبة والمالية",
  "انظمة ERP",
  "ادارة المخزون",
]);

/**
 * Apps worth harvesting: ones that could leave a trace. An app filed under a backend
 * category and a storefront one keeps its place, and apps Salla installs everywhere are
 * skipped because their reviewers are simply a sample of all merchants.
 */
export function harvestableApps(apps: readonly ListedApp[]): ListedApp[] {
  return apps.filter(
    (app) =>
      !app.isDefault &&
      (app.categories.length === 0 ||
        app.categories.some((category) => !BACKEND_CATEGORIES.has(category))),
  );
}

/**
 * Builds the corpus from the one public list of merchants known to run each app: the
 * people who reviewed it. Every reviewer store becomes ground truth for that app, and the
 * ones not seen lately are scanned, so the traces they share can later be told apart
 * from the ones every store has.
 */
export async function harvestReviewerStores(options: HarvestOptions): Promise<HarvestResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().getTime();
  const budgetMs = options.budgetMs ?? DEFAULTS.budgetMs;
  const revisitMs = (options.revisitAfterDays ?? DEFAULTS.revisitAfterDays) * DAY_MS;

  const state = await options.repository.jobState(JOB);
  const harvested = harvestedApps(state?.cursor);
  const pending = options.apps.filter((app) => {
    const at = harvested[app.id];
    return at === undefined || startedAt - Date.parse(at) >= revisitMs;
  });

  const run: RunState = {
    attempted: new Set(),
    refusals: 0,
    overBudget: () => now().getTime() - startedAt >= budgetMs,
  };
  const apps: AppHarvest[] = [];
  let groundTruth = 0;
  let stopped: HarvestResult["stopped"];
  let done = 0;

  for (const app of pending) {
    if (run.overBudget()) {
      stopped = "budget";
      break;
    }
    if (run.refusals >= REFUSAL_LIMIT) {
      stopped = "refused";
      break;
    }

    const outcome = await harvestApp(options, app, run);
    apps.push(outcome.harvest);
    options.onApp?.(outcome.harvest);
    groundTruth += outcome.harvest.knownStores;

    if (!outcome.finished) {
      stopped = run.refusals >= REFUSAL_LIMIT ? "refused" : "budget";
      break;
    }
    if (outcome.harvest.reviewsFailed === undefined) {
      harvested[app.id] = now().toISOString().slice(0, 10);
      done += 1;
      await options.repository.saveJobState(JOB, { harvested }, "running", now());
    }
  }

  const status = stopped === undefined ? "completed" : `stopped:${stopped}`;
  await options.repository.saveJobState(JOB, { harvested }, status, now());
  options.logger?.info("reviewer stores harvested", { apps: apps.length, groundTruth, status });

  return {
    apps,
    groundTruth,
    scanned: sumTallies(apps.map((app) => app.scanned)),
    ...(stopped === undefined ? {} : { stopped }),
    remaining: pending.length - done,
  };
}

interface RunState {
  /** Stores tried during this run, so an app sharing reviewers with another costs nothing. */
  readonly attempted: Set<number>;
  refusals: number;
  readonly overBudget: () => boolean;
}

async function harvestApp(
  options: HarvestOptions,
  app: ListedApp,
  run: RunState,
): Promise<{ harvest: AppHarvest; finished: boolean }> {
  const reviews = await readReviewers(options.client, app.id, options.reviewPages);
  if (!reviews.ok) {
    run.refusals = isRefusal(reviews.error) ? run.refusals + 1 : run.refusals;
    return {
      harvest: {
        appId: app.id,
        name: app.name,
        reviewers: 0,
        knownStores: 0,
        alreadyScanned: 0,
        scanned: {},
        reviewsFailed: reviews.error.code,
      },
      finished: true,
    };
  }

  const stores = await reviewerStores(options.repository, reviews.value);
  await options.repository.recordGroundTruth(
    [...stores].map(([storeId, date]) => ({
      appId: app.id,
      storeId,
      ...(date === undefined ? {} : { observedOn: date }),
    })),
  );

  const ids = [...stores.keys()];
  const recent = await options.repository.recentlyScannedStoreIds(
    ids,
    options.rescanAfterDays ?? DEFAULTS.rescanAfterDays,
  );
  const covered = ids.filter((id) => recent.has(id) || run.attempted.has(id)).length;
  const queue = ids
    .filter((id) => !recent.has(id) && !run.attempted.has(id))
    .slice(0, Math.max(0, (options.storesPerApp ?? DEFAULTS.storesPerApp) - covered));

  const scanned: Record<string, number> = {};
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (run.overBudget() || run.refusals >= REFUSAL_LIMIT) {
        queue.unshift(id);
        return;
      }
      run.attempted.add(id);
      const status = await harvestStore(options, id);
      scanned[status] = (scanned[status] ?? 0) + 1;
      run.refusals = status === "blocked" || status === "refused" ? run.refusals + 1 : 0;
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, options.workers ?? DEFAULTS.workers) }, () => worker()),
  );

  return {
    harvest: {
      appId: app.id,
      name: app.name,
      reviewers: reviews.value.length,
      knownStores: stores.size,
      alreadyScanned: recent.size,
      scanned,
    },
    finished: queue.length === 0,
  };
}

/** Returns the status the scan ended with, or why there was no scan to record. */
async function harvestStore(options: HarvestOptions, storeId: number): Promise<string> {
  const url = await options.client.resolveStoreUrl(storeId);
  if (!url.ok) {
    return isRefusal(url.error) ? "refused" : "unresolved";
  }

  const startedAt = Date.now();
  const scan = options.scan ?? defaultScan;
  const result = await scan(url.value, options.knowledge, options.client);
  if (!result.ok) {
    const failure = result.error;
    return failure.code === "fetch-failed" && isRefusal(failure.reason) ? "refused" : "unreachable";
  }

  await recordScanOutcome(options.repository, result.value.report, Date.now() - startedAt, storeId);
  return result.value.report.status;
}

async function readReviewers(
  client: HarvestClient,
  appId: string,
  pages: number = DEFAULTS.reviewPages,
): Promise<Result<AppReviewer[], ApiFailure>> {
  const reviewers: AppReviewer[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const reviews = await client.fetchAppReviews(appId, page);
    if (!reviews.ok) {
      // A later page failing still leaves the reviewers already read worth keeping.
      return page === 1 ? reviews : ok(reviewers);
    }
    reviewers.push(...reviews.value.reviewers);
    if (reviews.value.nextPage === undefined) {
      break;
    }
  }
  return ok(reviewers);
}

/**
 * Store ids for each reviewer, newest review first. An avatar names the store outright or
 * carries a CDN code, and codes are only as useful as the stores already scanned, so the
 * reach of each harvest grows with the corpus.
 */
async function reviewerStores(
  repository: KnowledgeRepository,
  reviewers: readonly AppReviewer[],
): Promise<Map<number, string | undefined>> {
  const codes = reviewers.flatMap((reviewer) =>
    reviewer.storeId === undefined && reviewer.storeCode !== undefined ? [reviewer.storeCode] : [],
  );
  const byCode = await repository.storeIdsByCode(codes);

  const stores = new Map<number, string | undefined>();
  for (const reviewer of reviewers) {
    const id =
      reviewer.storeId === undefined
        ? byCode.get(reviewer.storeCode ?? "")
        : Number(reviewer.storeId);
    if (id !== undefined && Number.isSafeInteger(id) && !stores.has(id)) {
      stores.set(id, reviewer.date);
    }
  }
  return stores;
}

function isRefusal(failure: ApiFailure): boolean {
  return (
    failure.code === "busy" ||
    failure.code === "cooling-down" ||
    (failure.code === "http" && (failure.status === 403 || failure.status === 429))
  );
}

function harvestedApps(cursor: Record<string, unknown> | undefined): Record<string, string> {
  const value = cursor?.harvested;
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function sumTallies(tallies: readonly Readonly<Record<string, number>>[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const tally of tallies) {
    for (const [status, count] of Object.entries(tally)) {
      total[status] = (total[status] ?? 0) + count;
    }
  }
  return total;
}

function defaultScan(
  url: string,
  knowledge: CompiledKnowledge,
  client: ScanClient,
): Promise<Result<ScanOutcome, ScanFailure>> {
  return scanStore(url, { client, knowledge });
}
