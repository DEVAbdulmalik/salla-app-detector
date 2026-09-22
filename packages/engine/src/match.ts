import { type CompiledKnowledge, indexKey } from "./knowledge";
import type { Evidence, Fingerprint } from "./types";

export interface Match {
  readonly fingerprint: Fingerprint;
  readonly evidence: Evidence;
}

export interface MatchResult {
  readonly matches: readonly Match[];
  /** Signals that are neither known noise nor a known app: the input to the learning loop. */
  readonly unmatched: readonly Evidence[];
}

export function matchEvidence(
  evidence: readonly Evidence[],
  knowledge: CompiledKnowledge,
): MatchResult {
  const matches: Match[] = [];
  const unmatched: Evidence[] = [];

  for (const item of evidence) {
    const found = fingerprintsFor(item, knowledge);
    if (found.length === 0) {
      unmatched.push(item);
      continue;
    }
    for (const fingerprint of found) {
      matches.push({ fingerprint, evidence: item });
    }
  }

  return { matches, unmatched };
}

function fingerprintsFor(item: Evidence, knowledge: CompiledKnowledge): readonly Fingerprint[] {
  if (item.kind === "inline-marker") {
    return knowledge.markers.filter((fingerprint) => item.value.includes(fingerprint.pattern));
  }

  const exact = knowledge.exact.get(indexKey(item.kind, item.value)) ?? [];
  if (exact.length > 0 || item.kind !== "snippet") {
    return exact;
  }

  // A snippet carries the app id in its URL, so it identifies an app even when the
  // knowledge base has never seen that app before.
  return [
    {
      id: `snippet:${item.value}`,
      kind: "snippet",
      pattern: item.value,
      strength: "decisive",
      target: { type: "app", appId: item.value },
    },
  ];
}
