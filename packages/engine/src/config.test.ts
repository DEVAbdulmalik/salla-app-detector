import { describe, expect, it } from "vitest";
import { extractStoreConfig, type StoreConfig } from "./config";

function pageWith(payload: unknown): string {
  return `<html><body><script>
    function dispatchSallaEvents() {
      salla.event.dispatchEvents(${JSON.stringify(payload)})
    }
  </script></body></html>`;
}

const FULL_PAYLOAD = {
  "twilight::init": {
    store: {
      id: 986119567,
      name: "مهووس للعطور",
      username: "mahwous",
      url: "https://mahwous.com/",
      settings: {
        payments: ["mada", "credit_card", "apple_pay"],
        installments: { tamara: { publicKey: "P1" }, tabby: { publicKey: "P2" }, emkan: [] },
      },
    },
    theme: { name: "1130931637", twilight: { version: "2.14.584" } },
  },
  "services::google_analytics.init": { services: { google_analytics: { tracking_id: "G-1" } } },
  "services::snapchat_pixel.init": { services: { snapchat_pixel: { pixel_id: "abc" } } },
  "page.view": { route: "store.home" },
};

function parse(html: string): StoreConfig {
  const result = extractStoreConfig(html);
  if (!result.ok) {
    throw new Error(`expected a config, got ${result.error.code}`);
  }
  return result.value;
}

describe("extractStoreConfig", () => {
  it("reads the store, theme, payments and integrations", () => {
    expect(parse(pageWith(FULL_PAYLOAD))).toEqual({
      storeId: 986119567,
      storeName: "مهووس للعطور",
      username: "mahwous",
      storeUrl: "https://mahwous.com/",
      themeName: "1130931637",
      twilightVersion: "2.14.584",
      paymentMethods: ["mada", "credit_card", "apple_pay"],
      installments: ["tabby", "tamara"],
      serviceKeys: ["google_analytics", "snapchat_pixel"],
    });
  });

  it("survives braces and quotes inside the payload", () => {
    const payload = {
      "twilight::init": {
        store: {
          id: 1,
          name: 'حلويات "الطيبين" {الفرع}',
          settings: {},
        },
      },
      "page.view": { html: '<div class="a">}</div>\\' },
    };

    expect(parse(pageWith(payload)).storeName).toBe('حلويات "الطيبين" {الفرع}');
  });

  it("accepts an empty installments map serialised as an array", () => {
    const payload = {
      "twilight::init": { store: { id: 7, settings: { installments: [] } } },
    };

    expect(parse(pageWith(payload)).installments).toEqual([]);
  });

  it("keeps the store when a peripheral field has an unexpected type", () => {
    const payload = {
      "twilight::init": { store: { id: 7, name: 42, settings: { payments: "mada" } } },
    };

    const config = parse(pageWith(payload));

    expect(config.storeId).toBe(7);
    expect(config.storeName).toBeUndefined();
    expect(config.paymentMethods).toEqual([]);
  });

  it("reports why a page could not be read", () => {
    const missing = extractStoreConfig("<html></html>");
    const truncated = extractStoreConfig('<script>salla.event.dispatchEvents({"a":1</script>');
    const broken = extractStoreConfig("<script>salla.event.dispatchEvents({oops})</script>");
    const wrongShape = extractStoreConfig(pageWith({ "twilight::init": { store: {} } }));

    expect(missing.ok ? undefined : missing.error.code).toBe("not-found");
    expect(truncated.ok ? undefined : truncated.error.code).toBe("unterminated");
    expect(broken.ok ? undefined : broken.error.code).toBe("invalid-json");
    expect(wrongShape.ok ? undefined : wrongShape.error).toMatchObject({
      code: "schema-mismatch",
    });
  });
});
