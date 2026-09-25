import type { EvidenceKind, FingerprintStrength } from "@salla-app-detector/engine";
import type { KnowledgeRepository } from "@salla-app-detector/knowledge";
import { err, ok, type Result } from "@salla-app-detector/shared";

export type PromotionError = "unsupported-kind" | "missing-app";

/** The signal kinds the learning loop clusters on, and which a fingerprint can carry. */
export const PROMOTABLE_KINDS = [
  "service",
  "host",
  "domain",
  "inline-signature",
  "inline-token",
  "product-image-host",
  "tag-container",
] as const satisfies readonly EvidenceKind[];

export interface Promotion {
  readonly signalKind: string;
  readonly signalValue: string;
  readonly appId: string;
  readonly strength?: FingerprintStrength;
}

/**
 * Turns a reviewed candidate into a fingerprint that scanning uses from the next scan on.
 * Shared by the panel and the terminal so a decision means the same thing either way.
 */
export async function promoteCandidate(
  repository: KnowledgeRepository,
  promotion: Promotion,
): Promise<Result<void, PromotionError>> {
  const kind = PROMOTABLE_KINDS.find((allowed) => allowed === promotion.signalKind);
  if (kind === undefined) {
    return err("unsupported-kind");
  }
  const appId = promotion.appId.trim();
  if (appId === "") {
    return err("missing-app");
  }

  await repository.upsertFingerprints([
    {
      id: `mined:${kind}:${promotion.signalValue}`,
      kind,
      pattern: promotion.signalValue,
      strength: promotion.strength ?? "strong",
      source: "mined",
      appId,
    },
  ]);
  await repository.setCandidateStatus(kind, promotion.signalValue, "promoted");
  await repository.publishSnapshot();
  return ok(undefined);
}

/** Leaves the trace on record as decided, so the next learning run stops proposing it. */
export async function ignoreCandidate(
  repository: KnowledgeRepository,
  signalKind: string,
  signalValue: string,
): Promise<void> {
  await repository.setCandidateStatus(signalKind, signalValue, "ignored");
}
