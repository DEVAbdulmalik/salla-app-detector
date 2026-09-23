import {
  describeHost,
  type EvidenceKind,
  type FingerprintStrength,
} from "@salla-app-detector/engine";
import {
  GENERIC_DEVELOPER_DOMAINS,
  type AppDomains,
  type FingerprintUpsert,
  type KnowledgeRepository,
} from "@salla-app-detector/knowledge";
import type { ApiFailure, AppDetails, CatalogApp } from "@salla-app-detector/salla";
import { err, ok, type Logger, type Result } from "@salla-app-detector/shared";

export interface CatalogClient {
  fetchCatalog(): Promise<Result<CatalogApp[], ApiFailure>>;
  fetchAppDetails(appId: string): Promise<Result<AppDetails, ApiFailure>>;
}

export interface CatalogSyncOptions {
  readonly client: CatalogClient;
  readonly repository: KnowledgeRepository;
  /** Work stops once this much time has been spent, so a scheduled run always returns. */
  readonly budgetMs?: number;
  readonly detailsPerRun?: number;
  readonly detailsMaxAgeDays?: number;
  readonly now?: () => Date;
  readonly logger?: Logger;
}

export interface CatalogSyncResult {
  readonly catalogApps: number;
  readonly newlyDelisted: readonly string[];
  readonly detailsFetched: number;
  readonly detailsFailed: number;
  readonly fingerprintsWritten: number;
  readonly fingerprintsRemoved: number;
  /** False when the budget ran out with app details still to refresh. */
  readonly completed: boolean;
}

const JOB = "catalog-sync";
const DEFAULTS = {
  budgetMs: 240_000,
  detailsPerRun: 200,
  detailsMaxAgeDays: 7,
} as const;

const DOMAIN_FINGERPRINT_STRENGTH: FingerprintStrength = "strong";
const DOMAIN_KIND: EvidenceKind = "domain";

/**
 * Brings the local catalogue in line with Salla's, then rebuilds the fingerprints that can
 * be derived from it. Details are refreshed a batch at a time within a time budget and the
 * position is saved, so a run that is cut short simply continues on the next one.
 */
export async function syncCatalog(
  options: CatalogSyncOptions,
): Promise<Result<CatalogSyncResult, ApiFailure>> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const budgetMs = options.budgetMs ?? DEFAULTS.budgetMs;
  const outOfTime = (): boolean => now().getTime() - startedAt.getTime() > budgetMs;

  const catalog = await options.client.fetchCatalog();
  if (!catalog.ok) {
    await options.repository.saveJobState(
      JOB,
      {},
      `catalog-failed:${catalog.error.code}`,
      startedAt,
    );
    return err(catalog.error);
  }

  await options.repository.upsertApps(
    catalog.value.map((app) => ({
      id: app.id,
      name: app.name,
      ...(app.nameEn === undefined ? {} : { nameEn: app.nameEn }),
      ...(app.company === undefined ? {} : { company: app.company }),
      categories: app.categories,
      ...(app.installs === undefined ? {} : { installs: app.installs }),
    })),
  );
  const newlyDelisted = await options.repository.markAppsMissingFromCatalog(
    catalog.value.map((app) => app.id),
  );

  const staleBefore = new Date(
    now().getTime() -
      (options.detailsMaxAgeDays ?? DEFAULTS.detailsMaxAgeDays) * 24 * 60 * 60 * 1000,
  );
  const pending = await options.repository.appsNeedingDetails(
    options.detailsPerRun ?? DEFAULTS.detailsPerRun,
    staleBefore,
  );

  let detailsFetched = 0;
  let detailsFailed = 0;

  for (const app of pending) {
    if (outOfTime()) {
      break;
    }
    const details = await options.client.fetchAppDetails(app.id);
    if (!details.ok) {
      detailsFailed += 1;
      options.logger?.warn("app details unavailable", {
        appId: app.id,
        reason: details.error.code,
      });
      // A removed app answers 404 here; the catalogue pass above already handles its status.
      await options.repository.saveAppDetails(app.id, [], now());
      continue;
    }
    await options.repository.saveAppDetails(
      app.id,
      details.value.domains,
      now(),
      details.value.companyName,
    );
    detailsFetched += 1;
  }

  // Pruning is only safe once every app's details have been refreshed: mid-backfill the
  // picture is incomplete, and removing what is missing from it would discard knowledge.
  const stillPending = await options.repository.appsPendingDetails(staleBefore);
  const generated = await rebuildDomainFingerprints(options.repository, stillPending === 0);
  await options.repository.publishSnapshot();
  const completed = stillPending === 0;

  await options.repository.saveJobState(
    JOB,
    {
      lastCatalogSize: catalog.value.length,
      pendingDetails: pending.length - detailsFetched - detailsFailed,
    },
    completed ? "completed" : "partial",
    startedAt,
  );

  return ok({
    catalogApps: catalog.value.length,
    newlyDelisted,
    detailsFetched,
    detailsFailed,
    ...generated,
    completed,
  });
}

/**
 * Turns developer domains into fingerprints. A domain used by one app names that app; a
 * domain shared by a company's apps can only name the company, which the report shows as
 * an unresolved choice rather than a guess.
 */
async function rebuildDomainFingerprints(
  repository: KnowledgeRepository,
  prune: boolean,
): Promise<{ fingerprintsWritten: number; fingerprintsRemoved: number }> {
  const [appDomains, noiseDomains] = await Promise.all([
    repository.appDomains(),
    repository.noiseDomains(),
  ]);
  const excluded = new Set(noiseDomains);
  const owners = new Map<string, { appIds: Set<string>; companies: Set<string> }>();

  for (const app of appDomains) {
    for (const domain of usableDomains(app, excluded)) {
      const entry = owners.get(domain) ?? {
        appIds: new Set<string>(),
        companies: new Set<string>(),
      };
      entry.appIds.add(app.id);
      if (app.company !== null) {
        entry.companies.add(app.company);
      }
      owners.set(domain, entry);
    }
  }

  const fingerprints: FingerprintUpsert[] = [];
  for (const [domain, entry] of owners) {
    const appIds = [...entry.appIds].sort();
    const id = `dev-domain:${domain}`;
    const single = appIds.length === 1 ? appIds[0] : undefined;
    fingerprints.push({
      id,
      kind: DOMAIN_KIND,
      pattern: domain,
      strength: DOMAIN_FINGERPRINT_STRENGTH,
      source: "auto",
      ...(single === undefined
        ? { company: [...entry.companies][0] ?? domain, companyAppIds: appIds }
        : { appId: single }),
    });
  }

  await repository.upsertFingerprints(fingerprints);
  const removed = prune
    ? await repository.removeAutoFingerprints(fingerprints.map((item) => item.id))
    : 0;

  return { fingerprintsWritten: fingerprints.length, fingerprintsRemoved: removed };
}

function usableDomains(app: AppDomains, excluded: ReadonlySet<string>): string[] {
  const domains = new Set<string>();
  for (const host of app.domains) {
    const info = describeHost(host);
    // Shared hosting would tie unrelated vendors together through their platform's suffix.
    if (!info || info.isSharedHosting) {
      continue;
    }
    if (GENERIC_DEVELOPER_DOMAINS.has(info.domain) || excluded.has(info.domain)) {
      continue;
    }
    domains.add(info.domain);
  }
  return [...domains];
}
