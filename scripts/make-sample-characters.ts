// Builds the sample characters (knight, wizard) as cut-out Spine rigs from the layered parts in art/parts/
// (cut by scripts/cut-rig-parts.ts), for Spine 3.8 and 4.2, with anchor bones for attach_effect.
// Rig definitions live in sample-character-defs.ts. Pages are premultiplied, like Spine's default export.
// Usage: npx tsx scripts/make-sample-characters.ts  → samples/characters/<name>-<version>/
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAtlas, decodePng, encodePng, type Image, type Texture } from "../src/core/index.js";
import { DEFS, type CharDef, type Key } from "./sample-character-defs.js";

const loadPart = (character: string, part: string): Image => decodePng(new Uint8Array(readFileSync(join("art", "parts", character, `${part}.png`))));

function premultiplied(img: Image): Image {
  const data = new Uint8Array(img.data);
  for (let i = 0; i < data.length; i += 4) { const a = data[i + 3] / 255; data[i] = Math.round(data[i] * a); data[i + 1] = Math.round(data[i + 1] * a); data[i + 2] = Math.round(data[i + 2] * a); }
  return { width: img.width, height: img.height, data };
}

export function buildCharacter(d: CharDef, version: "3.8" | "4.2") {
  const v3 = version === "3.8";
  const world = new Map(d.bones.map((b) => [b.name, b]));
  const bones = d.bones.map((b) => {
    const p = b.parent ? world.get(b.parent)! : { x: 0, y: 0 };
    return { name: b.name, ...(b.parent ? { parent: b.parent } : {}), ...nz({ x: r2(b.x - p.x), y: r2(b.y - p.y) }), ...(b.color ? { color: b.color } : {}) };
  });
  const textures: Texture[] = [...new Set(d.parts.map((p) => p.part))].map((part) => ({ name: part, image: premultiplied(loadPart(d.name, part)) }));
  const tex = new Map(textures.map((t) => [t.name, t]));
  const slots = d.parts.map((p) => ({ name: p.part, bone: p.bone, attachment: p.part }));
  const attachments: Record<string, Record<string, unknown>> = {};
  for (const p of d.parts) {
    const b = world.get(p.bone)!;
    const t = tex.get(p.part)!;
    const s = p.scale ?? 1;
    attachments[p.part] = { [p.part]: { ...nz({ x: r2(p.x - b.x), y: r2(p.y - b.y), rotation: p.rotation ?? 0 }), ...(p.flipX ? { scaleX: -s } : s !== 1 ? { scaleX: s } : {}), ...(s !== 1 ? { scaleY: s } : {}), width: t.image.width, height: t.image.height } };
  }
  const animations: Record<string, unknown> = {};
  for (const [name, tls] of Object.entries(d.animations)) {
    const bonesTl: Record<string, unknown> = {};
    for (const [bone, tl] of Object.entries(tls)) {
      const out: Record<string, Key[]> = {};
      if (tl.rotate) out.rotate = eased(tl.rotate.map(([time, a, l]) => ({ time: time as number, ...(v3 ? { angle: a as number } : { value: a as number }), ...(l === "linear" ? { _linear: 1 } : {}) })), v3);
      if (tl.translate) out.translate = eased(tl.translate.map(([time, x, y]) => ({ time, x, y })), v3);
      if (tl.scale) out.scale = eased(tl.scale.map(([time, x, y]) => ({ time, x, y })), v3);
      bonesTl[bone] = out;
    }
    animations[name] = { bones: bonesTl };
  }
  const atlas = buildAtlas(d.name, textures);
  const json = {
    skeleton: { hash: d.name, spine: v3 ? "3.8.99" : "4.2.43", x: -200, y: 0, width: 400, height: 400, images: "./", audio: "" },
    bones, slots, skins: [{ name: "default", attachments }], animations,
  };
  // 4.x atlases record premultiplied alpha; 3.8 atlases cannot (Spine assumes it)
  const atlasText = v3 ? atlas.text : atlas.text.replace(/^repeat: none$/m, "repeat: none\npma: true");
  return { json, atlasText, page: atlas.page, pageName: atlas.pageName };
}

/** ease in-out between keys: 3.8 curve/c2/c3/c4; 4.x absolute bezier handles per value channel */
function eased(keys: Key[], v3: boolean): Key[] {
  return keys.map((k, i) => {
    const next = keys[i + 1];
    if (k._linear) { const { _linear, ...rest } = k; return rest as Key; }
    if (!next) return k;
    if (v3) return { ...k, curve: 0.42, c2: 0, c3: 0.58, c4: 1 };
    const channels = "value" in k ? ["value"] : ["x", "y"];
    const t0 = k.time, t1 = next.time;
    return { ...k, curve: channels.flatMap((c) => [t0 + (t1 - t0) * 0.42, k[c] as number, t0 + (t1 - t0) * 0.58, next[c] as number]) };
  });
}

function nz(o: Record<string, number>) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0)); }
function r2(v: number) { return Math.round(v * 100) / 100; }

for (const d of DEFS) for (const version of ["3.8", "4.2"] as const) {
  const c = buildCharacter(d, version);
  const dir = join("samples", "characters", `${d.name}-${version}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${d.name}.json`), JSON.stringify(c.json, null, 2));
  writeFileSync(join(dir, `${d.name}.atlas`), c.atlasText);
  writeFileSync(join(dir, c.pageName), encodePng(c.page));
  console.log(`wrote ${dir}`);
}
