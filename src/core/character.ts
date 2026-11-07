// Character skeletons: inspect them, and merge / remove baked effects so they ride on a character bone.
// Browser-safe: the editor runs exactly the same merge as the MCP server.
import { Attachment, parseEffect, SPINE_VERSIONS, type AttachmentInput, type Effect, type SpineVersion } from "./schema.js";
import { bake, safe, type BakeStats } from "./bake.js";
import type { TextureResolver } from "./textures.js";
import type { Image } from "./png.js";
import { DEG } from "./math.js";

/** World transform of a bone: position + 2×2 matrix [a b; c d] (Spine convention). */
export interface BoneWorld { x: number; y: number; a: number; b: number; c: number; d: number }
/** Poses `animation` at time t and returns the bone's world transform (provided by a Spine runtime). */
export type BoneSampler = (animation: string, time: number, bone: string) => BoneWorld;

export interface CharacterInfo {
  version: SpineVersion;
  spine: string;
  bones: { name: string; parent?: string }[];
  slots: { name: string; bone: string; index: number }[];
  skins: string[];
  animations: { name: string; duration: number }[];
  /** effects already merged by SpineMagic (by prefix) */
  effects: string[];
  hasDrawOrderTimelines: boolean;
}

/** Maps skeleton.spine (e.g. "3.8.99", "4.2.43") to a supported export version. */
export function detectVersion(json: any): SpineVersion {
  const s: string = json?.skeleton?.spine ?? "";
  const mm = s.split(".").slice(0, 2).join(".");
  if ((SPINE_VERSIONS as readonly string[]).includes(mm)) return mm as SpineVersion;
  throw new Error(`unsupported Spine version "${s || "unknown"}" — SpineMagic merges into ${SPINE_VERSIONS.join(", ")} skeletons (JSON from 3.8–4.3, or binary .skel from 3.8 / 4.2)`);
}

/** Longest key time in an animation (Spine's animation duration). */
export function animationDuration(anim: unknown): number {
  let max = 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      if (k === "time" && typeof x === "number") max = Math.max(max, x);
      else walk(x);
    }
  };
  walk(anim);
  return max;
}

export const FX = "fx_";
export const effectPrefix = (effectName: string) => `${FX}${safe(effectName)}`;

export function inspectCharacter(json: any): CharacterInfo {
  const version = detectVersion(json);
  const bones = (json.bones ?? []).map((b: any) => ({ name: b.name, ...(b.parent ? { parent: b.parent } : {}) }));
  const effects = new Set<string>();
  for (const b of bones) { const m = /^fx_(.+?)__anchor$/.exec(b.name); if (m) effects.add(m[1]); }
  const anims = json.animations ?? {};
  return {
    version,
    spine: json.skeleton?.spine ?? "",
    bones,
    slots: (json.slots ?? []).map((s: any, index: number) => ({ name: s.name, bone: s.bone, index })),
    skins: Array.isArray(json.skins) ? json.skins.map((s: any) => s.name) : Object.keys(json.skins ?? {}),
    animations: Object.entries(anims).map(([name, a]) => ({ name, duration: round(animationDuration(a)) })),
    effects: [...effects],
    hasDrawOrderTimelines: Object.values<any>(anims).some((a) => a?.drawOrder || a?.draworder),
  };
}

export interface MergeInput {
  character: any;
  characterAtlas: string;
  effect: Effect;
  attach: AttachmentInput;
  resolveTexture?: TextureResolver;
  tolerance?: number;
  /** required for mode "trail" */
  sampleBone?: BoneSampler;
}

export interface MergeResult {
  json: any;
  atlasText: string;
  /** the effect's atlas page, to be written next to the character's pages */
  page: { name: string; image: Image };
  prefix: string;
  version: SpineVersion;
  /** whether the effect page was written premultiplied (render the merged skeleton with this flag) */
  premultiplied: boolean;
  stats: BakeStats & { characterBones: number; totalBones: number; addedBones: number };
  warnings: string[];
}

/**
 * Bakes `effect` and grafts it into a copy of the character:
 * - an anchor bone `fx_<effect>__anchor` under the chosen bone (inherit rotation/scale as requested),
 * - the effect's bones under it (trail mode: world-space emitters go under `fx_<effect>__root` at the root and emit
 *   from the bone's sampled path, so they leave trails),
 * - slots inserted in the draw order, attachments in the default skin, keys in the chosen animation,
 * - the effect's texture page appended to the atlas.
 * Re-merging the same effect replaces the previous copy. The input objects are not modified.
 */
export function mergeEffect(input: MergeInput): MergeResult {
  const attach = Attachment.parse(input.attach);
  const char = structuredClone(input.character);
  const version = detectVersion(char);
  const warnings: string[] = [];
  const prefix = effectPrefix(input.effect.name);

  const anim = char.animations?.[attach.animation];
  if (!anim) throw new Error(`animation "${attach.animation}" not found; animations: ${Object.keys(char.animations ?? {}).join(", ") || "(none)"}`);
  const boneNames = new Set<string>((char.bones ?? []).map((b: any) => b.name));
  if (!boneNames.has(attach.bone)) throw new Error(`bone "${attach.bone}" not found in the character`);
  if (attach.bone.startsWith(prefix)) throw new Error("attach to a character bone, not to an effect bone");
  if (attach.slot && !(char.slots ?? []).some((s: any) => s.name === attach.slot)) throw new Error(`slot "${attach.slot}" not found in the character`);
  if (!Array.isArray(char.skins)) throw new Error("character uses the pre-3.8 skins format; re-export it from Spine 3.8 or later");

  removeEffectFromJson(char, prefix);
  const characterBones = char.bones.length;
  const rootName: string = char.bones[0]?.name ?? "root";
  const animDur = animationDuration(anim);

  // ---- prepare the effect: loop length, trail tracks
  const doc = structuredClone(input.effect);
  if (doc.loop && attach.matchLoop && animDur > 0) doc.duration = animDur;
  let offset = attach.startTime;
  if (doc.loop && offset > 0) { warnings.push("startTime is ignored for looping effects (they cover the whole animation)"); offset = 0; }

  const trailEmitters = new Set<number>();
  if (attach.mode === "trail") {
    if (!input.sampleBone) throw new Error("trail mode needs a bone sampler (a Spine runtime for this version)");
    const sim = parseEffect(doc);
    const fps = sim.fps;
    const period = sim.loop ? Math.max(1, Math.round(sim.duration * fps)) / fps : sim.duration;
    const n = Math.max(2, Math.round(period * fps));
    doc.emitters = doc.emitters.map((e, i) => {
      if (e.simulationSpace !== "world" || !e.enabled) return e;
      trailEmitters.add(i);
      const { x: ox, y: oy, rotation, scale } = e.transform;
      const c = Math.cos(-rotation * DEG), s = Math.sin(-rotation * DEG);
      const points: [number, number][] = [];
      for (let k = 0; k < (sim.loop ? n : n + 1); k++) {
        const t = offset + (k / n) * period;
        const bw = input.sampleBone!(attach.animation, t, attach.bone);
        const rw = input.sampleBone!(attach.animation, t, rootName);
        // emitter offset lives in bone space; the result is expressed in root-bone space
        const wx = bw.x + bw.a * ox + bw.b * oy, wy = bw.y + bw.c * ox + bw.d * oy;
        const [lx, ly] = invApply(rw, wx, wy);
        // pre-undo the emitter's own rotation/scale, which the motion system applies to path points
        points.push([(lx * c - ly * s) / scale, (lx * s + ly * c) / scale]);
      }
      return { ...e, transform: { ...e.transform, x: 0, y: 0 }, motion: { ...e.motion, enabled: true, points, smooth: false, closed: sim.loop, loops: 1, mode: sim.loop ? "loop" : "once", timing: "time" } };
    });
    if (!trailEmitters.size) warnings.push("trail mode only affects world-space emitters; all emitters are local, so they simply follow the bone");
  }

  // ---- bake with prefixed names
  const effect = parseEffect(doc);
  const baked = bake(effect, { version, name: prefix, namePrefix: `${prefix}__`, tolerance: input.tolerance, resolveTexture: input.resolveTexture });
  const fx = baked.json as any;

  // ---- graft bones
  const anchor = `${prefix}__anchor`, rootAnchor = `${prefix}__root`;
  const inheritKey = version === "4.2" || version === "4.3" ? "inherit" : "transform";
  const mode = attach.inheritRotation ? (attach.inheritScale ? "Normal" : "NoScale") : attach.inheritScale ? "NoRotationOrReflection" : "OnlyTranslation";
  char.bones.push({ name: anchor, parent: attach.bone, ...(mode !== "Normal" ? { [inheritKey]: mode } : {}), color: "22b8cfff" });
  if (trailEmitters.size) char.bones.push({ name: rootAnchor, parent: rootName, color: "22b8cfff" });
  const trailBone = (name: string) => [...trailEmitters].some((i) => name.startsWith(`${prefix}__${safe(effect.emitters[i].name)}_${i}_`));
  for (const b of fx.bones) {
    if (b.name === "root") continue;
    char.bones.push({ ...b, parent: b.parent === "root" ? (trailBone(b.name) ? rootAnchor : anchor) : b.parent });
  }

  // ---- slots at the chosen draw-order position
  let at = char.slots?.length ?? 0;
  if (attach.slot) at = char.slots.findIndex((s: any) => s.name === attach.slot) + (attach.place === "above" ? 1 : 0);
  char.slots = char.slots ?? [];
  char.slots.splice(at, 0, ...fx.slots);
  const info = inspectCharacter(input.character);
  if (info.hasDrawOrderTimelines) warnings.push("the character has draw-order keys; check them in Spine, inserted slots can shift their offsets");

  // ---- attachments into the default skin
  let skin = char.skins.find((s: any) => s.name === "default");
  if (!skin) { skin = { name: "default", attachments: {} }; char.skins.unshift(skin); }
  skin.attachments = skin.attachments ?? {};
  Object.assign(skin.attachments, fx.skins[0].attachments);

  // ---- keys into the animation (shifted to startTime)
  const fxAnim = fx.animations.animation;
  const shift = (tls: Record<string, any[]>) => Object.fromEntries(Object.entries(tls).map(([k, keys]) => [k, keys.map((key) => ({ ...key, time: round((key.time ?? 0) + offset) }))]));
  anim.bones = anim.bones ?? {};
  anim.slots = anim.slots ?? {};
  for (const [b, tls] of Object.entries<any>(fxAnim.bones ?? {})) anim.bones[b] = shift(tls);
  for (const [s, tls] of Object.entries<any>(fxAnim.slots ?? {})) anim.slots[s] = shift(tls);
  // ribbon deform keys go under the character's default skin
  const shiftKeys = (keys: any[]) => keys.map((key) => ({ ...key, time: round((key.time ?? 0) + offset) }));
  if (fxAnim.deform) {
    const dst = ((anim.deform ??= {}).default ??= {});
    for (const [s, atts] of Object.entries<any>(fxAnim.deform.default)) dst[s] = Object.fromEntries(Object.entries<any>(atts).map(([a, k]) => [a, shiftKeys(k)]));
  }
  if (fxAnim.attachments) {
    const dst = ((anim.attachments ??= {}).default ??= {});
    for (const [s, atts] of Object.entries<any>(fxAnim.attachments.default)) dst[s] = Object.fromEntries(Object.entries<any>(atts).map(([a, tl]) => [a, { deform: shiftKeys(tl.deform) }]));
  }
  const end = offset + baked.stats.durationSeconds;
  if (end > animDur + 1e-6) warnings.push(`the effect runs to ${round(end)} s, past the animation's ${round(animDur)} s, which lengthens "${attach.animation}"`);
  if (effect.loop && !attach.matchLoop && Math.abs(baked.stats.durationSeconds - animDur) > 1e-3) warnings.push("the effect loop length differs from the animation; the loops will drift (set matchLoop)");

  // ---- atlas: our page appended, in the same alpha mode as the character's pages
  const pma = attach.premultiplied === "auto" ? detectPremultiplied(input.characterAtlas, version) : attach.premultiplied;
  if (attach.premultiplied === "auto" && version === "3.8") warnings.push("3.8 atlases don't record premultiplied alpha; assumed premultiplied (Spine's export default). Set premultiplied:false if your export had it unticked.");
  let pageText = baked.atlas.text;
  let pageImage = baked.atlas.page;
  if (pma) {
    pageImage = premultiply(pageImage);
    if (version !== "3.8") pageText = pageText.replace(/^repeat: none$/m, "repeat: none\npma: true");
  }
  const atlasText = removeAtlasPage(input.characterAtlas, `${prefix}.png`).trimEnd() + "\n" + pageText;

  const totalBones = char.bones.length;
  return {
    json: char, atlasText, page: { name: baked.atlas.pageName, image: pageImage }, prefix, version, warnings, premultiplied: pma,
    stats: { ...baked.stats, characterBones, totalBones, addedBones: totalBones - characterBones },
  };
}

/** Removes a merged effect (all `fx_<effect>…` bones, slots, attachments, keys) and its atlas page. */
export function removeEffect(character: any, atlasText: string, effectName: string): { json: any; atlasText: string; removed: number } {
  const json = structuredClone(character);
  const prefix = effectPrefix(effectName);
  const removed = removeEffectFromJson(json, prefix);
  return { json, atlasText: removeAtlasPage(atlasText, `${prefix}.png`), removed };
}

function removeEffectFromJson(json: any, prefix: string): number {
  const ours = (n: string) => n.startsWith(`${prefix}__`);
  const before = json.bones?.length ?? 0;
  json.bones = (json.bones ?? []).filter((b: any) => !ours(b.name));
  json.slots = (json.slots ?? []).filter((s: any) => !ours(s.name));
  for (const skin of Array.isArray(json.skins) ? json.skins : []) for (const k of Object.keys(skin.attachments ?? {})) if (ours(k)) delete skin.attachments[k];
  for (const a of Object.values<any>(json.animations ?? {})) {
    for (const k of Object.keys(a.bones ?? {})) if (ours(k)) delete a.bones[k];
    for (const k of Object.keys(a.slots ?? {})) if (ours(k)) delete a.slots[k];
    for (const group of [a.deform, a.attachments]) for (const skin of Object.values<any>(group ?? {})) for (const k of Object.keys(skin ?? {})) if (ours(k)) delete skin[k];
  }
  return before - json.bones.length;
}

/** Atlas pages are blocks separated by blank lines, each starting with the page image name. */
function removeAtlasPage(atlasText: string, page: string): string {
  const blocks = atlasText.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  return blocks.filter((b) => b.trim().split("\n")[0].trim() !== page).join("\n\n");
}

/** 4.x atlases carry `pma: true|false` per page; 3.8 atlases carry nothing, and Spine exports premultiplied by default. */
export function detectPremultiplied(atlasText: string, version: SpineVersion): boolean {
  const m = /^\s*pma\s*:\s*(true|false)\s*$/im.exec(atlasText);
  if (m) return m[1].toLowerCase() === "true";
  return version === "3.8";
}

function premultiply(img: Image): Image {
  const data = new Uint8Array(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = Math.round(data[i] * a); data[i + 1] = Math.round(data[i + 1] * a); data[i + 2] = Math.round(data[i + 2] * a);
  }
  return { width: img.width, height: img.height, data };
}

function invApply(w: BoneWorld, x: number, y: number): [number, number] {
  const det = w.a * w.d - w.b * w.c || 1;
  const dx = x - w.x, dy = y - w.y;
  return [(w.d * dx - w.b * dy) / det, (-w.c * dx + w.a * dy) / det];
}

const round = (t: number) => Math.round(t * 10000) / 10000;
