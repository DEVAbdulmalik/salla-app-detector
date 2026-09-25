import type { CompiledKnowledge, ScanReport } from "@salla-app-detector/engine";
import type { CanaryStore, HealthEvent, KnowledgeRepository } from "@salla-app-detector/knowledge";
import type { Logger, Result } from "@salla-app-detector/shared";
import { scanStore, type ScanClient, type ScanFailure, type ScanOutcome } from "./scan-store";

export interface HealthOptions {
  readonly repository: KnowledgeRepository;
  readonly client: ScanClient;
  readonly knowledge: CompiledKnowledge;
  /** Canaries are scanned one by one; the cron budget decides how many fit. */
  readonly maxCanaries?: number;
  /** Scheduled jobs that should have run recently; a silent schedule is a silent detector. */
  /**
   * How long each scheduled job may go without finishing well. Daily jobs get a day and a
   * half; the theme catalogue changes slowly and is refused from some regions, so it is
   * only raised once its names are genuinely at risk of going stale.
   */
  readonly jobLimitsHours?: Readonly<Record<string, number>>;
  /** Salla's endpoints are undocumented, so each one we depend on is called and checked. */
  readonly contracts?: readonly ApiContract[];
  /** Share of scans ending in "blocked" that means we are being kept out, not the store. */
  readonly blockedShare?: number;
  readonly minimumScansForRates?: number;
  readonly logger?: Logger;
  readonly now?: () => Date;
  /** Sends what deserves attention somewhere a person will see it tonight. */
  readonly notify?: (events: readonly HealthEvent[]) => Promise<void>;
  readonly scan?: (
    url: string,
    knowledge: CompiledKnowledge,
    client: ScanClient,
  ) => Promise<Result<ScanOutcome, ScanFailure>>;
}

export interface ApiContract {
  readonly name: string;
  /** Any call whose response is validated; a schema mismatch is what we are watching for. */
  readonly probe: () => Promise<Result<unknown, { readonly code: string }>>;
}

export interface CanaryOutcome {
  readonly storeUrl: string;
  readonly missingAppIds: readonly string[];
  readonly unreachable: boolean;
}

export interface HealthResult {
  readonly canariesChecked: number;
  readonly canariesIntact: number;
  readonly outcomes: readonly CanaryOutcome[];
  readonly events: readonly HealthEvent[];
}

const JOB = "health";
const DEFAULTS = {
  maxCanaries: 12,
  blockedShare: 0.25,
  minimumScansForRates: 20,
  /** Two windows of a week each: what detection found lately against the week before. */
  windowDays: 7,
  jobLimitsHours: { "catalog-sync": 36, learn: 36, "theme-sync": 14 * 24 },
} as const;

/**
 * Watches the things that break silently. A fingerprint keeps returning nothing long
 * after the app changed its script, and a scan keeps succeeding while every store comes
 * back blocked, so the only way to notice is to check stores whose apps we already know
 * and to watch the shape of recent scans.
 */
export async function health(options: HealthOptions): Promise<HealthResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const events: HealthEvent[] = [];

  const canaries = (await options.repository.canaries()).slice(
    0,
    options.maxCanaries ?? DEFAULTS.maxCanaries,
  );
  const outcomes: CanaryOutcome[] = [];
  for (const canary of canaries) {
    outcomes.push(await checkCanary(options, canary));
  }

  events.push(...canaryEvents(outcomes));
  events.push(...(await contractEvents(options)));
  events.push(...(await rateEvents(options)));
  events.push(...(await staleFingerprintEvents(options)));
  events.push(...(await silentJobEvents(options, now())));

  for (const event of events) {
    await options.repository.recordHealthEvent(event);
  }

  const worthSending = events.filter((event) => event.severity !== "info");
  if (options.notify && worthSending.length > 0) {
    try {
      await options.notify(worthSending);
    } catch (error) {
      // A silent alert channel must not fail the checks that found something.
      options.logger?.error("alert delivery failed", { error: String(error) });
    }
  }

  const intact = outcomes.filter(
    (outcome) => !outcome.unreachable && outcome.missingAppIds.length === 0,
  ).length;

  await options.repository.saveJobState(JOB, {}, "completed", startedAt);
  options.logger?.info("health checked", {
    canaries: outcomes.length,
    intact,
    events: events.length,
  });

  return {
    canariesChecked: outcomes.length,
    canariesIntact: intact,
    outcomes,
    events,
  };
}

async function checkCanary(options: HealthOptions, canary: CanaryStore): Promise<CanaryOutcome> {
  const scan = options.scan ?? defaultScan;
  const result = await scan(canary.storeUrl, options.knowledge, options.client);

  if (!result.ok || result.value.report.status !== "live") {
    return { storeUrl: canary.storeUrl, missingAppIds: [], unreachable: true };
  }

  const found = detectedIds(result.value.report);
  return {
    storeUrl: canary.storeUrl,
    missingAppIds: canary.expectedAppIds.filter((appId) => !found.has(appId)),
    unreachable: false,
  };
}

function defaultScan(
  url: string,
  knowledge: CompiledKnowledge,
  client: ScanClient,
): Promise<Result<ScanOutcome, ScanFailure>> {
  return scanStore(url, { client, knowledge });
}

function detectedIds(report: ScanReport): Set<string> {
  return new Set(report.apps.map((app) => app.appId));
}

/**
 * One canary losing an app points at that app's fingerprint; several losing apps at once
 * points at the platform, so the two cases are raised differently.
 */
function canaryEvents(outcomes: readonly CanaryOutcome[]): HealthEvent[] {
  const reached = outcomes.filter((outcome) => !outcome.unreachable);
  const damaged = reached.filter((outcome) => outcome.missingAppIds.length > 0);

  if (reached.length >= 3 && damaged.length >= Math.ceil(reached.length / 2)) {
    return [
      {
        kind: "canary-sweep",
        severity: "critical",
        detail: {
          checked: reached.length,
          damaged: damaged.length,
          stores: damaged.map((outcome) => outcome.storeUrl),
        },
      },
    ];
  }

  const events: HealthEvent[] = damaged.map((outcome) => ({
    kind: "canary-missing-app",
    severity: "warning",
    detail: { store: outcome.storeUrl, appIds: outcome.missingAppIds },
  }));

  const unreachable = outcomes.filter((outcome) => outcome.unreachable);
  if (unreachable.length > 0) {
    events.push({
      kind: "canary-unreachable",
      severity: unreachable.length === outcomes.length ? "critical" : "info",
      detail: { stores: unreachable.map((outcome) => outcome.storeUrl) },
    });
  }
  return events;
}

/** A changed response shape is worth knowing about before it becomes a wrong report. */
async function contractEvents(options: HealthOptions): Promise<HealthEvent[]> {
  const events: HealthEvent[] = [];
  for (const contract of options.contracts ?? []) {
    const result = await contract.probe();
    if (!result.ok) {
      events.push({
        kind: "api-contract",
        severity: result.error.code === "schema-drift" ? "critical" : "warning",
        detail: { api: contract.name, code: result.error.code },
      });
    }
  }
  return events;
}

async function rateEvents(options: HealthOptions): Promise<HealthEvent[]> {
  const shares = await options.repository.statusShares(24);
  const total = shares.reduce((sum, share) => sum + share.stores, 0);
  const minimum = options.minimumScansForRates ?? DEFAULTS.minimumScansForRates;
  if (total < minimum) {
    return [];
  }

  const blocked = shares.find((share) => share.status === "blocked")?.stores ?? 0;
  const share = blocked / total;
  if (share < (options.blockedShare ?? DEFAULTS.blockedShare)) {
    return [];
  }

  return [
    {
      kind: "blocked-rate",
      severity: "critical",
      detail: { share: Number(share.toFixed(3)), blocked, scanned: total },
    },
  ];
}

/** Nothing else notices a schedule that stopped: the jobs are what watch everything else. */
/**
 * A job counts by when it last finished well, not when it last ran: one that runs every
 * night and fails every night is exactly as stale as one that stopped, and the status it
 * failed with says why.
 */
async function silentJobEvents(options: HealthOptions, now: Date): Promise<HealthEvent[]> {
  const runs = await options.repository.jobRuns();
  const stale: { job: string; lastSuccessAt?: string; lastStatus?: string }[] = [];

  for (const [job, hours] of Object.entries(options.jobLimitsHours ?? DEFAULTS.jobLimitsHours)) {
    const run = runs.find((entry) => entry.job === job);
    const lastSuccessAt = run?.lastSuccessAt;
    if (
      lastSuccessAt === undefined ||
      now.getTime() - lastSuccessAt.getTime() > hours * 3_600_000
    ) {
      stale.push({
        job,
        ...(lastSuccessAt === undefined ? {} : { lastSuccessAt: lastSuccessAt.toISOString() }),
        ...(run?.lastStatus === undefined ? {} : { lastStatus: run.lastStatus }),
      });
    }
  }

  return stale.length === 0
    ? []
    : [{ kind: "job-not-running", severity: "critical", detail: { jobs: stale } }];
}

/** An app detected across many stores last week and none this week has lost its signal. */
async function staleFingerprintEvents(options: HealthOptions): Promise<HealthEvent[]> {
  const days = DEFAULTS.windowDays;
  const [recent, previous] = await Promise.all([
    options.repository.appDetectionCounts(days),
    options.repository.appDetectionCounts(days, days),
  ]);

  const gone: { appId: string; was: number }[] = [];
  for (const [appId, was] of previous) {
    if (was >= 3 && (recent.get(appId) ?? 0) === 0) {
      gone.push({ appId, was });
    }
  }

  return gone.length === 0
    ? []
    : [{ kind: "fingerprint-silent", severity: "warning", detail: { apps: gone } }];
}
