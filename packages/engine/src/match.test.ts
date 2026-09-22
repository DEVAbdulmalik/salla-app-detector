import { describe, expect, it } from "vitest";
import { compileKnowledge } from "./knowledge";
import { matchEvidence } from "./match";
import { confidenceOf } from "./score";
import type { Evidence, Fingerprint, KnowledgeSnapshot } from "./types";

const fingerprints: Fingerprint[] = [
  {
    id: "domain:tooliify.com",
    kind: "domain",
    pattern: "tooliify.com",
    strength: "strong",
    target: { type: "app", appId: "1514900071" },
  },
  {
    id: "marker:app-settings",
    kind: "inline-marker",
    pattern: "=== app settings ===",
    strength: "strong",
    target: { type: "app", appId: "347973230" },
  },
  {
    id: "service:hotjar",
    kind: "service",
    pattern: "hotjar",
    strength: "decisive",
    target: { type: "app", appId: "1406425291" },
  },
];

const knowledge = compileKnowledge({
  version: "test",
  apps: {},
  fingerprints,
  noise: {
    hosts: [],
    domains: [],
    identifiers: [],
    inlineSignatures: [],
    markers: [],
    elementIds: [],
    customElements: [],
  },
} satisfies KnowledgeSnapshot);

describe("matchEvidence", () => {
  it("matches a fingerprint on an exact value", () => {
    const evidence: Evidence[] = [{ kind: "domain", value: "tooliify.com" }];

    const { matches, unmatched } = matchEvidence(evidence, knowledge);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.fingerprint.id).toBe("domain:tooliify.com");
    expect(unmatched).toEqual([]);
  });

  it("matches a comment marker anywhere inside the comment", () => {
    const evidence: Evidence[] = [
      { kind: "inline-marker", value: "start === app settings === end" },
    ];

    expect(matchEvidence(evidence, knowledge).matches[0]?.fingerprint.id).toBe(
      "marker:app-settings",
    );
  });

  it("identifies an app from a snippet even when the catalogue has never seen it", () => {
    const evidence: Evidence[] = [{ kind: "snippet", value: "424242" }];

    const { matches } = matchEvidence(evidence, knowledge);

    expect(matches[0]?.fingerprint).toMatchObject({
      strength: "decisive",
      target: { type: "app", appId: "424242" },
    });
  });

  it("keeps unmatched signals for the learning loop", () => {
    const evidence: Evidence[] = [
      { kind: "domain", value: "unknown-vendor.com" },
      { kind: "service", value: "brand-new-integration" },
    ];

    const { matches, unmatched } = matchEvidence(evidence, knowledge);

    expect(matches).toEqual([]);
    expect(unmatched.map((item) => item.value)).toEqual([
      "unknown-vendor.com",
      "brand-new-integration",
    ]);
  });
});

describe("confidenceOf", () => {
  const evidence = (kind: Evidence["kind"], value: string): Evidence => ({ kind, value });
  const match = (strength: Fingerprint["strength"], kind: Evidence["kind"]) => ({
    fingerprint: {
      id: `${kind}:${strength}`,
      kind,
      pattern: "x",
      strength,
      target: { type: "app", appId: "1" },
    } satisfies Fingerprint,
    evidence: evidence(kind, "x"),
  });

  it("confirms on a decisive signal", () => {
    expect(confidenceOf([match("decisive", "snippet")])).toBe("confirmed");
  });

  it("confirms on two strong signals from different places", () => {
    expect(confidenceOf([match("strong", "domain"), match("strong", "inline-token")])).toBe(
      "confirmed",
    );
  });

  it("does not confirm on two strong signals from the same place", () => {
    expect(confidenceOf([match("strong", "domain"), match("strong", "host")])).toBe("strong");
  });

  it("falls back to possible when only weak signals are present", () => {
    expect(confidenceOf([match("medium", "dom-id")])).toBe("possible");
  });
});
