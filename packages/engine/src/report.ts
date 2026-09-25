import type { CompiledKnowledge } from "./knowledge";
import type { Match } from "./match";
import { confidenceOf } from "./score";
import type {
  AppInfo,
  Confidence,
  DetectedApp,
  Evidence,
  EvidenceKind,
  Integration,
  PageStatus,
  PaymentSummary,
  ReportEvidence,
  ScanReport,
  DetectedTheme,
  StoreSummary,
  UnknownSignal,
} from "./types";
import { ENGINE_VERSION } from "./version";

export interface ReportInput {
  readonly target: { readonly url: string; readonly host: string; readonly key: string };
  readonly status: PageStatus;
  readonly store?: StoreSummary;
  readonly theme?: DetectedTheme;
  readonly matches: readonly Match[];
  readonly unmatched: readonly Evidence[];
  readonly payments: PaymentSummary;
  readonly knowledge: CompiledKnowledge;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { confirmed: 0, strong: 1, possible: 2 };
const STRENGTH_RANK = { decisive: 0, strong: 1, medium: 2 } as const;

/**
 * Signals worth carrying into the learning loop; the rest are too noisy to cluster on.
 * Theme component bundles are left out: they identify a theme's building blocks rather
 * than an installed app.
 */
const LEARNABLE_KINDS = new Set<EvidenceKind>([
  "service",
  "host",
  "domain",
  "inline-signature",
  "product-image-host",
]);

const MAX_UNKNOWN_SIGNALS = 50;

export function buildReport(input: ReportInput): ScanReport {
  const byApp = new Map<string, Match[]>();
  const byCompany = new Map<string, { appIds: readonly string[]; matches: Match[] }>();

  for (const match of input.matches) {
    const { target } = match.fingerprint;
    if (target.type === "app") {
      append(byApp, target.appId, match);
    } else {
      const entry = byCompany.get(target.company) ?? { appIds: target.appIds, matches: [] };
      entry.matches.push(match);
      byCompany.set(target.company, entry);
    }
  }

  const apps: DetectedApp[] = [];
  const dropshipping: DetectedApp[] = [];

  for (const [appId, matches] of byApp) {
    if (matches.every((match) => match.evidence.kind === "service")) {
      continue; // Reported under integrations instead.
    }
    const detected = describeApp(appId, matches, input.knowledge);
    const productOnly = matches.every((match) => match.evidence.kind.startsWith("product-"));
    (productOnly ? dropshipping : apps).push(detected);
  }

  for (const [company, entry] of byCompany) {
    if (entry.appIds.some((appId) => byApp.has(appId))) {
      continue; // Another signal already named the exact app.
    }
    // A trace can be shared by apps from different vendors, such as a supplier's image host
    // that several importers bring along, so the candidates are named, not just counted.
    const productOnly = entry.matches.every((match) => match.evidence.kind.startsWith("product-"));
    (productOnly ? dropshipping : apps).push({
      appId: `company:${company}`,
      name: company,
      company,
      categories: [],
      status: "unidentified",
      isDefault: false,
      confidence: "possible",
      evidence: toReportEvidence(entry.matches),
      ambiguousWith: entry.appIds,
      alternatives: entry.appIds.map((appId) => ({
        appId,
        name: input.knowledge.snapshot.apps[appId]?.name ?? appId,
      })),
    });
  }

  return {
    target: input.target,
    status: input.status,
    ...(input.store === undefined ? {} : { store: input.store }),
    ...(input.theme === undefined ? {} : { theme: input.theme }),
    apps: apps.sort(compareApps),
    dropshipping: dropshipping.sort(compareApps),
    integrations: buildIntegrations(input, byApp),
    payments: input.payments,
    unknownSignals: buildUnknownSignals(input.unmatched),
    meta: {
      engineVersion: ENGINE_VERSION,
      knowledgeVersion: input.knowledge.snapshot.version,
    },
  };
}

function describeApp(
  appId: string,
  matches: readonly Match[],
  knowledge: CompiledKnowledge,
): DetectedApp {
  const info: AppInfo | undefined = knowledge.snapshot.apps[appId];
  return {
    appId,
    name: info?.name ?? appId,
    ...(info?.nameEn === undefined ? {} : { nameEn: info.nameEn }),
    ...(info?.company === undefined ? {} : { company: info.company }),
    categories: info?.categories ?? [],
    status: info?.status ?? "unidentified",
    isDefault: info?.isDefault ?? false,
    confidence: confidenceOf(matches),
    evidence: toReportEvidence(matches),
  };
}

function buildIntegrations(
  input: ReportInput,
  byApp: ReadonlyMap<string, readonly Match[]>,
): readonly Integration[] {
  const integrations = new Map<string, Integration>();

  for (const [appId, matches] of byApp) {
    for (const match of matches) {
      if (match.evidence.kind !== "service") {
        continue;
      }
      const info = input.knowledge.snapshot.apps[appId];
      integrations.set(match.evidence.value, {
        key: match.evidence.value,
        appId,
        ...(info?.name === undefined ? {} : { name: info.name }),
      });
    }
  }

  for (const item of input.unmatched) {
    if (item.kind === "service" && !integrations.has(item.value)) {
      integrations.set(item.value, { key: item.value });
    }
  }

  return [...integrations.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function buildUnknownSignals(unmatched: readonly Evidence[]): readonly UnknownSignal[] {
  const domains = new Set(
    unmatched.filter((item) => item.kind === "domain").map((item) => item.value),
  );

  const signals: UnknownSignal[] = [];
  for (const item of unmatched) {
    if (!LEARNABLE_KINDS.has(item.kind)) {
      continue;
    }
    // A host adds nothing when its own domain is already listed as unknown.
    if (item.kind === "host" && domains.has(shortenHost(item.value))) {
      continue;
    }
    signals.push({
      kind: item.kind,
      value: item.value,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
    });
  }

  return signals
    .sort(
      (left, right) => left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value),
    )
    .slice(0, MAX_UNKNOWN_SIGNALS);
}

function shortenHost(host: string): string {
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
}

function toReportEvidence(matches: readonly Match[]): readonly ReportEvidence[] {
  const seen = new Map<string, ReportEvidence>();
  for (const match of matches) {
    const key = `${match.evidence.kind}:${match.evidence.value}`;
    if (!seen.has(key)) {
      seen.set(key, {
        kind: match.evidence.kind,
        value: match.evidence.value,
        ...(match.evidence.detail === undefined ? {} : { detail: match.evidence.detail }),
        strength: match.fingerprint.strength,
      });
    }
  }
  return [...seen.values()].sort(
    (left, right) =>
      STRENGTH_RANK[left.strength] - STRENGTH_RANK[right.strength] ||
      left.kind.localeCompare(right.kind) ||
      left.value.localeCompare(right.value),
  );
}

function compareApps(left: DetectedApp, right: DetectedApp): number {
  return (
    CONFIDENCE_RANK[left.confidence] - CONFIDENCE_RANK[right.confidence] ||
    Number(left.isDefault) - Number(right.isDefault) ||
    left.appId.localeCompare(right.appId)
  );
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    map.set(key, [value]);
  }
}
