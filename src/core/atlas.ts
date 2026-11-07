import { createImage, type Image } from "./png.js";
import type { Texture } from "./textures.js";

export interface AtlasRegion { name: string; x: number; y: number; width: number; height: number }

export interface AtlasResult {
  pageName: string;
  page: Image;
  regions: AtlasRegion[];
  /** Legacy (3.x) text format — read by both 3.8 and 4.x runtimes. */
  text: string;
}

const PAD = 2;

/** Packs textures in shelves on a single power-of-two page. */
export function buildAtlas(name: string, textures: Texture[]): AtlasResult {
  const sorted = [...textures].sort((a, b) => b.image.height - a.image.height);
  const total = sorted.reduce((s, t) => s + (t.image.width + PAD) * (t.image.height + PAD), 0);
  let width = pow2(Math.max(64, Math.ceil(Math.sqrt(total)), ...sorted.map((t) => t.image.width + PAD * 2)));

  let regions: AtlasRegion[] = [];
  let height = 0;
  for (;;) {
    regions = [];
    let x = PAD, y = PAD, shelf = 0;
    for (const t of sorted) {
      if (x + t.image.width + PAD > width) { x = PAD; y += shelf + PAD; shelf = 0; }
      regions.push({ name: t.name, x, y, width: t.image.width, height: t.image.height });
      x += t.image.width + PAD;
      shelf = Math.max(shelf, t.image.height);
    }
    height = pow2(y + shelf + PAD);
    if (height <= width * 2) break;
    width *= 2;
  }

  const page = createImage(width, height);
  sorted.forEach((t, i) => {
    const r = regions[i];
    for (let row = 0; row < r.height; row++) {
      const src = t.image.data.subarray(row * r.width * 4, (row + 1) * r.width * 4);
      page.data.set(src, ((r.y + row) * width + r.x) * 4);
    }
  });

  const pageName = `${name}.png`;
  const lines = ["", pageName, `size: ${width},${height}`, "format: RGBA8888", "filter: Linear,Linear", "repeat: none"];
  for (const r of regions) {
    lines.push(r.name, "  rotate: false", `  xy: ${r.x}, ${r.y}`, `  size: ${r.width}, ${r.height}`, `  orig: ${r.width}, ${r.height}`, "  offset: 0, 0", "  index: -1");
  }
  return { pageName, page, regions, text: lines.join("\n") + "\n" };
}

function pow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}
