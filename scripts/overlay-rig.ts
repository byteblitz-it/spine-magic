// Aligns a rig with its reference art: renders the rig (setup pose), the reference mapped into the rig's world
// coordinates, and a 50/50 overlay, side by side, at 2× so parts can be matched pixel by pixel.
// Usage: npx tsx scripts/overlay-rig.ts <knight|wizard>  → out/overlay-<name>.png
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "spine-core-42";
import { createImage, decodePng, encodePng, type Image } from "../src/core/index.js";
import { drawSkeleton, newFrame, toImage } from "./lib/raster.js";

const name = process.argv[2] ?? "wizard";
/** reference art → rig world: x = (px - feetX)·s, y = (feetY - py)·s */
export const REF: Record<string, { feet: [number, number]; s: number }> = {
  knight: { feet: [470, 835], s: 0.45 },
  wizard: { feet: [1300, 835], s: 0.45 },
};
const { feet, s } = REF[name];

const dir = join("samples", "characters", `${name}-4.2`);
const atlas = new core.TextureAtlas(readFileSync(join(dir, `${name}.atlas`), "utf8"));
const pages = new Map<string, Image>();
for (const page of atlas.pages) {
  const img = decodePng(new Uint8Array(readFileSync(join(dir, page.name))));
  pages.set(page.name, img);
  page.setTexture({ getImage: () => ({ width: img.width, height: img.height }), setFilters() {}, setWraps() {}, dispose() {} } as any);
}
const data = new core.SkeletonJson(new core.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")));
const skeleton = new core.Skeleton(data);
skeleton.setToSetupPose();
skeleton.updateWorldTransform(core.Physics.pose);

const ZOOM = 2, CW = 220 * ZOOM * 2, CH = 200 * ZOOM * 2; // 440×400 world units around the character
const view = { x: 10, y: 180, scale: ZOOM };
const bg = [60, 64, 74];
const f = newFrame(CW * 3 + 8, CH + 4, bg);
const cell = (i: number) => ({ ox: 2 + i * (CW + 2), oy: 2, cw: CW, ch: CH });

// 0: rig
drawSkeleton(core, skeleton, pages, f, cell(0), view);
// 1: reference in the same world frame; 2: overlay
const ref = decodePng(new Uint8Array(readFileSync(join("art", "sample-characters.png"))));
const rigCopy = new Float32Array(f.buf);
for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
  const wx = view.x + (x - CW / 2) / view.scale, wy = view.y - (y - CH / 2) / view.scale;
  const px = Math.round(wx / s + feet[0]), py = Math.round(feet[1] - wy / s);
  const o1 = ((2 + y) * f.W + cell(1).ox + x) * 3, o2 = ((2 + y) * f.W + cell(2).ox + x) * 3, o0 = ((2 + y) * f.W + cell(0).ox + x) * 3;
  let r = bg.map((c) => c / 255);
  if (px >= 0 && py >= 0 && px < ref.width && py < ref.height) {
    const i = (py * ref.width + px) * 4, a = ref.data[i + 3] / 255;
    r = [0, 1, 2].map((c) => (ref.data[i + c] / 255) * a + r[c] * (1 - a));
  }
  for (let c = 0; c < 3; c++) { f.buf[o1 + c] = r[c]; f.buf[o2 + c] = 0.5 * r[c] + 0.5 * rigCopy[o0 + c]; }
}
// bone markers on the rig cell
for (const b of skeleton.bones) {
  const x = Math.round(cell(0).ox + CW / 2 + (b.worldX - view.x) * view.scale), y = Math.round(2 + CH / 2 - (b.worldY - view.y) * view.scale);
  for (let d = -3; d <= 3; d++) for (const [xx, yy] of [[x + d, y], [x, y + d]]) if (xx > 0 && yy > 0 && xx < f.W && yy < f.H) f.buf.set([0.2, 1, 0.4], (yy * f.W + xx) * 3);
}
mkdirSync("out", { recursive: true });
writeFileSync(join("out", `overlay-${name}.png`), encodePng(toImage(f, createImage)));
console.log(`out/overlay-${name}.png`);
