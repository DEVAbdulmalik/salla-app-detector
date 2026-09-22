import { compileKnowledge } from "@salla-app-detector/engine";
import { scanStore } from "@salla-app-detector/jobs";
import { seedKnowledge } from "@salla-app-detector/knowledge";
import { SallaClient } from "@salla-app-detector/salla";
import { describe, expect, it } from "vitest";

/**
 * Reaches the real platform, so it stays out of the normal run and out of CI. Use it to
 * confirm that Salla still serves what the detector expects:
 *
 *   SALLA_LIVE=1 pnpm test tools/cli
 */
const enabled = process.env.SALLA_LIVE === "1";

describe.skipIf(!enabled)("live scan", () => {
  const knowledge = compileKnowledge(seedKnowledge);
  const client = new SallaClient({ timeoutMs: 20_000 });

  it("scans a store and recognises the apps it is known to use", { timeout: 60_000 }, async () => {
    const result = await scanStore("psupps.net", { client, knowledge });

    if (!result.ok) {
      throw new Error(`scan failed: ${result.error.code}`);
    }
    const { report } = result.value;
    expect(report.status).toBe("live");
    expect(report.store?.id).toBeGreaterThan(0);
    expect(report.apps.map((app) => app.appId)).toContain("996829016");
    expect(report.integrations.length).toBeGreaterThan(0);
  });

  it("declines a page that is not a storefront", { timeout: 60_000 }, async () => {
    const result = await scanStore("https://apps.salla.sa/ar/app/691365818", {
      client,
      knowledge,
    });

    expect(result.ok).toBe(false);
  });
});
