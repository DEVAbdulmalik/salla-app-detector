import type {
  CandidateUpsert,
  CanaryStore,
  FingerprintUpsert,
  KnowledgeRepository,
  NoiseUpsert,
} from "./db/repository";

/**
 * What a database holds that nothing else can give back. Apps, themes and generated
 * fingerprints come from Salla again on the next sync, and scans are history; these are
 * the decisions people made, which is all a backup has to keep.
 */
export interface KnowledgeBackup {
  readonly format: 1;
  readonly exportedAt: string;
  readonly fingerprints: readonly FingerprintUpsert[];
  readonly noise: readonly NoiseUpsert[];
  readonly candidates: readonly (CandidateUpsert & { readonly status: string })[];
  readonly canaries: readonly CanaryStore[];
  readonly groundTruth: readonly { appId: string; storeId: number; observedOn?: string }[];
}

export async function exportKnowledge(
  repository: KnowledgeRepository,
  now: Date = new Date(),
): Promise<KnowledgeBackup> {
  const [fingerprints, noise, candidates, canaries, groundTruth] = await Promise.all([
    repository.curatedFingerprints(),
    repository.curatedNoise(),
    repository.candidateDecisions(),
    repository.canaries(),
    repository.groundTruthPairs(),
  ]);
  return {
    format: 1,
    exportedAt: now.toISOString(),
    fingerprints,
    noise,
    candidates,
    canaries,
    groundTruth,
  };
}

const SECTIONS = ["fingerprints", "noise", "candidates", "canaries", "groundTruth"] as const;

/**
 * A backup file comes from disk and may be old, hand-edited or something else entirely,
 * so its shape is checked before anything is written from it.
 */
export function parseBackup(value: unknown): KnowledgeBackup {
  if (typeof value !== "object" || value === null) {
    throw new Error("not a knowledge backup");
  }
  const record = value as Record<string, unknown>;
  if (record.format !== 1) {
    throw new Error(`unsupported backup format: ${String(record.format)}`);
  }
  for (const section of SECTIONS) {
    if (!Array.isArray(record[section])) {
      throw new Error(`backup is missing its ${section}`);
    }
  }
  return value as KnowledgeBackup;
}

export interface RestoreSummary {
  readonly fingerprints: number;
  readonly noise: number;
  readonly candidates: number;
  readonly canaries: number;
  readonly groundTruth: number;
}

/**
 * Loads a backup on top of whatever the database already has. Every write is an upsert,
 * so restoring twice changes nothing, and it expects the catalogue to be present: a
 * fingerprint for an app the database has never heard of has nowhere to point.
 */
export async function restoreKnowledge(
  repository: KnowledgeRepository,
  backup: KnowledgeBackup,
): Promise<RestoreSummary> {
  await repository.upsertFingerprints(backup.fingerprints);
  await repository.upsertNoiseRules(backup.noise);
  await repository.upsertCandidates(backup.candidates);
  for (const candidate of backup.candidates) {
    if (candidate.status !== "new") {
      await repository.setCandidateStatus(
        candidate.signalKind,
        candidate.signalValue,
        candidate.status,
      );
    }
  }
  await repository.upsertCanaries(backup.canaries);
  await repository.recordGroundTruth(backup.groundTruth);
  await repository.publishSnapshot();

  return {
    fingerprints: backup.fingerprints.length,
    noise: backup.noise.length,
    candidates: backup.candidates.length,
    canaries: backup.canaries.length,
    groundTruth: backup.groundTruth.length,
  };
}
