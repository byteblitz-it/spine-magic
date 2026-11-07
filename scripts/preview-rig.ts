// Renders a sample character (4.2 build) at a few animation times next to its reference composite, for rig tuning.
// Usage: npx tsx scripts/preview-rig.ts <knight|wizard> [animation] [frames]  → out/rig-<name>.png
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "spine-core-42";
import { createImage, decodePng, encodePng, type Image } from "../src/core/index.js";
import { drawSkeleton, newFrame, toImage } from "./lib/raster.js";

const [name = "knight", animName, framesArg] = process.argv.slice(2);
const dir = join("samples", "characters", `${name}-4.2`);
const atlasText = readFileSync(join(dir, `${name}.atlas`), "utf8");
const atlas = new core.TextureAtlas(atlasText);
const pages = new Map<string, Image>();
for (const page of atlas.pages) {
  const img = decodePng(new Uint8Array(readFileSync(join(dir, page.name))));
  pages.set(page.name, img);
  page.setTexture({ getImage: () => ({ width: img.width, height: img.height }), setFilters() {}, setWraps() {}, dispose() {} } as any);
}
const data = new core.SkeletonJson(new core.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")));
const skeleton = new core.Skeleton(data);
const anim = animName ? data.findAnimation(animName) : null;
const n = anim ? Number(framesArg ?? 4) : 1;
const CELL = 400;

// reference composite (whole-character art), scaled to the rig's size
const ref = decodePng(new Uint8Array(readFileSync(join("art", "sample-characters.png"))));
const refBox = name === "knight" ? [36, 54, 728, 840] : [968, 46, 1742, 842];

const f = newFrame((n + 1) * (CELL + 2) + 2, CELL + 4, [60, 64, 74]);
for (let i = 0; i < n; i++) {
  skeleton.setToSetupPose();
  if (anim) anim.apply(skeleton, 0, (anim.duration * i) / n, true, [], 1, core.MixBlend.setup, core.MixDirection.in);
  skeleton.updateWorldTransform(core.Physics.pose);
  drawSkeleton(core, skeleton, pages, f, { ox: 2 + i * (CELL + 2), oy: 2, cw: CELL, ch: CELL }, { x: 0, y: 190, scale: 0.9 });
  // bone dots
  for (const b of skeleton.bones) {
    const x = Math.round(2 + i * (CELL + 2) + CELL / 2 + b.worldX * 0.9), y = Math.round(2 + CELL / 2 - (b.worldY - 190) * 0.9);
    for (let d = -1; d <= 1; d++) for (const [xx, yy] of [[x + d, y], [x, y + d]]) if (xx > 0 && yy > 0 && xx < f.W && yy < f.H) f.buf.set(b.data.color.g > 0.7 && b.data.color.b < 0.1 ? [1, 0.8, 0] : [0, 1, 0.4], (yy * f.W + xx) * 3);
  }
}
// reference in the last cell
const k = Math.min(CELL / (refBox[2] - refBox[0]), CELL / (refBox[3] - refBox[1])) * 0.98;
const ox = 2 + n * (CELL + 2);
for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
  const sx = Math.floor(refBox[0] + x / k), sy = Math.floor(refBox[1] + y / k);
  if (sx >= refBox[2] || sy >= refBox[3]) continue;
  const i = (sy * ref.width + sx) * 4, a = ref.data[i + 3] / 255, o = ((2 + y) * f.W + ox + x) * 3;
  for (let c = 0; c < 3; c++) f.buf[o + c] = (ref.data[i + c] / 255) * a + f.buf[o + c] * (1 - a);
}
mkdirSync("out", { recursive: true });
writeFileSync(join("out", `rig-${name}.png`), encodePng(toImage(f, createImage)));
console.log(`out/rig-${name}.png`);
