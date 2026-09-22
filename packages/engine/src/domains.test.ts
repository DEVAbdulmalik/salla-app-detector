import { describe, expect, it } from "vitest";
import { describeHost, hostOf } from "./domains";

describe("describeHost", () => {
  it("reduces a vendor host to its registrable domain", () => {
    expect(describeHost("files.tooliify.com")).toEqual({
      host: "files.tooliify.com",
      domain: "tooliify.com",
      isSharedHosting: false,
    });
  });

  it("keeps tenants on a shared platform apart", () => {
    expect(describeHost("client-do9.pages.dev")).toEqual({
      host: "client-do9.pages.dev",
      domain: "client-do9.pages.dev",
      isSharedHosting: true,
    });
    expect(describeHost("lenkwhats.pages.dev")?.domain).toBe("lenkwhats.pages.dev");
  });

  it("handles multi-level country domains", () => {
    expect(describeHost("shop.ethkher.com.sa")?.domain).toBe("ethkher.com.sa");
  });

  it("accepts a URL as well as a host", () => {
    expect(describeHost("https://cartat.ams3.digitaloceanspaces.com/cdn/app.js")?.host).toBe(
      "cartat.ams3.digitaloceanspaces.com",
    );
  });

  it("returns nothing for input that is not a host", () => {
    expect(describeHost("")).toBeUndefined();
    expect(describeHost("localhost")).toBeUndefined();
    expect(describeHost("not a url")).toBeUndefined();
  });
});

describe("hostOf", () => {
  it("extracts the host from a URL", () => {
    expect(hostOf("https://Mahwous.com/ar/p1")).toBe("mahwous.com");
    expect(hostOf("//cdn.salla.network/app.js")).toBe("cdn.salla.network");
  });
});
