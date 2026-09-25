import type { ScanReport } from "@salla-app-detector/engine";
import type { KnowledgeRepository } from "@salla-app-detector/knowledge";

/**
 * Everything one scan leaves behind: the report itself, the fingerprints it matched, the
 * store's CDN code, and the signals nothing explained. The learning loop reads all of it,
 * so a scan that skips this step teaches the detector nothing.
 */
export async function recordScanOutcome(
  repository: KnowledgeRepository,
  report: ScanReport,
  durationMs: number,
  /**
   * The store's id when the caller already knows it. A page under maintenance carries no
   * configuration to read it from, and without it the store looks unvisited.
   */
  knownStoreId?: number,
): Promise<void> {
  const storeId = report.store?.id ?? knownStoreId;
  const scan = repository.recordScan({
    storeKey: report.target.key,
    ...(storeId === undefined ? {} : { storeId }),
    status: report.status,
    report,
    engineVersion: report.meta.engineVersion,
    knowledgeVersion: report.meta.knowledgeVersion,
    durationMs,
  });

  if (report.status !== "live") {
    await scan;
    return;
  }

  // None of these writes reads what the others write, and the database may be a continent
  // away, so they go together rather than one round trip after another.
  await Promise.all([
    scan,
    repository.recordFingerprintMatches(matchedSignals(report)),
    report.store?.assetCode === undefined
      ? Promise.resolve()
      : repository.rememberStoreCode(report.store.assetCode, report.store.id, report.target.key),
    repository.recordObservations(
      report.target.key,
      report.unknownSignals.map((signal) => ({
        kind: signal.kind,
        value: signal.value,
        ...(signal.detail === undefined ? {} : { sample: signal.detail }),
      })),
    ),
  ]);
}

/**
 * Every signal in the report that a fingerprint accounted for. Integrations and
 * dropshipping have sections of their own, but they are fingerprint matches all the same,
 * and leaving them out made fingerprints that match every other store look unused.
 */
export function matchedSignals(report: ScanReport): { kind: string; value: string }[] {
  const evidence = [...report.apps, ...report.dropshipping].flatMap((app) =>
    app.evidence.map((item) => ({ kind: item.kind, value: item.value })),
  );
  const services = report.integrations.flatMap((integration) =>
    integration.appId === undefined ? [] : [{ kind: "service", value: integration.key }],
  );
  return [...evidence, ...services];
}
