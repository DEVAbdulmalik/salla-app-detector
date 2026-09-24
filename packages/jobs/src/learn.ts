import { describeHost } from "@salla-app-detector/engine";
import {
  GENERIC_DEVELOPER_DOMAINS,
  type CandidateUpsert,
  type KnowledgeRepository,
  type SignalCluster,
} from "@salla-app-detector/knowledge";
import type { Logger } from "@salla-app-detector/shared";

export interface LearnOptions {
  readonly repository: KnowledgeRepository;
  /** How many distinct stores must share a signal before it is worth investigating. */
  readonly candidateThreshold?: number;
  /** A signal on nearly every store belongs to the platform, not to an app. */
  readonly noiseShare?: number;
  readonly themeShare?: number;
  readonly minimumScansForNoise?: number;
  readonly logger?: Logger;
  readonly now?: () => Date;
}

export interface LearnResult {
  readonly candidates: number;
  readonly attributed: number;
  /** Traces that belong to a theme rather than to an app a merchant installed. */
  readonly themeAssets: number;
  readonly noiseRulesAdded: readonly string[];
  readonly newServiceKeys: readonly string[];
}

const JOB = "learn";
const DEFAULTS = {
  candidateThreshold: 5,
  /** Below this, a theme's stores merely happen to share something. */
  themeShare: 0.9,
  noiseShare: 0.85,
  minimumScansForNoise: 100,
} as const;

/**
 * Turns what scanning could not explain into something actionable: signals seen across
 * enough stores become candidates, those that match a known vendor's domain are attributed
 * automatically, and signals that appear on almost every store are recorded as platform
 * background. Nothing here changes detection on its own; a person still promotes a
 * candidate into a fingerprint.
 */
export async function learn(options: LearnOptions): Promise<LearnResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const threshold = options.candidateThreshold ?? DEFAULTS.candidateThreshold;

  const clusters = await options.repository.signalClusters(threshold);
  const noiseRulesAdded = await recordPlatformNoise(options, clusters);
  const remaining = clusters.filter((cluster) => !noiseRulesAdded.includes(cluster.signalValue));

  const domainOwners = await options.repository.domainOwners();
  const themeShare = options.themeShare ?? DEFAULTS.themeShare;
  const concentration = await options.repository.signalThemeConcentration(threshold);
  const candidates: CandidateUpsert[] = [];
  let attributed = 0;
  let themeAssets = 0;

  for (const cluster of remaining) {
    const suggestion = suggestApp(cluster, domainOwners);
    if (suggestion !== undefined) {
      attributed += 1;
    }

    // A trace on every store running one theme is that theme's own asset. Saying so keeps
    // the reviewer from investigating the same theme's files as if they were an app.
    const theme = concentration.find(
      (entry) =>
        entry.signalKind === cluster.signalKind &&
        entry.signalValue === cluster.signalValue &&
        entry.share >= themeShare,
    );
    if (theme !== undefined) {
      themeAssets += 1;
    }

    candidates.push({
      signalKind: cluster.signalKind,
      signalValue: cluster.signalValue,
      storeCount: cluster.storeCount,
      ...(suggestion === undefined ? {} : { suggestedAppId: suggestion }),
      ...(theme === undefined ? {} : { themeId: theme.themeId }),
      ...(cluster.sample === undefined ? {} : { sample: cluster.sample }),
    });
  }

  // Read before writing: a key already in the queue was reported when it first appeared,
  // and repeating the alert every night would bury the one that is actually new.
  const knownServiceKeys = await options.repository.candidateSignalValues("service");
  await options.repository.upsertCandidates(candidates);

  const newServiceKeys = remaining
    .filter(
      (cluster) =>
        cluster.signalKind === "service" && !knownServiceKeys.includes(cluster.signalValue),
    )
    .map((cluster) => cluster.signalValue);
  for (const key of newServiceKeys) {
    options.logger?.warn("unmapped integration key", { key });
    await options.repository.recordHealthEvent({
      kind: "unmapped-service-key",
      severity: "warning",
      detail: { key },
    });
  }

  await options.repository.saveJobState(
    JOB,
    { candidates: candidates.length, attributed },
    "completed",
    startedAt,
  );

  return {
    candidates: candidates.length,
    attributed,
    themeAssets,
    noiseRulesAdded,
    newServiceKeys,
  };
}

/**
 * A signal present on nearly every store cannot distinguish one store from another. Salla
 * changes its own scripts over time, so this keeps the noise list current by itself.
 */
async function recordPlatformNoise(
  options: LearnOptions,
  clusters: readonly SignalCluster[],
): Promise<string[]> {
  const scans = await options.repository.recentScanCount(30);
  const minimum = options.minimumScansForNoise ?? DEFAULTS.minimumScansForNoise;
  if (scans < minimum) {
    return [];
  }

  const share = options.noiseShare ?? DEFAULTS.noiseShare;
  const platform = clusters.filter((cluster) => cluster.storeCount / scans >= share);
  if (platform.length === 0) {
    return [];
  }

  await options.repository.upsertNoiseRules(
    platform.map((cluster) => ({
      kind: noiseKindFor(cluster.signalKind),
      pattern: cluster.signalValue,
      reason: `seen on ${String(cluster.storeCount)} of ${String(scans)} scanned stores`,
    })),
  );
  options.logger?.info("platform background recorded", { count: platform.length });

  return platform.map((cluster) => cluster.signalValue);
}

function noiseKindFor(signalKind: string): "hosts" | "domains" | "inlineSignatures" {
  switch (signalKind) {
    case "host":
      return "hosts";
    case "inline-signature":
      return "inlineSignatures";
    default:
      return "domains";
  }
}

/** A signal on a vendor's own domain already names the app behind it. */
function suggestApp(
  cluster: SignalCluster,
  owners: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  if (cluster.signalKind !== "domain" && cluster.signalKind !== "host") {
    return undefined;
  }
  const info = describeHost(cluster.signalValue);
  if (!info || GENERIC_DEVELOPER_DOMAINS.has(info.domain)) {
    return undefined;
  }
  const appIds = owners.get(info.domain);
  return appIds?.length === 1 ? appIds[0] : undefined;
}
