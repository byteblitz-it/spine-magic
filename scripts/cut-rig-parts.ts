// Cuts the layered rig parts out of art/rig-parts-sheet.png (white background) into art/parts/<character>/<part>.png.
// The background is keyed by flood fill from the sheet border, so white highlights inside a part (the blade) stay.
// Usage: npx tsx scripts/cut-rig-parts.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createImage, decodePng, encodePng } from "../src/core/index.js";

/** part → source box [x0, y0, x1, y1] (inclusive), from the sheet layout */
export const PARTS: Record<string, Record<string, [number, number, number, number]>> = {
  knight: {
    head: [50, 100, 193, 232], torso: [227, 122, 358, 266], tasset: [234, 272, 357, 340], crotch: [62, 286, 180, 354],
    upper_arm_r: [409, 121, 498, 207], upper_arm_l: [559, 127, 640, 206],
    lower_arm_r: [436, 214, 527, 313], hand_r: [532, 224, 613, 311], hand_l: [610, 207, 687, 314],
    leg_r: [270, 373, 361, 552], leg_l: [377, 377, 455, 552], boot_r: [478, 377, 584, 550], boot_l: [603, 420, 685, 549],
    cape: [32, 405, 229, 582], sword: [198, 594, 520, 678],
  },
  wizard: {
    head: [743, 105, 890, 225], coat: [890, 120, 1030, 255], coat_skirt: [868, 270, 1029, 404], robe: [1031, 129, 1223, 362],
    hat: [1196, 82, 1419, 206], sleeve_r: [1247, 232, 1293, 299], sleeve_l: [1337, 235, 1380, 301],
    hand_r: [1253, 312, 1324, 423], hand_l: [1345, 313, 1402, 424], skirt: [768, 439, 1000, 562],
    boot_r: [1029, 434, 1094, 567], boot_l: [1125, 437, 1201, 567], pouch: [1254, 472, 1340, 526], staff: [1014, 572, 1400, 672],
  },
};

const src = decodePng(new Uint8Array(readFileSync(join("art", "rig-parts-sheet.png"))));
const { width: W, height: H, data } = src;
const white = (i: number) => data[i * 4] > 225 && data[i * 4 + 1] > 225 && data[i * 4 + 2] > 225;

// background = near-white connected to the border
const bg = new Uint8Array(W * H);
const stack: number[] = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const i = stack.pop()!;
  if (bg[i] || !white(i)) continue;
  bg[i] = 1;
  const x = i % W, y = (i / W) | 0;
  if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1); if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W);
}

/**
 * Pixels kept for a part: its largest connected shape inside the box (drops the sheet's arrows, label text and
 * slivers of neighbouring parts), plus small saturated pieces when `wisps` (the staff's detached flame wisps).
 */
function keepMask(x0: number, y0: number, x1: number, y1: number, wisps: boolean): Uint8Array {
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const lab = new Int32Array(bw * bh).fill(-1);
  const comps: { n: number; sat: number }[] = [];
  for (let s = 0; s < bw * bh; s++) {
    const gi = (y0 + Math.floor(s / bw)) * W + x0 + (s % bw);
    if (bg[gi] || lab[s] >= 0) continue;
    const id = comps.length, st = [s];
    let n = 0, sat = 0;
    lab[s] = id;
    while (st.length) {
      const k = st.pop()!, x = k % bw, y = (k / bw) | 0;
      const g = (y0 + y) * W + x0 + x;
      n++; sat += Math.max(data[g * 4], data[g * 4 + 1], data[g * 4 + 2]) - Math.min(data[g * 4], data[g * 4 + 1], data[g * 4 + 2]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
        const j = yy * bw + xx;
        if (lab[j] < 0 && !bg[(y0 + yy) * W + x0 + xx]) { lab[j] = id; st.push(j); }
      }
    }
    comps.push({ n, sat: sat / n });
  }
  const main = comps.reduce((best, c, i) => (c.n > comps[best].n ? i : best), 0);
  const keep = new Uint8Array(bw * bh);
  for (let k = 0; k < keep.length; k++) {
    const c = lab[k];
    if (c === main || (wisps && c >= 0 && comps[c].sat > 60 && comps[c].n > 6)) keep[k] = 1;
  }
  return keep;
}

const PAD = 2;
for (const [character, parts] of Object.entries(PARTS)) {
  const dir = join("art", "parts", character);
  mkdirSync(dir, { recursive: true });
  for (const [name, [x0, y0, x1, y1]] of Object.entries(parts)) {
    const w = x1 - x0 + 1 + PAD * 2, h = y1 - y0 + 1 + PAD * 2;
    const out = createImage(w, h);
    const keep = keepMask(x0, y0, x1, y1, name === "staff");
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = x0 - PAD + x, sy = y0 - PAD + y;
      if (sx < x0 || sy < y0 || sx > x1 || sy > y1) continue;
      if (!keep[(sy - y0) * (x1 - x0 + 1) + (sx - x0)]) continue;
      const i = sy * W + sx;
      if (bg[i]) continue;
      let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = 255;
      // feather the outer edge: a pixel touching the background is part-blended with white in the JPEG
      const edge = [i - 1, i + 1, i - W, i + W].some((j) => j >= 0 && j < W * H && bg[j]);
      if (edge) {
        const lum = (r + g + b) / 3;
        a = Math.round(Math.max(0, Math.min(1, (255 - lum) / 120)) * 255);
        r = g = b = 24; // the outline colour
      }
      out.data.set([r, g, b, a], (y * w + x) * 4);
    }
    writeFileSync(join(dir, `${name}.png`), encodePng(out));
  }
  console.log(`${dir}: ${Object.keys(parts).length} parts`);
}
