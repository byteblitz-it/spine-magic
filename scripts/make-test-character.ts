// Generates small test characters (Spine 3.8 and 4.2 JSON + atlas + png) with a swinging arm.
// Usage: npx tsx scripts/make-test-character.ts  → test/fixtures/hero-3.8/, test/fixtures/hero-4.2/
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAtlas, createImage, encodePng, type Texture } from "../src/core/index.js";

function rect(name: string, w: number, h: number, rgb: [number, number, number]): Texture {
  const image = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
    image.data.set(edge ? [20, 20, 30, 255] : [...rgb, 255], (y * w + x) * 4);
  }
  return { name, image };
}

function character(version: "3.8" | "4.2") {
  const v3 = version === "3.8";
  const rot = (time: number, angle: number) => (v3 ? { time, angle } : { time, value: angle });
  return {
    skeleton: { hash: "hero", spine: v3 ? "3.8.99" : "4.2.43", x: -80, y: 0, width: 260, height: 220, images: "./", audio: "" },
    bones: [
      { name: "root" },
      { name: "body", parent: "root", y: 60, color: "ffffffff" },
      { name: "arm", parent: "body", x: 30, y: 100, length: 90, color: "ff8000ff" },
      { name: "hand", parent: "arm", x: 90, color: "ffcc00ff" },
    ],
    slots: [
      { name: "body", bone: "body", attachment: "body" },
      { name: "arm", bone: "arm", attachment: "arm" },
    ],
    skins: [{ name: "default", attachments: {
      body: { body: { x: 0, y: 60, width: 80, height: 120 } },
      arm: { arm: { x: 45, y: 0, width: 90, height: 20 } },
    } }],
    animations: {
      // arm swings up and back: a hand trail draws an arc
      swing: { bones: { arm: { rotate: [rot(0, -30), rot(0.5, 80), rot(1, -30)] } } },
      // walk: the whole body moves right and back, arm bobs
      walk: { bones: {
        body: { translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 120, y: 0 }, { time: 2, x: 0, y: 0 }] },
        arm: { rotate: [rot(0, 0), rot(0.5, 20), rot(1, 0), rot(1.5, 20), rot(2, 0)] },
      } },
      idle: { bones: { arm: { rotate: [rot(0, 0), rot(1, 10), rot(2, 0)] } } },
    },
  };
}

const atlas = buildAtlas("hero", [rect("body", 80, 120, [90, 140, 220]), rect("arm", 90, 20, [230, 150, 90])]);
for (const v of ["3.8", "4.2"] as const) {
  const dir = join("test", "fixtures", `hero-${v}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hero.json"), JSON.stringify(character(v), null, 2));
  writeFileSync(join(dir, "hero.atlas"), atlas.text);
  writeFileSync(join(dir, atlas.pageName), encodePng(atlas.page));
  console.log(`wrote ${dir}`);
}
