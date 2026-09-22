import { describe, expect, it } from "vitest";
import { integrationLabel, paymentLabel } from "./labels";
import { getMessages } from "./messages";

const messages = getMessages();

describe("integrationLabel", () => {
  it("prefers the app name the detector resolved", () => {
    expect(integrationLabel({ key: "hotjar", appId: "1", name: "Hotjar" }, messages)).toBe(
      "Hotjar",
    );
  });

  it("falls back to a known name for an unmapped key", () => {
    expect(integrationLabel({ key: "tiktok_pixel" }, messages)).toBe("TikTok Pixel");
    expect(integrationLabel({ key: "addon-whatsapp-chat" }, messages)).toBe("محادثة واتساب");
  });

  it("tidies a key it has never seen", () => {
    expect(integrationLabel({ key: "addon-brand_new-tool" }, messages)).toBe("Brand New Tool");
  });
});

describe("paymentLabel", () => {
  it("names the methods shoppers recognise", () => {
    expect(paymentLabel("mada", messages)).toBe("مدى");
    expect(paymentLabel("apple_pay", messages)).toBe("Apple Pay");
    expect(paymentLabel("tabby_installment", messages)).toBe("تابي");
  });

  it("tidies an unfamiliar method", () => {
    expect(paymentLabel("new_wallet", messages)).toBe("New Wallet");
  });
});
