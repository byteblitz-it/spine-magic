// Builds the sample characters (knight, wizard) as cut-out Spine rigs from the layered parts in art/parts/
// (cut by scripts/cut-rig-parts.ts), for Spine 3.8 and 4.2, with anchor bones for attach_effect.
// Pages are premultiplied, like Spine's default export.
// Usage: npx tsx scripts/make-sample-characters.ts  → samples/characters/<name>-<version>/
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAtlas, decodePng, encodePng, type Image, type Texture } from "../src/core/index.js";

/** Bones in world space at setup (no setup rotation, so a child's offset is just the difference). */
interface BoneDef { name: string; parent?: string; x: number; y: number; color?: string }
/** A part image placed in world space at setup: centre, rotation (deg), optional mirror. Listed back to front. */
interface PartDef { part: string; bone: string; x: number; y: number; rotation?: number; flipX?: boolean; scale?: number }
type Key = { time: number; [k: string]: number | string | number[] | undefined };
/** keys: [time, value(s)…, "linear"?] — eased by default; "linear" keeps the segment to the next key straight */
type Timelines = Record<string, { rotate?: (number | "linear")[][]; translate?: [number, number, number][]; scale?: [number, number, number][] }>;
export interface CharDef { name: string; bones: BoneDef[]; parts: PartDef[]; animations: Record<string, Timelines> }

const ANCHOR = "ffcc00ff";

const KNIGHT: CharDef = {
  name: "knight",
  bones: [
    { name: "root", x: 0, y: 0 },
    { name: "hip", parent: "root", x: 0, y: 118 },
    { name: "torso", parent: "hip", x: 0, y: 140 },
    { name: "head", parent: "torso", x: 4, y: 222 },
    { name: "cape", parent: "torso", x: -30, y: 200 },
    // sword arm chain: shoulder (upper arm R) → elbow (lower arm R) → wrist (hand R) → sword in the fist
    { name: "arm_r", parent: "torso", x: -48, y: 220 },
    { name: "forearm_r", parent: "arm_r", x: -70, y: 176 },
    { name: "hand_r", parent: "forearm_r", x: -88, y: 138 },
    { name: "sword", parent: "hand_r", x: -100, y: 108 },
    { name: "grip", parent: "sword", x: -100, y: 108, color: ANCHOR },
    { name: "blade_mid", parent: "sword", x: 31, y: 43, color: ANCHOR },
    { name: "sword_tip", parent: "sword", x: 129, y: -5, color: ANCHOR },
    // left arm chain: shoulder (upper arm L) → elbow (hand L: vambrace + fist)
    { name: "arm_l", parent: "torso", x: 54, y: 216 },
    { name: "forearm_l", parent: "arm_l", x: 66, y: 180 },
    { name: "leg_r", parent: "hip", x: -30, y: 110 },
    { name: "shin_r", parent: "leg_r", x: -42, y: 60 },
    { name: "leg_l", parent: "hip", x: 30, y: 110 },
    { name: "shin_l", parent: "leg_l", x: 50, y: 60 },
    { name: "chest", parent: "torso", x: 0, y: 185, color: ANCHOR },
  ],
  // back to front
  parts: [
    { part: "cape", bone: "cape", x: -100, y: 130 },
    { part: "leg_l", bone: "leg_l", x: 38, y: 104 },
    { part: "boot_l", bone: "shin_l", x: 64, y: 64 },
    { part: "leg_r", bone: "leg_r", x: -34, y: 104 },
    { part: "boot_r", bone: "shin_r", x: -50, y: 86 },
    { part: "crotch", bone: "hip", x: 2, y: 130 },
    { part: "torso", bone: "torso", x: 2, y: 192 },
    { part: "tasset", bone: "hip", x: 4, y: 112 },
    { part: "head", bone: "head", x: 6, y: 294 },
    // left arm: the hand/vambrace hangs under its shoulder plate
    { part: "hand_l", bone: "forearm_l", x: 70, y: 142 },
    { part: "upper_arm_l", bone: "arm_l", x: 62, y: 202 },
    // sword arm: blade under the fist, forearm under the shoulder plate (pieces mirrored to point down-left)
    { part: "sword", bone: "sword", x: -14, y: 65, rotation: -26 },
    { part: "lower_arm_r", bone: "forearm_r", x: -80, y: 156, flipX: true },
    { part: "hand_r", bone: "hand_r", x: -88, y: 124, flipX: true },
    { part: "upper_arm_r", bone: "arm_r", x: -58, y: 205 },
  ],
  animations: {
    idle: {
      hip: { translate: [[0, 0, 0], [0.6, 0, -3], [1.2, 0, 0]] },
      torso: { rotate: [[0, 0], [0.6, 1.2], [1.2, 0]] },
      head: { rotate: [[0, 0], [0.6, -2], [1.2, 0]] },
      cape: { rotate: [[0, 0], [0.6, 4], [1.2, 0]] },
      arm_r: { rotate: [[0, 0], [0.6, 3], [1.2, 0]] },
      arm_l: { rotate: [[0, 0], [0.6, -3], [1.2, 0]] },
    },
    // rising slash: pull the blade back low, then sweep it forward and up in front of the body.
    // Shoulder, elbow and wrist each turn a share (none more than ~120°), so the arm bends instead of spinning.
    attack: {
      hip: { translate: [[0, 0, 0], [0.28, -6, -2], [0.45, 14, 2], [0.8, 0, 0]] },
      torso: { rotate: [[0, 0], [0.28, 6], [0.45, -8], [0.8, 0]] },
      head: { rotate: [[0, 0], [0.28, 4], [0.45, -4], [0.8, 0]] },
      arm_r: { rotate: [[0, 0], [0.28, -40], [0.38, 15, "linear"], [0.45, 50], [0.8, 0]] },
      forearm_r: { rotate: [[0, 0], [0.28, -35], [0.38, 0, "linear"], [0.45, 12], [0.8, 0]] },
      hand_r: { rotate: [[0, 0], [0.28, -25], [0.38, 10, "linear"], [0.45, 22], [0.8, 0]] },
      arm_l: { rotate: [[0, 0], [0.28, 15], [0.45, -20], [0.8, 0]] },
      forearm_l: { rotate: [[0, 0], [0.28, 10], [0.45, -15], [0.8, 0]] },
      cape: { rotate: [[0, 0], [0.28, -4], [0.45, 10], [0.8, 0]] },
      leg_r: { rotate: [[0, 0], [0.45, -8], [0.8, 0]] },
      leg_l: { rotate: [[0, 0], [0.45, 10], [0.8, 0]] },
    },
    walk: {
      hip: { translate: [[0, 0, 0], [0.2, 0, 6], [0.4, 0, 0], [0.6, 0, 6], [0.8, 0, 0]] },
      leg_r: { rotate: [[0, 18], [0.4, -18], [0.8, 18]] },
      shin_r: { rotate: [[0, 0], [0.2, 20], [0.4, 0], [0.8, 0]] },
      leg_l: { rotate: [[0, -18], [0.4, 18], [0.8, -18]] },
      shin_l: { rotate: [[0, 0], [0.4, 0], [0.6, 20], [0.8, 0]] },
      arm_r: { rotate: [[0, -8], [0.4, 8], [0.8, -8]] },
      arm_l: { rotate: [[0, 10], [0.4, -10], [0.8, 10]] },
      torso: { rotate: [[0, 1.5], [0.4, -1.5], [0.8, 1.5]] },
      cape: { rotate: [[0, 6], [0.4, 2], [0.8, 6]] },
    },
  },
};


const WIZARD: CharDef = {
  name: "wizard",
  bones: [
    { name: "root", x: 0, y: 0 },
    { name: "hip", parent: "root", x: 0, y: 100 },
    { name: "torso", parent: "hip", x: 0, y: 130 },
    { name: "head", parent: "torso", x: 0, y: 210 },
    { name: "hat", parent: "head", x: -6, y: 278 },
    { name: "hat_gem", parent: "hat", x: 15, y: 316, color: ANCHOR },
    { name: "robe", parent: "torso", x: 0, y: 200 },
    { name: "chest_gem", parent: "torso", x: 0, y: 196, color: ANCHOR },
    { name: "arm_l", parent: "torso", x: -52, y: 196 },
    { name: "forearm_l", parent: "arm_l", x: -58, y: 160 },
    { name: "arm_r", parent: "torso", x: 54, y: 196 },
    { name: "forearm_r", parent: "arm_r", x: 60, y: 160 },
    { name: "staff_hand", parent: "forearm_r", x: 72, y: 84, color: ANCHOR },
    { name: "staff", parent: "staff_hand", x: 72, y: 84 },
    { name: "staff_orb", parent: "staff", x: 120, y: 226, color: ANCHOR },
    { name: "leg_r", parent: "hip", x: -26, y: 70 },
    { name: "leg_l", parent: "hip", x: 26, y: 70 },
    { name: "potion", parent: "hip", x: -38, y: 87, color: ANCHOR },
  ],
  parts: [
    { part: "robe", bone: "robe", x: -2, y: 120 },
    { part: "hand_l", bone: "forearm_l", x: -62, y: 128 },
    { part: "sleeve_l", bone: "arm_l", x: -56, y: 184 },
    { part: "boot_l", bone: "leg_l", x: 26, y: 62 },
    { part: "boot_r", bone: "leg_r", x: -28, y: 64 },
    { part: "skirt", bone: "hip", x: 0, y: 72 },
    { part: "coat_skirt", bone: "hip", x: 0, y: 112 },
    { part: "pouch", bone: "hip", x: -10, y: 96 },
    { part: "coat", bone: "torso", x: 0, y: 172 },
    { part: "head", bone: "head", x: -2, y: 238 },
    { part: "hat", bone: "hat", x: -15, y: 306 },
    { part: "staff", bone: "staff", x: 84, y: 126, rotation: 75, scale: 0.8 },
    { part: "hand_r", bone: "forearm_r", x: 70, y: 128 },
    { part: "sleeve_r", bone: "arm_r", x: 56, y: 184 },
  ],
  animations: {
    idle: {
      hip: { translate: [[0, 0, 0], [0.8, 0, 4], [1.6, 0, 0]] },
      torso: { rotate: [[0, 0], [0.8, 1.5], [1.6, 0]] },
      robe: { rotate: [[0, 0], [0.8, 2.5], [1.6, 0]] },
      hat: { rotate: [[0, 0], [0.8, -3], [1.6, 0]] },
      arm_r: { rotate: [[0, 0], [0.8, -3], [1.6, 0]] },
      arm_l: { rotate: [[0, 0], [0.8, 3], [1.6, 0]] },
    },
    // raises the staff high, then thrusts it forward
    cast: {
      hip: { translate: [[0, 0, 0], [0.35, -4, 10], [0.55, 10, 2], [1, 0, 0]] },
      torso: { rotate: [[0, 0], [0.35, 6], [0.55, -8], [1, 0]] },
      head: { rotate: [[0, 0], [0.35, 5], [0.55, -4], [1, 0]] },
      hat: { rotate: [[0, 0], [0.35, -6], [0.55, 6], [1, 0]] },
      arm_r: { rotate: [[0, 0], [0.35, 75], [0.55, 45], [1, 0]] },
      forearm_r: { rotate: [[0, 0], [0.35, 20], [0.55, -10], [1, 0]] },
      // keep the orb up while the arm lifts, then tip it forward on the thrust
      staff: { rotate: [[0, 0], [0.35, -85], [0.55, -38], [1, 0]] },
      arm_l: { rotate: [[0, 0], [0.35, -30], [0.55, 10], [1, 0]] },
      robe: { rotate: [[0, 0], [0.35, -4], [0.55, 6], [1, 0]] },
    },
  },
};

const DEFS = [KNIGHT, WIZARD];

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
