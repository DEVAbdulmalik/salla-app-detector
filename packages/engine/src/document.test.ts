import { describe, expect, it } from "vitest";
import { parseStorefront } from "./document";

const PAGE = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="https://cartat.ams3.digitaloceanspaces.com/cdn/floating-wpp.min.css?v=1">
    <link rel="preconnect" href="https://fonts.gstatic.com">
    <script src="https://cdn.salla.network/js/twilight/2.14.584/twilight.esm.js"></script>
    <script async src="https://cdn.portal.files.salla.network/snippets/prod/996829016/882806676.js"
            data-snippet-id="13324" data-scope-id="a1425cea"></script>
    <script async src="https://salla-dev-portal.s3.eu-central-1.amazonaws.com/snippets/prod/338190499/943756599.js"
            data-snippet-id="13609" data-scope-id="50e64782"></script>
    <script type="application/ld+json">{"@type":"Organization","url":"https://ignored.example"}</script>
  </head>
  <body>
    <img src="https://cdn.salla.sa/QNvEG/hHqz9DaHEBiQ.png">
    <div id="walaa-panel"></div>
    <salla-custom-component component-name="faq" bundle-id="733528208"></salla-custom-component>
    <lord-icon src="https://cdn.lordicon.com/zpehigrn.json"></lord-icon>
    <script>
      // === App Settings ===
      var PHONE_RAW = "966510481001";
      window.cartat_source = "salla";
      const whatsappln_icon_width = "50px";
      fetch("https://cartat.net/api/v2/store/channels/widget?source_id=1544432534");
    </script>
    <script>(function(w,d,s,l,i){})(window,document,'script','dataLayer','GTM-TGFC6FV');</script>
    <script src="/local/theme.js"></script>
  </body>
</html>`;

describe("parseStorefront", () => {
  const document = parseStorefront(PAGE, "mystore.com");

  it("finds app snippets on every host Salla serves them from", () => {
    expect(document.snippets).toEqual([
      {
        appId: "996829016",
        fileId: "882806676",
        snippetId: "13324",
        scopeId: "a1425cea",
        src: "https://cdn.portal.files.salla.network/snippets/prod/996829016/882806676.js",
      },
      {
        appId: "338190499",
        fileId: "943756599",
        snippetId: "13609",
        scopeId: "50e64782",
        src: "https://salla-dev-portal.s3.eu-central-1.amazonaws.com/snippets/prod/338190499/943756599.js",
      },
    ]);
  });

  it("collects external resources with their host and drops relative ones", () => {
    const hosts = document.resources.map((resource) => resource.host);

    expect(hosts).toContain("cartat.ams3.digitaloceanspaces.com");
    expect(hosts).toContain("fonts.gstatic.com");
    expect(hosts).toContain("cdn.salla.sa");
    expect(hosts.some((host) => host.includes("/local/"))).toBe(false);
  });

  it("describes inline scripts by their hosts, identifiers and comments", () => {
    const script = document.inlineScripts[0];

    expect(script?.hosts).toEqual(["cartat.net"]);
    expect(script?.identifiers).toEqual(
      expect.arrayContaining(["cartat_source", "PHONE_RAW", "whatsappln_icon_width"]),
    );
    expect(script?.markers).toContain("=== app settings ===");
    expect(script?.signature).toMatch(/^[0-9a-f]{8}$/);
  });

  it("gives the same signature to the same code with different values", () => {
    const first = parseStorefront('<script>var id = "aaa"; track(11);</script>').inlineScripts[0];
    const second = parseStorefront('<script>var id = "zzz"; track(99);</script>').inlineScripts[0];

    expect(first?.signature).toBe(second?.signature);
  });

  it("ignores data-only script tags", () => {
    expect(document.inlineScripts.some((script) => script.hosts.includes("ignored.example"))).toBe(
      false,
    );
  });

  it("picks up components, element ids, custom tags, containers and the store code", () => {
    expect(document.customComponents).toEqual([{ name: "faq", bundleId: "733528208" }]);
    expect(document.elementIds).toContain("walaa-panel");
    expect(document.customElements).toContain("lord-icon");
    expect(document.gtmContainers).toEqual(["GTM-TGFC6FV"]);
    expect(document.storeAssetCode).toBe("QNvEG");
  });

  it("skips resources served by the store itself", () => {
    const own = parseStorefront(
      '<script src="https://mystore.com/app.js"></script>',
      "mystore.com",
    );

    expect(own.resources).toEqual([]);
  });
});
