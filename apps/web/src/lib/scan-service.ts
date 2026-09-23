import { createHash } from "node:crypto";
import {
  compileKnowledge,
  normalizeTarget,
  type CompiledKnowledge,
  type ScanReport,
} from "@salla-app-detector/engine";
import { scanStore } from "@salla-app-detector/jobs";
import { seedKnowledge, type KnowledgeRepository } from "@salla-app-detector/knowledge";
import { SallaClient } from "@salla-app-detector/salla";
import { createLogger } from "@salla-app-detector/shared";
import { getRepository } from "./database";

const logger = createLogger({ level: "info", bindings: { component: "scan" } });

export type ScanError =
  "empty" | "invalid" | "platform" | "rate-limited" | "unreachable" | "unknown";

export interface ScanSuccess {
  readonly report: ScanReport;
  readonly host: string;
  readonly scannedAt: Date;
  readonly fromCache: boolean;
}

export type ScanOutcome =
  ({ readonly ok: true } & ScanSuccess) | { readonly ok: false; readonly error: ScanError };

const CACHE_MINUTES = 360;
/** A visitor waits for a page, not for a stubborn store. */
const SCAN_DEADLINE_MS = 25_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RATE_LIMIT = { requests: 10, windowSeconds: 60 } as const;
const PRODUCT_SAMPLE = 30;

/** In-flight scans per host, so a burst on one store results in a single fetch. */
const running = new Map<string, Promise<ScanOutcome>>();

let knowledgeCache: { value: CompiledKnowledge; loadedAt: number } | undefined;
const KNOWLEDGE_TTL_MS = 10 * 60 * 1000;

/**
 * When the database is unreachable, every call would otherwise wait for its own connection
 * timeout and a scan would crawl. After a failure the database is left alone for a while
 * and scanning continues on the bundled knowledge.
 */
const DATABASE_PAUSE_MS = 60_000;
const DATABASE_CALL_TIMEOUT_MS = 8_000;
let databasePausedUntil = 0;

export async function scan(input: string, clientIp: string | undefined): Promise<ScanOutcome> {
  const target = normalizeTarget(input);
  if (!target.ok) {
    return { ok: false, error: toInputError(target.error.code) };
  }

  const repository = getRepository();
  if (repository && clientIp !== undefined) {
    const bucket = `scan:${createHash("sha256").update(clientIp).digest("hex").slice(0, 32)}`;
    const limit = await tolerate("rate-limit", () =>
      repository.consumeRateLimit(bucket, RATE_LIMIT.requests, RATE_LIMIT.windowSeconds),
    );
    // An unreachable database must not become an outage: the limit simply cannot be
    // enforced for this request, which is preferable to refusing every visitor.
    if (limit?.allowed === false) {
      return { ok: false, error: "rate-limited" };
    }
  }

  const cached = await readCache(repository, target.value.host);
  if (cached) {
    return cached;
  }

  const pending = running.get(target.value.url);
  if (pending) {
    return pending;
  }

  const work = runScan(target.value.url, repository).finally(() => {
    running.delete(target.value.url);
  });
  running.set(target.value.url, work);
  return work;
}

/** Reads a stored report for a shared link without scanning again. */
export async function storedReport(host: string): Promise<ScanSuccess | undefined> {
  const repository = getRepository();
  const cached = await readCache(repository, host);
  return cached?.ok === true ? cached : undefined;
}

async function readCache(
  repository: KnowledgeRepository | undefined,
  host: string,
): Promise<(ScanOutcome & { ok: true }) | undefined> {
  if (!repository) {
    return undefined;
  }
  const recent = await tolerate("cache-read", () => repository.recentScan(host, CACHE_MINUTES));
  if (!recent) {
    return undefined;
  }
  return {
    ok: true,
    report: recent.report as ScanReport,
    host,
    scannedAt: recent.scannedAt,
    fromCache: true,
  };
}

async function runScan(
  url: string,
  repository: KnowledgeRepository | undefined,
): Promise<ScanOutcome> {
  const knowledge = await loadKnowledge(repository);
  const startedAt = Date.now();

  const result = await withDeadline(
    scanStore(url, {
      client: new SallaClient({ timeoutMs: REQUEST_TIMEOUT_MS, attempts: 1 }),
      knowledge,
      productSampleSize: PRODUCT_SAMPLE,
    }),
  );

  if (result === undefined) {
    logger.warn("scan exceeded its deadline", { url });
    return { ok: false, error: "unreachable" };
  }
  if (!result.ok) {
    return { ok: false, error: result.error.code === "invalid-input" ? "invalid" : "unreachable" };
  }

  const { report } = result.value;
  const scannedAt = new Date();

  if (repository) {
    await tolerate("persist", () => persist(repository, report, Date.now() - startedAt));
  }

  return { ok: true, report, host: report.target.host, scannedAt, fromCache: false };
}

/** Scans feed the learning loop: what was not explained is worth collecting. */
async function persist(
  repository: KnowledgeRepository,
  report: ScanReport,
  durationMs: number,
): Promise<void> {
  await repository.recordScan({
    storeHost: report.target.host,
    ...(report.store === undefined ? {} : { storeId: report.store.id }),
    status: report.status,
    report,
    engineVersion: report.meta.engineVersion,
    knowledgeVersion: report.meta.knowledgeVersion,
    durationMs,
  });

  if (report.status !== "live") {
    return;
  }

  await repository.recordFingerprintMatches(
    report.apps.flatMap((app) =>
      app.evidence.map((item) => ({ kind: item.kind, value: item.value })),
    ),
  );

  if (report.store?.assetCode !== undefined) {
    await repository.rememberStoreCode(report.store.assetCode, report.store.id, report.target.host);
  }

  await repository.recordObservations(
    report.target.host,
    report.unknownSignals.map((signal) => ({
      kind: signal.kind,
      value: signal.value,
      ...(signal.detail === undefined ? {} : { sample: signal.detail }),
    })),
  );
}

async function loadKnowledge(
  repository: KnowledgeRepository | undefined,
): Promise<CompiledKnowledge> {
  if (knowledgeCache && Date.now() - knowledgeCache.loadedAt < KNOWLEDGE_TTL_MS) {
    return knowledgeCache.value;
  }
  const stored = repository
    ? await tolerate("knowledge-load", () => repository.readPublishedSnapshot())
    : undefined;
  // Falling back to the bundled knowledge keeps detection working, with fewer fingerprints.
  const compiled = compileKnowledge(stored ?? seedKnowledge);
  knowledgeCache = { value: compiled, loadedAt: Date.now() };
  return compiled;
}

function withDeadline<T>(work: Promise<T>): Promise<T | undefined> {
  return Promise.race([
    work,
    new Promise<undefined>((resolve) =>
      setTimeout(() => {
        resolve(undefined);
      }, SCAN_DEADLINE_MS),
    ),
  ]);
}

/** Runs a database call that the scan can live without, reporting failures rather than raising them. */
async function tolerate<T>(operation: string, work: () => Promise<T>): Promise<T | undefined> {
  if (Date.now() < databasePausedUntil) {
    return undefined;
  }
  try {
    return await Promise.race([work(), rejectAfter(DATABASE_CALL_TIMEOUT_MS, operation)]);
  } catch (error) {
    databasePausedUntil = Date.now() + DATABASE_PAUSE_MS;
    logger.error("database unavailable", {
      operation,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return undefined;
  }
}

function rejectAfter(ms: number, operation: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error(`${operation} exceeded ${String(ms)}ms`));
    }, ms);
  });
}

function toInputError(code: string): ScanError {
  switch (code) {
    case "empty":
      return "empty";
    case "platform-page":
      return "platform";
    default:
      return "invalid";
  }
}
