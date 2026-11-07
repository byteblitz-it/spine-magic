// Fits each part of a rig to the reference composite: for every part, searches position, scale and rotation around
// the current layout for the best colour match against the reference (mapped into rig world space), coarse → fine.
// Writes art/parts/<name>/layout.json, which make-sample-characters.ts applies over its hand-made layout.
// Usage: npx tsx scripts/fit-rig.ts <knight|wizard> [part …]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, type Image } from "../src/core/index.js";
import { BASE_DEFS as DEFS, type PartDef } from "./sample-character-defs.js";

const [name = "wizard", ...only] = process.argv.slice(2);
const def = DEFS.find((d) => d.name === name)!;
const REF = { knight: { feet: [470, 835], s: 0.45 }, wizard: { feet: [1300, 835], s: 0.45 } } as Record<string, { feet: number[]; s: number }>;
const { feet, s } = REF[name];
const HIDDEN: Record<string, string[]> = {
  knight: ["upper_arm_l", "forearm_l", "leg_l", "boot_l", "leg_r", "boot_r", "cape"],
  wizard: [],
};
const ref = decodePng(new Uint8Array(readFileSync(join("art", "sample-characters.png"))));

/** reference colour at a world point (premultiplied over transparent = 0 alpha) */
function refAt(wx: number, wy: number): [number, number, number, number] {
  const px = Math.round(wx / s + feet[0]), py = Math.round(feet[1] - wy / s);
  if (px < 0 || py < 0 || px >= ref.width || py >= ref.height) return [0, 0, 0, 0];
  const i = (py * ref.width + px) * 4;
  return [ref.data[i], ref.data[i + 1], ref.data[i + 2], ref.data[i + 3]];
}

/** mean colour distance between the placed part and the reference over the part's opaque pixels (sampled) */
function score(img: Image, p: { x: number; y: number; rotation: number; scale: number; flipX?: boolean }, step: number): number {
  const c = Math.cos((p.rotation * Math.PI) / 180), sn = Math.sin((p.rotation * Math.PI) / 180);
  let sum = 0, n = 0;
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) {
    const i = (y * img.width + x) * 4;
    if (img.data[i + 3] < 200) continue;
    // part pixel → world (image y down, world y up); flipX mirrors the image
    let lx = (x - img.width / 2) * p.scale, ly = (img.height / 2 - y) * p.scale;
    if (p.flipX) lx = -lx;
    const wx = p.x + lx * c - ly * sn, wy = p.y + lx * sn + ly * c;
    const r = refAt(wx, wy);
    const d = r[3] < 128 ? 120 : Math.abs(r[0] - img.data[i]) + Math.abs(r[1] - img.data[i + 1]) + Math.abs(r[2] - img.data[i + 2]);
    sum += Math.min(d, 240); n++;
  }
  return n ? sum / n : Infinity;
}

const out: Record<string, { x: number; y: number; rotation: number; scale: number }> = {};
const layoutPath = join("art", "parts", name, "layout.json");
const prev = existsSync(layoutPath) ? JSON.parse(readFileSync(layoutPath, "utf8")) : {};
for (const part of def.parts as PartDef[]) {
  if (part.follows) continue; // takes its leader's placement
  if (only.length && !only.includes(part.part)) { if (prev[part.part]) out[part.part] = prev[part.part]; continue; }
  const img = decodePng(new Uint8Array(readFileSync(join("art", "parts", name, `${part.part}.png`))));
  let best = { x: part.x, y: part.y, rotation: part.rotation ?? 0, scale: part.scale ?? 1, flipX: part.flipX };
  let bestScore = score(img, best, 3);
  const before = bestScore;
  // coarse → fine: position radius, step; rotation span, step; scale span, step
  // limbs and props may turn; body pieces only settle (a dark coat matches dark pixels at any tilt)
  const limb = /sleeve|staff|glove|arm|sword|hand|fist|forearm/.test(part.part);
  const R = limb ? 30 : 5;
  // parts mostly hidden in the reference (far arm, legs behind the sword, cape) only settle near the hand layout
  const hidden = HIDDEN[name]?.includes(part.part);
  const P = hidden ? 12 : 40, SR = hidden ? 0.15 : 0.3, RR = hidden ? 5 : R;
  for (const [pr, ps, rr, rs, sr, ss] of [[P, 4, RR, limb && !hidden ? 6 : 2.5, SR, 0.05], [8, 1, Math.min(RR, 6), limb ? 2 : 1, 0.06, 0.02], [2, 0.5, 2, 1, 0.02, 0.01]] as const) {
    const c = { ...best };
    for (let sc = c.scale - sr; sc <= c.scale + sr + 1e-9; sc += ss)
      for (let rot = Math.max(c.rotation - rr, (part.rotation ?? 0) - RR); rot <= Math.min(c.rotation + rr, (part.rotation ?? 0) + RR) + 1e-9; rot += rs)
        for (let dx = -pr; dx <= pr; dx += ps) for (let dy = -pr; dy <= pr; dy += ps) {
          const cand = { x: c.x + dx, y: c.y + dy, rotation: rot, scale: sc, flipX: c.flipX };
          const v = score(img, cand, ps >= 4 ? 3 : 2);
          if (v < bestScore) { bestScore = v; best = cand; }
        }
  }
  out[part.part] = { x: round(best.x), y: round(best.y), rotation: round(best.rotation), scale: round(best.scale, 100) };
  console.log(`${part.part.padEnd(16)} ${before.toFixed(0)} → ${bestScore.toFixed(0)}  `, out[part.part]);
}
writeFileSync(layoutPath, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${layoutPath}`);

function round(v: number, k = 10) { return Math.round(v * k) / k; }
