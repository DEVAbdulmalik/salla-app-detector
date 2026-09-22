/**
 * FNV-1a, 32-bit. Used to group inline scripts that share a structure, so the same vendor
 * snippet is recognised across stores even though each store interpolates its own values.
 * It only needs to be stable and fast; it is never used for anything security related.
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
