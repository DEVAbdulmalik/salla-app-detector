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
): Promise<void> {
  const scan = repository.recordScan({
    storeKey: report.target.key,
    ...(report.store === undefined ? {} : { storeId: report.store.id }),
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
    repository.recordFingerprintMatches(
      report.apps.flatMap((app) =>
        app.evidence.map((item) => ({ kind: item.kind, value: item.value })),
      ),
    ),
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
