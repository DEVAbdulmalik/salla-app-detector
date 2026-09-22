import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "./addresses";

describe("isBlockedAddress", () => {
  it("allows ordinary public addresses", () => {
    for (const address of ["8.8.8.8", "104.18.32.7", "2606:4700::6810:85e5"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("blocks loopback, private and link-local ranges", () => {
    const blocked = [
      "127.0.0.1",
      "127.13.9.1",
      "10.0.0.5",
      "172.16.4.9",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "255.255.255.255",
      "224.0.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.1.2.3",
    ];

    for (const address of blocked) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses just outside a blocked range", () => {
    expect(isBlockedAddress("172.32.0.1")).toBe(false);
    expect(isBlockedAddress("11.0.0.1")).toBe(false);
    expect(isBlockedAddress("192.167.255.255")).toBe(false);
  });

  it("blocks anything it cannot make sense of", () => {
    for (const address of ["", "   ", "not-an-address", "999.1.1.1", "1.2.3"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });
});
