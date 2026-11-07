import type { Curve, Gradient, Range } from "./schema.js";

/** mulberry32 — small, fast, deterministic. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function sample(r: Range, rand: () => number): number {
  return typeof r === "number" ? r : r[0] + (r[1] - r[0]) * rand();
}

export function rangeMax(r: Range): number {
  return typeof r === "number" ? r : Math.max(r[0], r[1]);
}

export function evalCurve(c: Curve, t: number): number {
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [t1, v1] = c[i];
    if (t <= t1) {
      const [t0, v0] = c[i - 1];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return c[c.length - 1][1];
}

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export function evalGradient(g: Gradient, t: number): RGB {
  const stops = g.map(([s, c]) => [s, hexToRgb(c)] as const);
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    if (t <= t1) {
      const [t0, c0] = stops[i - 1];
      const k = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

/** Smooth deterministic 2D value noise in [-1, 1]. */
export function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const g = (i: number, j: number) => (hash(seed, i, j) / 4294967295) * 2 - 1;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf);
  const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export const DEG = Math.PI / 180;
