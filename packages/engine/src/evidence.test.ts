import { describe, expect, it } from "vitest";
import { parseStorefront } from "./document";
import { collectEvidence } from "./evidence";
import { filterNoise } from "./noise";
import type { Evidence, NoiseRules } from "./types";

const EMPTY_NOISE: NoiseRules = {
  hosts: [],
  domains: [],
  identifiers: [],
  inlineSignatures: [],
  markers: [],
  elementIds: [],
  customElements: [],
};

function valuesOf(evidence: readonly Evidence[], kind: Evidence["kind"]): string[] {
  return evidence.filter((item) => item.kind === kind).map((item) => item.value);
}

describe("collectEvidence", () => {
  function loader(container: string): string {
    return `<script>(function(w,d,s,l,i){w[l]=w[l]||[];var j=d.createElement(s);
      j.src='https://www.googletagmanager.com/gtm.js?id='+i;})(window,document,'script','dataLayer','${container}');</script>`;
  }

  it("notes a Tag Manager container the merchant brought, but not Salla's own", () => {
    const own = collectEvidence(parseStorefront(loader("GTM-TGFC6FV"), "mystore.com"), undefined);
    const merchant = collectEvidence(
      parseStorefront(loader("GTM-TGFC6FV") + loader("GTM-WHBMQMVP"), "mystore.com"),
      undefined,
    );

    expect(valuesOf(own, "tag-container")).toEqual([]);
    expect(merchant.filter((item) => item.kind === "tag-container")).toEqual([
      { kind: "tag-container", value: "google-tag-manager", detail: "GTM-WHBMQMVP" },
    ]);
  });

  const document = parseStorefront(
    `<script src="https://files.tooliify.com/widget.js"></script>
     <script src="https://cdn.portal.files.salla.network/snippets/prod/996829016/1.js" data-snippet-id="1"></script>
     <div id="walaa-panel"></div>
     <script>window.observerEvents = []; fetch("https://client-do9.pages.dev/index.js");</script>`,
    "mystore.com",
  );
  const config = {
    storeId: 1,
    paymentMethods: [],
    installments: [],
    serviceKeys: ["google_analytics", "hotjar"],
  };

  it("records each host as both a host and a registrable domain", () => {
    const evidence = collectEvidence(document, config, { selfHost: "mystore.com" });

    expect(valuesOf(evidence, "host")).toEqual(
      expect.arrayContaining(["files.tooliify.com", "client-do9.pages.dev"]),
    );
    expect(valuesOf(evidence, "domain")).toEqual(
      expect.arrayContaining(["tooliify.com", "client-do9.pages.dev"]),
    );
  });

  it("carries snippets, integrations, identifiers and element ids", () => {
    const evidence = collectEvidence(document, config, { selfHost: "mystore.com" });

    expect(valuesOf(evidence, "snippet")).toEqual(["996829016"]);
    expect(valuesOf(evidence, "service")).toEqual(["google_analytics", "hotjar"]);
    expect(valuesOf(evidence, "inline-token")).toContain("observerEvents");
    expect(valuesOf(evidence, "dom-id")).toContain("walaa-panel");
  });

  it("does not repeat the same signal", () => {
    const repeated = parseStorefront(
      `<script src="https://files.tooliify.com/a.js"></script>
       <script src="https://files.tooliify.com/b.js"></script>`,
    );

    expect(valuesOf(collectEvidence(repeated, undefined), "host")).toEqual(["files.tooliify.com"]);
  });

  it("ignores hosts belonging to the store itself", () => {
    const own = parseStorefront('<script src="https://cdn.mystore.com/a.js"></script>');

    expect(collectEvidence(own, undefined, { selfHost: "mystore.com" })).toEqual([]);
  });
});

describe("filterNoise", () => {
  const evidence: Evidence[] = [
    { kind: "host", value: "cdn.salla.network" },
    { kind: "domain", value: "salla.sa" },
    { kind: "domain", value: "googletagmanager.com" },
    { kind: "custom-element", value: "salla-button" },
    { kind: "custom-element", value: "lord-icon" },
    { kind: "inline-token", value: "baseUrl" },
    { kind: "inline-signature", value: "abc12345" },
    { kind: "domain", value: "tooliify.com" },
    { kind: "snippet", value: "996829016" },
  ];

  it("drops the platform's own background", () => {
    const { signals } = filterNoise(evidence, EMPTY_NOISE);

    expect(signals.map((item) => item.value)).toEqual([
      "googletagmanager.com",
      "lord-icon",
      "baseUrl",
      "abc12345",
      "tooliify.com",
      "996829016",
    ]);
  });

  it("drops what the knowledge base marks as noise", () => {
    const rules: NoiseRules = {
      ...EMPTY_NOISE,
      domains: ["googletagmanager.com"],
      identifiers: ["baseUrl"],
      inlineSignatures: ["abc12345"],
      customElements: ["lord-icon"],
    };

    const { signals, noise } = filterNoise(evidence, rules);

    expect(signals.map((item) => item.value)).toEqual(["tooliify.com", "996829016"]);
    expect(noise).toHaveLength(7);
  });
});
