import { describe, expect, it } from "vitest";
import { normalizeTarget } from "./target";

function target(input: string) {
  const result = normalizeTarget(input);
  if (!result.ok) {
    throw new Error(`expected a target, got ${result.error.code}`);
  }
  return result.value;
}

function error(input: string) {
  const result = normalizeTarget(input);
  if (result.ok) {
    throw new Error(`expected an error, got ${result.value.url}`);
  }
  return result.error;
}

describe("normalizeTarget", () => {
  it("accepts a bare domain", () => {
    expect(target("mahwous.com")).toEqual({
      url: "https://mahwous.com/",
      host: "mahwous.com",
      kind: "custom-domain",
    });
  });

  it("reduces any page of a store to its root", () => {
    expect(target("https://psupps.net/ar/efx-eaa-peach-flavor/p564919465?ref=x#top").url).toBe(
      "https://psupps.net/",
    );
  });

  it("keeps the handle for stores served from a salla.sa path", () => {
    expect(target("https://salla.sa/coffee_souq/category/abc")).toEqual({
      url: "https://salla.sa/coffee_souq",
      host: "salla.sa",
      kind: "salla-slug",
      slug: "coffee_souq",
    });
  });

  it("looks past a locale prefix", () => {
    expect(target("salla.sa/ar/coffee_souq").slug).toBe("coffee_souq");
    expect(target("https://demostore.salla.sa/ar/dev-4zkkfmy7wdwt32sg").slug).toBe(
      "dev-4zkkfmy7wdwt32sg",
    );
  });

  it("drops www and upper case from the host", () => {
    expect(target("HTTPS://WWW.Salla.sa/Coffee_Souq").url).toBe("https://salla.sa/coffee_souq");
  });

  it("rejects input that is not a store", () => {
    expect(error("").code).toBe("empty");
    expect(error("   ").code).toBe("empty");
    expect(error("ftp://mahwous.com").code).toBe("unsupported-scheme");
    expect(error("localhost:3000").code).toBe("not-a-domain");
    expect(error("http://127.0.0.1/store").code).toBe("not-a-domain");
    expect(error("https://apps.salla.sa/ar/app/691365818").code).toBe("platform-page");
    expect(error("https://salla.sa/").code).toBe("missing-slug");
    expect(error("https://salla.sa/pricing").code).toBe("platform-page");
  });
});
