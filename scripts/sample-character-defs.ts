// Knight and wizard rig definitions: bones (world space at setup), parts (back to front) and animations.
// art/parts/<name>/layout.json (written by scripts/fit-rig.ts) overrides part placement; bones move with their part.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Bones in world space at setup (no setup rotation, so a child's offset is just the difference). */
export interface BoneDef { name: string; parent?: string; x: number; y: number; color?: string }
/** A part image placed in world space at setup: centre, rotation (deg), optional mirror. Listed back to front. */
export interface PartDef { part: string; bone: string; x: number; y: number; rotation?: number; flipX?: boolean; scale?: number; /** pieces cut from one drawing share the placement of this part */ follows?: string }
export type Key = { time: number; [k: string]: number | string | number[] | undefined };
/** keys: [time, value(s)…, "linear"?] — eased by default; "linear" keeps the segment to the next key straight */
export type Timelines = Record<string, { rotate?: (number | "linear")[][]; translate?: [number, number, number][]; scale?: [number, number, number][] }>;
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
    // left arm chain: shoulder (upper arm L) → elbow (vambrace) → wrist (fist); "Hand L" is split at the cuff
    { name: "arm_l", parent: "torso", x: 48, y: 216 },
    { name: "forearm_l", parent: "arm_l", x: 62, y: 180 },
    { name: "hand_l", parent: "forearm_l", x: 71, y: 136 },
    { name: "leg_r", parent: "hip", x: -30, y: 110 },
    { name: "shin_r", parent: "leg_r", x: -42, y: 60 },
    { name: "leg_l", parent: "hip", x: 30, y: 110 },
    { name: "shin_l", parent: "leg_l", x: 50, y: 60 },
    { name: "chest", parent: "torso", x: 0, y: 185, color: ANCHOR },
  ],
  // back to front
  parts: [
    { part: "cape", bone: "cape", x: -100, y: 130 },
    // left arm is the far arm (3/4 view facing right): it hangs behind the torso, only its edge shows
    { part: "fist_l", bone: "hand_l", x: 66, y: 142, follows: "forearm_l" },
    { part: "forearm_l", bone: "forearm_l", x: 66, y: 142 },
    { part: "upper_arm_l", bone: "arm_l", x: 56, y: 202 },
    { part: "leg_l", bone: "leg_l", x: 38, y: 104 },
    { part: "boot_l", bone: "shin_l", x: 64, y: 64 },
    { part: "leg_r", bone: "leg_r", x: -34, y: 104 },
    { part: "boot_r", bone: "shin_r", x: -50, y: 86 },
    { part: "crotch", bone: "hip", x: 2, y: 130 },
    { part: "torso", bone: "torso", x: 2, y: 192 },
    { part: "tasset", bone: "hip", x: 4, y: 112 },
    { part: "head", bone: "head", x: 6, y: 294 },
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
      hand_l: { rotate: [[0, 0], [0.6, 4], [1.2, 0]] },
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
      forearm_l: { rotate: [[0, 0], [0.28, 18], [0.45, -20], [0.8, 0]] },
      hand_l: { rotate: [[0, 0], [0.28, 12], [0.45, -18], [0.8, 0]] },
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
      forearm_l: { rotate: [[0, 8], [0.4, -8], [0.8, 8]] },
      hand_l: { rotate: [[0, 6], [0.4, -6], [0.8, 6]] },
      torso: { rotate: [[0, 1.5], [0.4, -1.5], [0.8, 1.5]] },
      cape: { rotate: [[0, 6], [0.4, 2], [0.8, 6]] },
    },
  },
};


const WIZARD: CharDef = {
  name: "wizard",
  // hand-placed at one body scale (0.65) and one head scale, so proportions stay consistent; the parts sheet is drawn
  // differently from the reference composite, so fitting each part to it separately gave mismatched sizes
  bones: [
    { name: "root", x: 0, y: 0 },
    { name: "hip", parent: "root", x: 0, y: 110 },
    { name: "torso", parent: "hip", x: 0, y: 122 },
    { name: "head", parent: "torso", x: 0, y: 205 },
    { name: "hat", parent: "head", x: -2, y: 272 },
    { name: "hat_gem", parent: "hat", x: 21, y: 321, color: ANCHOR },
    { name: "robe", parent: "torso", x: 0, y: 195 },
    { name: "chest_gem", parent: "torso", x: 0, y: 190, color: ANCHOR },
    // staff arm: shoulder at the coat's corner → elbow → wrist → staff in the glove
    { name: "arm_r", parent: "torso", x: 37, y: 183 },
    { name: "forearm_r", parent: "arm_r", x: 52.7, y: 139.8 },
    { name: "hand_r", parent: "forearm_r", x: 97.3, y: 113.4 },
    { name: "staff_hand", parent: "hand_r", x: 106, y: 108, color: ANCHOR },
    { name: "staff", parent: "hand_r", x: 106, y: 108 },
    { name: "staff_orb", parent: "staff", x: 145, y: 215, color: ANCHOR },
    // free arm hanging at the side: shoulder → elbow → wrist
    { name: "arm_l", parent: "torso", x: -37, y: 183 },
    { name: "forearm_l", parent: "arm_l", x: -43.4, y: 137.4 },
    { name: "hand_l", parent: "forearm_l", x: -47.5, y: 90.5 },
    // boots hang from the hip under the skirt
    { name: "leg_r", parent: "hip", x: -28, y: 86 },
    { name: "leg_l", parent: "hip", x: 28, y: 86 },
    { name: "potion", parent: "hip", x: -21.6, y: 100, color: ANCHOR },
  ],
  // back to front
  parts: [
    { part: "robe", bone: "robe", x: 0, y: 117, scale: 0.65 },
    { part: "boot_l", bone: "leg_l", x: 28, y: 44, scale: 0.65 },
    { part: "boot_r", bone: "leg_r", x: -28, y: 45, scale: 0.65 },
    { part: "skirt", bone: "hip", x: 0, y: 63.5, scale: 0.65 },
    { part: "coat_skirt", bone: "hip", x: 0, y: 75, scale: 0.65 },
    // the coat's belt sits on the waist line (y ≈ 120), where the pouch strap hangs
    { part: "coat", bone: "torso", x: 0, y: 163.5, scale: 0.65 },
    { part: "glove_l", bone: "hand_l", x: -46.8, y: 99.9, rotation: -5, scale: 0.65, follows: "lower_sleeve_l" },
    { part: "lower_sleeve_l", bone: "forearm_l", x: -46.8, y: 99.9, rotation: -5, scale: 0.65 },
    { part: "sleeve_l", bone: "arm_l", x: -40.2, y: 160.2, rotation: -8, scale: 0.65 },
    { part: "pouch", bone: "hip", x: -5, y: 108, scale: 0.65 },
    // staff behind the glove's fingers, its foot on the ground
    { part: "staff", bone: "staff", x: 111.6, y: 123.3, rotation: 70, scale: 0.65 },
    { part: "glove_r", bone: "hand_r", x: 85.6, y: 120.2, rotation: 60, scale: 0.65, follows: "lower_sleeve_r" },
    { part: "lower_sleeve_r", bone: "forearm_r", x: 85.6, y: 120.2, rotation: 60, scale: 0.65 },
    { part: "sleeve_r", bone: "arm_r", x: 44.9, y: 161.4, rotation: 20, scale: 0.65 },
    // hat behind the head: the hair sits in front of the brim
    { part: "hat", bone: "hat", x: -6, y: 308.5 },
    { part: "head", bone: "head", x: 0, y: 264, scale: 0.95 },
  ],
  animations: {
    idle: {
      hip: { translate: [[0, 0, 0], [0.8, 0, 4], [1.6, 0, 0]] },
      torso: { rotate: [[0, 0], [0.8, 1.5], [1.6, 0]] },
      robe: { rotate: [[0, 0], [0.8, 2.5], [1.6, 0]] },
      hat: { rotate: [[0, 0], [0.8, -3], [1.6, 0]] },
      arm_r: { rotate: [[0, 0], [0.8, 3], [1.6, 0]] },
      hand_r: { rotate: [[0, 0], [0.8, -3], [1.6, 0]] },
      arm_l: { rotate: [[0, 0], [0.8, -3], [1.6, 0]] },
      hand_l: { rotate: [[0, 0], [0.8, 4], [1.6, 0]] },
    },
    // lifts the staff up, then thrusts it forward; every joint turns a little (largest 18°)
    cast: {
      hip: { translate: [[0, 0, 0], [0.35, -4, 10], [0.55, 10, 2], [1, 0, 0]] },
      torso: { rotate: [[0, 0], [0.35, 5], [0.55, -6], [1, 0]] },
      head: { rotate: [[0, 0], [0.35, 4], [0.55, -3], [1, 0]] },
      hat: { rotate: [[0, 0], [0.35, -5], [0.55, 5], [1, 0]] },
      arm_r: { rotate: [[0, 0], [0.35, 18], [0.55, -8], [1, 0]] },
      forearm_r: { rotate: [[0, 0], [0.35, 8], [0.55, -3], [1, 0]] },
      hand_r: { rotate: [[0, 0], [0.35, -10], [0.55, -4], [1, 0]] },
      arm_l: { rotate: [[0, 0], [0.35, -14], [0.55, 8], [1, 0]] },
      forearm_l: { rotate: [[0, 0], [0.35, -10], [0.55, 6], [1, 0]] },
      hand_l: { rotate: [[0, 0], [0.35, -12], [0.55, 8], [1, 0]] },
      robe: { rotate: [[0, 0], [0.35, -4], [0.55, 6], [1, 0]] },
    },
  },
};


/** Applies art/parts/<name>/layout.json: parts take their fitted placement, followers copy their leader's, and each
 * bone moves by the same offset as the first part on it (bones without a part move with their parent). */
export function withLayout(d: CharDef): CharDef {
  const file = join("art", "parts", d.name, "layout.json");
  if (!existsSync(file)) return d;
  const fit: Record<string, { x: number; y: number; rotation: number; scale: number }> = JSON.parse(readFileSync(file, "utf8"));
  const parts = d.parts.map((p) => {
    const f = fit[p.follows ?? p.part];
    if (!f) return p;
    if (p.follows) {
      const lead = d.parts.find((q) => q.part === p.follows)!;
      return { ...p, x: f.x + (p.x - lead.x), y: f.y + (p.y - lead.y), rotation: f.rotation, scale: f.scale };
    }
    return { ...p, ...f };
  });
  // each joint stays on the same spot of the artwork: express the bone in its part's frame (nearest part on the bone
  // or an ancestor), then re-project it through that part's fitted position, rotation and scale
  const byName = new Map(d.bones.map((b) => [b.name, b]));
  const partOf = (bone: string | undefined): number => {
    for (let n = bone; n; n = byName.get(n)?.parent) { const i = d.parts.findIndex((p) => p.bone === n); if (i >= 0) return i; }
    return -1;
  };
  const bones = d.bones.map((b) => {
    const i = partOf(b.name);
    if (i < 0) return b;
    const p0 = d.parts[i], p1 = parts[i];
    const toLocal = (x: number, y: number, p: PartDef): [number, number] => {
      const r = (-(p.rotation ?? 0) * Math.PI) / 180, s = p.scale ?? 1, dx = x - p.x, dy = y - p.y;
      return [(dx * Math.cos(r) - dy * Math.sin(r)) / s, (dx * Math.sin(r) + dy * Math.cos(r)) / s];
    };
    const toWorld = ([lx, ly]: [number, number], p: PartDef): [number, number] => {
      const r = ((p.rotation ?? 0) * Math.PI) / 180, s = p.scale ?? 1;
      return [p.x + (lx * Math.cos(r) - ly * Math.sin(r)) * s, p.y + (lx * Math.sin(r) + ly * Math.cos(r)) * s];
    };
    const [x, y] = toWorld(toLocal(b.x, b.y, p0), p1);
    return { ...b, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  });
  return { ...d, bones, parts };
}

/** hand-made layouts (what fit-rig.ts starts from) */
export const BASE_DEFS = [KNIGHT, WIZARD];
export const DEFS = BASE_DEFS.map(withLayout);
