import type {
  AppQuality,
  AppVerdict,
  KnowledgeRepository,
  MinedCandidate,
} from "@salla-app-detector/knowledge";
import type { Logger } from "@salla-app-detector/shared";

export interface MineOptions {
  readonly repository: KnowledgeRepository;
  /** Live stores known to run an app before anything is said about it. */
  readonly minStores?: number;
  /** Stores that must carry a trace before it counts, however small the group. */
  readonly minSupport?: number;
  readonly groupShare?: number;
  readonly baselineShare?: number;
  /** Stores it takes, all without a trace, before an app is called traceless. */
  readonly noTraceStores?: number;
  readonly logger?: Logger;
}

/**
 * Where a trace stands: already one of this app's fingerprints, a new lead for it, or
 * something that belongs to another app and merely travels with this one.
 */
export type SignalStanding = "known" | "new" | "shared";

export interface MinedSignal {
  readonly kind: string;
  readonly value: string;
  readonly groupStores: number;
  readonly baselineShare: number;
  readonly standing: SignalStanding;
  /** The other apps a shared trace belongs to or also stands out for. */
  readonly sharedWith?: readonly string[];
}

export interface AppMining extends AppQuality {
  readonly signals: readonly MinedSignal[];
}

export interface MineResult {
  readonly liveStores: number;
  readonly apps: readonly AppMining[];
  readonly candidates: readonly MinedCandidate[];
  /** Of those, the ones waiting for a decision; a trace someone already decided on stays decided. */
  readonly queued: number;
}

const DEFAULTS = {
  minStores: 5,
  minSupport: 3,
  groupShare: 0.5,
  baselineShare: 0.05,
  noTraceStores: 8,
} as const;

/**
 * Compares the stores known to run each app with every other live store. A trace most of
 * an app's stores carry and few others do is that app's fingerprint in waiting; an app
 * that many of its own stores show nothing for leaves no public trace at all.
 *
 * Merchants who run one app often run another, so a trace can stand out for an app
 * without belonging to it. Anything already tied to a different app is reported as
 * shared, and a new trace that stands out for two apps at once is left for a person.
 */
export async function mineAppSignals(options: MineOptions): Promise<MineResult> {
  const settings = {
    minStores: options.minStores ?? DEFAULTS.minStores,
    minSupport: options.minSupport ?? DEFAULTS.minSupport,
    groupShare: options.groupShare ?? DEFAULTS.groupShare,
    baselineShare: options.baselineShare ?? DEFAULTS.baselineShare,
    noTraceStores: options.noTraceStores ?? DEFAULTS.noTraceStores,
  };
  const [stores, pairs, owners] = await Promise.all([
    options.repository.liveStoreSignals(),
    options.repository.groundTruthPairs(),
    options.repository.fingerprintOwners(),
  ]);

  const byStore = new Map(
    stores.map((store) => [
      store.storeId,
      {
        appIds: new Set(store.appIds),
        signals: new Set(store.signals.map((signal) => key(signal.kind, signal.value))),
      },
    ]),
  );
  const totals = new Map<string, number>();
  for (const store of byStore.values()) {
    for (const signal of store.signals) {
      totals.set(signal, (totals.get(signal) ?? 0) + 1);
    }
  }
  const ownersOf = new Map(owners.map((owner) => [key(owner.kind, owner.pattern), owner.appIds]));

  const groups = new Map<string, number[]>();
  for (const pair of pairs) {
    if (byStore.has(pair.storeId)) {
      groups.set(pair.appId, [...(groups.get(pair.appId) ?? []), pair.storeId]);
    }
  }

  const drafts: { appId: string; stores: number[]; signals: MinedSignal[] }[] = [];
  for (const [appId, members] of groups) {
    if (members.length < settings.minStores) {
      continue;
    }
    const counts = new Map<string, number>();
    for (const storeId of members) {
      for (const signal of byStore.get(storeId)?.signals ?? []) {
        counts.set(signal, (counts.get(signal) ?? 0) + 1);
      }
    }

    const others = byStore.size - members.length;
    const signals: MinedSignal[] = [];
    for (const [signal, count] of counts) {
      const baseline = others === 0 ? 0 : ((totals.get(signal) ?? 0) - count) / others;
      if (
        count < settings.minSupport ||
        count / members.length < settings.groupShare ||
        baseline > settings.baselineShare
      ) {
        continue;
      }
      const [kind, value] = split(signal);
      const owned = kind === "snippet" ? [value] : (ownersOf.get(signal) ?? []);
      const standing: SignalStanding =
        owned.length === 0 ? "new" : owned.includes(appId) ? "known" : "shared";
      signals.push({
        kind,
        value,
        groupStores: count,
        baselineShare: baseline,
        standing,
        ...(standing === "shared" ? { sharedWith: owned } : {}),
      });
    }
    drafts.push({ appId, stores: members, signals });
  }

  // A new trace standing out for several apps cannot say which one it belongs to.
  const newFor = new Map<string, string[]>();
  for (const draft of drafts) {
    for (const signal of draft.signals) {
      if (signal.standing === "new") {
        const id = key(signal.kind, signal.value);
        newFor.set(id, [...(newFor.get(id) ?? []), draft.appId]);
      }
    }
  }

  const apps: AppMining[] = drafts.map((draft) => {
    const signals = draft.signals
      .map((signal): MinedSignal => {
        const claimants = newFor.get(key(signal.kind, signal.value)) ?? [];
        return signal.standing === "new" && claimants.length > 1
          ? {
              ...signal,
              standing: "shared",
              sharedWith: claimants.filter((id) => id !== draft.appId),
            }
          : signal;
      })
      .sort(
        (left, right) =>
          right.groupStores - left.groupStores ||
          left.baselineShare - right.baselineShare ||
          left.kind.localeCompare(right.kind) ||
          left.value.localeCompare(right.value),
      );
    const detected = draft.stores.filter((storeId) =>
      byStore.get(storeId)?.appIds.has(draft.appId),
    ).length;
    return {
      appId: draft.appId,
      stores: draft.stores.length,
      detected,
      verdict: verdictFor(draft.stores.length, detected, signals, settings.noTraceStores),
      signals,
    };
  });
  apps.sort((left, right) => right.stores - left.stores || left.appId.localeCompare(right.appId));

  const candidates: MinedCandidate[] = apps.flatMap((app) =>
    app.signals
      .filter((signal) => signal.standing === "new")
      .map((signal) => ({
        signalKind: signal.kind,
        signalValue: signal.value,
        appId: app.appId,
        groupStores: signal.groupStores,
        groupSize: app.stores,
        baselineShare: Number(signal.baselineShare.toFixed(4)),
      })),
  );

  const [queued] = await Promise.all([
    options.repository.recordMinedCandidates(candidates),
    options.repository.saveAppQuality(
      apps.map(({ appId, stores: count, detected, verdict }) => ({
        appId,
        stores: count,
        detected,
        verdict,
      })),
    ),
  ]);
  options.logger?.info("app signals mined", {
    liveStores: byStore.size,
    apps: apps.length,
    candidates: candidates.length,
    queued,
  });

  return { liveStores: byStore.size, apps, candidates, queued };
}

function verdictFor(
  stores: number,
  detected: number,
  signals: readonly MinedSignal[],
  noTraceStores: number,
): AppVerdict {
  if (detected / stores >= 0.5) {
    return "detected";
  }
  const leads = signals.some((signal) => signal.standing !== "shared");
  return stores >= noTraceStores && detected === 0 && !leads ? "no-trace" : "unclear";
}

function key(kind: string, value: string): string {
  return `${kind}\u0000${value}`;
}

function split(signal: string): [string, string] {
  const at = signal.indexOf("\u0000");
  return [signal.slice(0, at), signal.slice(at + 1)];
}
