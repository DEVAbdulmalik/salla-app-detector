/**
 * Address ranges that must never be reachable from a user-supplied URL: loopback, private
 * networks, link-local (which includes cloud metadata services), and the various reserved
 * blocks. Without this, anyone could point the scanner at infrastructure behind it.
 */

const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isBlockedAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (normalized === "") {
    return true;
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (mapped?.[1] !== undefined) {
    return isBlockedV4(mapped[1]);
  }
  return normalized.includes(":") ? isBlockedV6(normalized) : isBlockedV4(normalized);
}

function isBlockedV4(address: string): boolean {
  const value = toV4Number(address);
  if (value === undefined) {
    return true;
  }
  if (value === 0xff_ff_ff_ff) {
    return true;
  }
  return BLOCKED_V4.some(([network, bits]) => {
    const base = toV4Number(network);
    if (base === undefined) {
      return false;
    }
    const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
}

function isBlockedV6(address: string): boolean {
  const value = address.replace(/^\[|]$/g, "").split("%")[0] ?? "";
  if (value === "::" || value === "::1") {
    return true;
  }
  const head = value.slice(0, 4).toLowerCase();
  // fc00::/7 unique local, fe80::/10 link local, 2001:db8::/32 documentation.
  return (
    head.startsWith("fc") ||
    head.startsWith("fd") ||
    head.startsWith("fe8") ||
    head.startsWith("fe9") ||
    head.startsWith("fea") ||
    head.startsWith("feb") ||
    value.startsWith("2001:db8")
  );
}

function toV4Number(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return undefined;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return undefined;
    }
    const octet = Number(part);
    if (octet > 255) {
      return undefined;
    }
    value = (value << 8) | octet;
  }
  return value >>> 0;
}
