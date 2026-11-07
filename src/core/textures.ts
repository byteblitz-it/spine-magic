import { createImage, type Image } from "./png.js";
import { noise2 } from "./math.js";

export interface Texture {
  /** Region / attachment name in the atlas. */
  name: string;
  image: Image;
}

/** Maps an emitter's `texture` ref to pixels. Node resolves file paths; the browser resolves uploads. */
export type TextureResolver = (ref: string) => Texture;

type Shader = (u: number, v: number) => number; // u,v in [-1,1] → alpha 0..1

const BUILTIN: Record<string, { w: number; h: number; desc: string; shade: Shader }> = {
  "soft-circle": { w: 64, h: 64, desc: "soft glowing dot — sparks, glow, magic", shade: (u, v) => Math.pow(Math.max(0, 1 - Math.hypot(u, v)), 2) },
  "hard-circle": { w: 64, h: 64, desc: "solid disc with anti-aliased edge — bubbles, confetti dots", shade: (u, v) => clamp01((1 - Math.hypot(u, v)) * 16) },
  ring: { w: 64, h: 64, desc: "thin ring — shockwaves, ripples", shade: (u, v) => Math.max(0, 1 - Math.abs(Math.hypot(u, v) - 0.8) * 8) },
  spark: { w: 64, h: 16, desc: "horizontal streak — use with alignToVelocity", shade: (u, v) => Math.pow(Math.max(0, 1 - Math.abs(u)), 1.5) * Math.max(0, 1 - Math.abs(v)) },
  star: {
    w: 64, h: 64, desc: "4-point twinkle star",
    shade: (u, v) => clamp01(Math.max(0, 1 - Math.abs(u) * 12) * (1 - Math.abs(v)) + Math.max(0, 1 - Math.abs(v) * 12) * (1 - Math.abs(u)) + Math.pow(Math.max(0, 1 - Math.hypot(u, v) * 2.5), 2)),
  },
  smoke: {
    w: 64, h: 64, desc: "noisy soft puff — smoke, dust, clouds",
    shade: (u, v) => clamp01(Math.pow(Math.max(0, 1 - Math.hypot(u, v)), 1.5) * (0.65 + 0.35 * noise2(u * 3 + 5, v * 3 + 5, 7)) * 1.3),
  },
  square: { w: 32, h: 32, desc: "solid square — pixel / confetti", shade: () => 1 },
  "blurred-circle": { w: 64, h: 64, desc: "very soft gaussian blob — haze, bokeh, light", shade: (u, v) => Math.exp(-(u * u + v * v) * 4.5) * clamp01((1 - Math.hypot(u, v)) * 6) },
  hexagon: {
    w: 64, h: 64, desc: "hexagon — tech, shields, bokeh",
    shade: (u, v) => {
      const n = 6, seg = (2 * Math.PI) / n;
      const a = (((Math.atan2(v, u) + Math.PI / 2) % seg) + seg) % seg - seg / 2;
      const edge = Math.cos(Math.PI / n) / Math.cos(a);
      return clamp01((edge * 0.95 - Math.hypot(u, v)) * 24);
    },
  },
  dash: { w: 64, h: 8, desc: "thin rounded bar — rain, speed lines (alignToVelocity)", shade: (u, v) => clamp01((1 - Math.hypot(Math.max(0, Math.abs(u) - 0.85) / 0.15, v)) * 4) },
  confetti: { w: 32, h: 16, desc: "2:1 paper strip — confetti with spin", shade: (u, v) => 0.85 + 0.15 * (1 - Math.abs(v)) },
};

export function listBuiltinTextures(): { name: string; width: number; height: number; description: string }[] {
  return Object.entries(BUILTIN).map(([name, t]) => ({ name, width: t.w, height: t.h, description: t.desc }));
}

export const isBuiltinTexture = (ref: string) => ref in BUILTIN;

const cache = new Map<string, Texture>();

export function builtinTexture(ref: string): Texture {
  const hit = cache.get(ref);
  if (hit) return hit;
  const b = BUILTIN[ref];
  if (!b) throw new Error(`texture "${ref}" is not a builtin (${Object.keys(BUILTIN).join(", ")})`);
  const image = createImage(b.w, b.h);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const a = b.shade(((x + 0.5) / b.w) * 2 - 1, ((y + 0.5) / b.h) * 2 - 1);
      image.data.set([255, 255, 255, Math.round(clamp01(a) * 255)], (y * b.w + x) * 4);
    }
  const tex = { name: ref, image };
  cache.set(ref, tex);
  return tex;
}

/** Turns a file path or upload name into a valid atlas region name. */
export function textureNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.[^.]+$/, "").replace(/[^\w-]/g, "_") || "texture";
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
