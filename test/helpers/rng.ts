import type { RandomFn } from "../../src/types.ts";

/**
 * Seeded mulberry32 PRNG. Returns a `() => number in [0, 1)` so it slots
 * into anywhere the production code expects `Math.random`.
 *
 * Reference: https://stackoverflow.com/a/47593316 (public domain).
 * We use mulberry32 (not Math.random) so test assertions on exact picked
 * members remain stable across Node versions and platforms.
 */
export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
