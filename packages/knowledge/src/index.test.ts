import { describe, expect, it } from "vitest";
import { seedKnowledge } from "./index";

const KINDS = new Set([
  "snippet",
  "service",
  "domain",
  "host",
  "inline-token",
  "inline-marker",
  "inline-signature",
  "dom-id",
  "custom-element",
  "bundle",
  "product-image-host",
  "product-sku-prefix",
]);

const STRENGTHS = new Set(["decisive", "strong", "medium"]);

describe("seed knowledge", () => {
  it("carries a version derived from its contents", () => {
    expect(seedKnowledge.version).toMatch(/^seed-[0-9a-f]{8}$/);
  });

  it("ships a catalogue and fingerprints", () => {
    expect(Object.keys(seedKnowledge.apps).length).toBeGreaterThan(500);
    expect(seedKnowledge.fingerprints.length).toBeGreaterThan(100);
  });

  it("only uses known fingerprint kinds and strengths", () => {
    for (const fingerprint of seedKnowledge.fingerprints) {
      expect(KINDS, fingerprint.id).toContain(fingerprint.kind);
      expect(STRENGTHS, fingerprint.id).toContain(fingerprint.strength);
      expect(fingerprint.pattern.trim(), fingerprint.id).not.toBe("");
    }
  });

  it("points every fingerprint at an app in the catalogue", () => {
    const unknown = seedKnowledge.fingerprints.filter((fingerprint) => {
      const { target } = fingerprint;
      return target.type === "app"
        ? seedKnowledge.apps[target.appId] === undefined
        : target.appIds.some((appId) => seedKnowledge.apps[appId] === undefined);
    });

    expect(unknown.map((fingerprint) => fingerprint.id)).toEqual([]);
  });

  it("keeps fingerprint ids unique", () => {
    const ids = seedKnowledge.fingerprints.map((fingerprint) => fingerprint.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lists a fingerprint pattern as noise", () => {
    const noise = new Set([
      ...seedKnowledge.noise.domains,
      ...seedKnowledge.noise.hosts,
      ...seedKnowledge.noise.identifiers,
      ...seedKnowledge.noise.markers,
      ...seedKnowledge.noise.elementIds,
      ...seedKnowledge.noise.inlineSignatures,
    ]);

    const conflicts = seedKnowledge.fingerprints
      .filter((fingerprint) => noise.has(fingerprint.pattern))
      .map((fingerprint) => fingerprint.id);

    expect(conflicts).toEqual([]);
  });

  it("marks the app Salla preinstalls on every store", () => {
    expect(seedKnowledge.apps["691365818"]?.isDefault).toBe(true);
  });
});
