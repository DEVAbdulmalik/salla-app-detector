import type { KnowledgeSnapshot } from "@salla-app-detector/engine";
import type {
  FingerprintSource,
  KnowledgeRepository,
  NoiseKind,
  NoiseUpsert,
} from "./db/repository";
import { seedKnowledge } from "./index";

export interface ImportSummary {
  readonly apps: number;
  readonly fingerprints: number;
  readonly noiseRules: number;
}

/**
 * Loads the knowledge the detector ships with into an empty database. Generated
 * fingerprints keep the `auto` source so a catalogue refresh can replace them, while
 * hand-written ones are never touched by a job.
 */
export async function importSeed(
  repository: KnowledgeRepository,
  snapshot: KnowledgeSnapshot = seedKnowledge,
): Promise<ImportSummary> {
  const apps = Object.values(snapshot.apps);
  await repository.upsertApps(
    apps.map((app) => ({
      id: app.id,
      name: app.name,
      ...(app.nameEn === undefined ? {} : { nameEn: app.nameEn }),
      ...(app.company === undefined ? {} : { company: app.company }),
      categories: app.categories ?? [],
      status: app.status,
      ...(app.isDefault === undefined ? {} : { isDefault: app.isDefault }),
    })),
  );

  await repository.upsertFingerprints(
    snapshot.fingerprints.map((fingerprint) => ({
      id: fingerprint.id,
      kind: fingerprint.kind,
      pattern: fingerprint.pattern,
      strength: fingerprint.strength,
      source: sourceOf(fingerprint.id),
      ...(fingerprint.target.type === "app"
        ? { appId: fingerprint.target.appId }
        : { company: fingerprint.target.company, companyAppIds: fingerprint.target.appIds }),
      ...(fingerprint.minProductShare === undefined
        ? {}
        : { minProductShare: fingerprint.minProductShare }),
    })),
  );

  const noiseRules: NoiseUpsert[] = Object.entries(snapshot.noise).flatMap(
    ([kind, patterns]: [string, readonly string[]]) =>
      patterns.map((pattern) => ({ kind: kind as NoiseKind, pattern, reason: "seed" })),
  );
  await repository.upsertNoiseRules(noiseRules);

  return {
    apps: apps.length,
    fingerprints: snapshot.fingerprints.length,
    noiseRules: noiseRules.length,
  };
}

function sourceOf(fingerprintId: string): FingerprintSource {
  return fingerprintId.startsWith("dev-domain:") ? "auto" : "manual";
}
