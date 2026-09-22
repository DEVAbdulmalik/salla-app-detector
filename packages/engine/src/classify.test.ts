import { describe, expect, it } from "vitest";
import { classifyPage, type PageInput } from "./classify";

const SALLA_PAGE =
  '<html><head><script src="https://cdn.salla.network/js/twilight/2.14.584/twilight.esm.js"></script></head><body></body></html>';

function page(overrides: Partial<PageInput> = {}): PageInput {
  return {
    status: 200,
    finalUrl: "https://mahwous.com/",
    html: SALLA_PAGE,
    ...overrides,
  };
}

describe("classifyPage", () => {
  it("accepts a Salla page whose configuration was read", () => {
    expect(classifyPage(page(), true)).toEqual({ status: "live" });
  });

  it("flags a Salla page whose configuration could not be read", () => {
    const classification = classifyPage(page(), false);

    expect(classification.status).toBe("unsupported");
    expect(classification.detail).toBeDefined();
  });

  it("recognises a store under maintenance", () => {
    const html = `${SALLA_PAGE}<link href="https://cdn.assets.salla.network/prod/stores/css/maintenance.css">`;

    expect(classifyPage(page({ html }), false).status).toBe("maintenance");
  });

  it("recognises a closed store", () => {
    expect(classifyPage(page({ status: 410 }), false).status).toBe("closed");
  });

  it("recognises a page that is not a Salla store", () => {
    expect(classifyPage(page({ html: "<html><body>hello</body></html>" }), false).status).toBe(
      "not-salla",
    );
  });

  it("recognises being blocked, by status, header or interstitial", () => {
    expect(classifyPage(page({ status: 429 }), false).status).toBe("blocked");
    expect(classifyPage(page({ headers: { "cf-mitigated": "challenge" } }), true).status).toBe(
      "blocked",
    );
    expect(
      classifyPage(page({ html: "<html><title>Just a moment...</title></html>" }), false).status,
    ).toBe("blocked");
  });

  it("does not mistake Cloudflare's ordinary script for a block", () => {
    const html = `${SALLA_PAGE}<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>`;

    expect(classifyPage(page({ html }), true).status).toBe("live");
  });
});
