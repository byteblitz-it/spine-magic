// Exports every preset for every Spine version, validates, and writes previews to ./out
import { writeFileSync, mkdirSync } from "node:fs";
import { PRESETS, SPINE_VERSIONS, parseEffect, exportSpine, validateExport, simulate, renderPreview, encodePng } from "../src/node/index.js";

const only = process.argv[2];
mkdirSync("out", { recursive: true });
let failed = 0;
for (const [id, p] of Object.entries(PRESETS)) {
  if (only && id !== only) continue;
  const effect = parseEffect(p.effect);
  const prev = renderPreview(effect, simulate(effect), { frames: 8 });
  writeFileSync(`out/${id}_preview.png`, encodePng(prev.image));
  for (const v of SPINE_VERSIONS) {
    const r = exportSpine(effect, `out/${id}/${v}`, v);
    const val = await validateExport(r.files.json, r.files.atlas, v);
    if (!val.ok) failed++;
    console.log(`${val.ok ? "OK  " : "FAIL"} ${id.padEnd(15)} ${v} ${val.method.padEnd(10)} lanes=${r.stats.lanes} keys=${r.stats.keys}/${r.stats.keysBeforeReduction} ${val.ok ? JSON.stringify(val.info) : val.errors.join("; ")}`);
  }
}
process.exit(failed ? 1 : 0);
