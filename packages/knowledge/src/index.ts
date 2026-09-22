import {
  fnv1a,
  type AppInfo,
  type Fingerprint,
  type KnowledgeSnapshot,
  type NoiseRules,
} from "@salla-app-detector/engine";
import appsData from "./data/apps.json" with { type: "json" };
import fingerprintsData from "./data/fingerprints.json" with { type: "json" };
import noiseData from "./data/noise.json" with { type: "json" };

/**
 * The knowledge the detector ships with: the app catalogue, the fingerprints that point at
 * those apps, and the platform background to ignore. Its shape is asserted by the tests in
 * this package, and the version travels with every report so a result can be traced back
 * to the exact knowledge that produced it.
 */
const apps = appsData as unknown as Record<string, AppInfo>;
const fingerprints = fingerprintsData as unknown as Fingerprint[];
const noise = noiseData as unknown as NoiseRules;

const version = `seed-${fnv1a(JSON.stringify([appsData, fingerprintsData, noiseData]))}`;

export const seedKnowledge: KnowledgeSnapshot = { version, apps, fingerprints, noise };

export function loadSeedKnowledge(): KnowledgeSnapshot {
  return seedKnowledge;
}
