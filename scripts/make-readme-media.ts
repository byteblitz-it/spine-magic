// Renders the README preview strips into docs/media/. Usage: npx tsx scripts/make-readme-media.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PRESETS, encodePng, parseEffect, renderPreview, simulate } from "../src/node/index.js";

const dir = join("docs", "media");
mkdirSync(dir, { recursive: true });
for (const id of ["comet", "portal", "fire", "hex-shield", "magic-sparkles", "coin-shower", "light-ribbon"]) {
  const effect = parseEffect(PRESETS[id].effect);
  const sim = simulate(effect);
  const { image } = renderPreview(effect, sim, { frames: 4, columns: 4, cellSize: 200, background: [16, 18, 24], showOrigin: false });
  writeFileSync(join(dir, `${id}.png`), encodePng(image));
  console.log(`docs/media/${id}.png`);
}
