// Downloads a few official Spine example skeletons (binary + JSON + atlas) from EsotericSoftware/spine-runtimes
// into test/fixtures/official/<version>/ for the .skel converter tests. They are not committed (Spine Runtimes
// License); tests that need them skip when they are missing.  Usage: node scripts/fetch-spine-examples.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EXAMPLES = {
  "3.8": ["spineboy", "raptor", "tank", "stretchyman", "mix-and-match"],
  "4.2": ["spineboy", "raptor", "tank", "stretchyman", "mix-and-match", "celestial-circus"],
};
const base = (v) => `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/${v}/examples`;

async function get(url) {
  const r = await fetch(url);
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

for (const [version, names] of Object.entries(EXAMPLES)) {
  const dir = join("test", "fixtures", "official", version);
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const files = [[`${name}-pro.skel`], [`${name}-pro.json`], [`${name}.atlas`, `${name}-pma.atlas`]];
    for (const candidates of files) {
      const target = join(dir, candidates[0]);
      if (existsSync(target)) continue;
      let data = null;
      for (const c of candidates) if ((data = await get(`${base(version)}/${name}/export/${c}`))) break;
      if (!data) { console.warn(`missing ${version}/${name}/${candidates[0]}`); continue; }
      writeFileSync(target, data);
      console.log(target);
    }
  }
}
