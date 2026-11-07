import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import type { SpineVersion } from "../core/schema.js";

export interface ValidationResult {
  ok: boolean;
  method: "runtime" | "structural";
  runtime?: string;
  errors: string[];
  info: Record<string, unknown>;
}

export type SpineCore = Record<string, any>;

const iifeCache = new Map<string, SpineCore>();
/** Evaluates a runtime's IIFE / namespace bundle (`var spine = ...`) in its own context and returns `spine`. */
function loadIife(path: string): SpineCore {
  let core = iifeCache.get(path);
  if (!core) {
    const code = readFileSync(path, "utf8");
    const ctx: Record<string, any> = { console, Math, Date, Float32Array, Int16Array, Uint16Array, Uint8Array, Array, Object, Map, Set, Error, JSON, Number, String };
    runInNewContext(`${code}\nthis.__spine = spine;`, ctx);
    core = ctx.__spine as SpineCore;
    iifeCache.set(path, core);
  }
  return core;
}

const req = createRequire(import.meta.url);
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
/** First path that exists: the plugin bundle keeps runtimes in ./vendor next to it; the repo keeps them at the root. */
const pick = (...paths: (() => string)[]) => {
  for (const p of paths) { try { const f = p(); if (existsSync(f)) return f; } catch { /* not resolvable here */ } }
  throw new Error("Spine runtime file not found (run npm install, or rebuild the plugin bundle)");
};

export async function loadRuntime(version: SpineVersion): Promise<{ core: SpineCore; name: string }> {
  switch (version) {
    // not on npm: the official 3.8 build is vendored (see vendor/spine-3.8/README.md)
    case "3.8": return { core: loadIife(pick(() => here("./vendor/spine-3.8/spine-core.js"), () => here("../../vendor/spine-3.8/spine-core.js"))), name: "spine-ts 3.8 (vendored, 8b4844bd)" };
    // 4.0's ESM build uses extensionless imports that plain Node rejects; its IIFE bundle loads anywhere
    case "4.0": return { core: loadIife(pick(() => here("./vendor/spine-core-4.0.js"), () => req.resolve("spine-core-40/dist/iife/spine-core.js"))), name: "@esotericsoftware/spine-core 4.0.31" };
    case "4.1": return { core: await import("spine-core-41"), name: "@esotericsoftware/spine-core 4.1.56" };
    case "4.2": return { core: await import("spine-core-42"), name: "@esotericsoftware/spine-core 4.2.120" };
    case "4.3": return { core: await import("spine-core-43"), name: "@esotericsoftware/spine-core 4.3.13" };
  }
}

/** A loaded skeleton you can pose at any animation time and read bone world transforms from. */
export interface SkeletonSession {
  data: any;
  skeleton: any;
  animations: { name: string; duration: number }[];
  pose(animation: string, time: number): void;
  /** World transform of a bone after the last pose: position + 2×2 matrix [a b; c d]. */
  bone(name: string): { x: number; y: number; a: number; b: number; c: number; d: number };
}

const fakeTexture = () => ({ getImage: () => ({ width: 1, height: 1 }), setFilters() {}, setWraps() {}, dispose() {} });

export function openSkeleton(core: SpineCore, json: unknown, atlasText: string): SkeletonSession {
  // 3.8 takes a texture loader in the constructor; 4.x ignores the extra argument and uses setTexture
  const atlas = new core.TextureAtlas(atlasText, () => fakeTexture());
  for (const page of atlas.pages) page.setTexture?.(fakeTexture());
  const data = new core.SkeletonJson(new core.AtlasAttachmentLoader(atlas)).readSkeletonData(json);
  const skeleton = new core.Skeleton(data);
  const stateData = new core.AnimationStateData(data);
  return {
    data,
    skeleton,
    animations: data.animations.map((a: any) => ({ name: a.name, duration: a.duration })),
    pose(animation, time) {
      (skeleton.setupPose ?? skeleton.setToSetupPose).call(skeleton);
      const state = new core.AnimationState(stateData);
      state.setAnimation(0, animation, true);
      state.update(time);
      state.apply(skeleton);
      skeleton.updateWorldTransform(core.Physics?.update);
    },
    bone(name) {
      const b = skeleton.findBone(name);
      if (!b) throw new Error(`bone ${name} not found`);
      const p = b.appliedPose ?? b; // 4.3 keeps the world transform on bone.appliedPose
      return { x: p.worldX, y: p.worldY, a: p.a, b: p.b, c: p.c, d: p.d };
    },
  };
}

/** Loads a skeleton JSON + atlas in the real Spine runtime and plays every animation. */
export async function validateExport(jsonPath: string, atlasPath: string, version: SpineVersion, opts: { prefix?: string } = {}): Promise<ValidationResult> {
  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  const atlasText = readFileSync(atlasPath, "utf8");
  return validateData(json, atlasText, version, opts);
}

export async function validateData(json: any, atlasText: string, version: SpineVersion, opts: { prefix?: string } = {}): Promise<ValidationResult> {
  const errors = structuralCheck(json, atlasText, version, opts);
  const rt = await loadRuntime(version);
  try {
    const s = sampleRuntime(rt.core, json, atlasText, []);
    return { ok: errors.length === 0, method: "runtime", runtime: rt.name, errors, info: s.info };
  } catch (e) {
    errors.push(`runtime load failed: ${(e as Error).message}`);
    return { ok: false, method: "runtime", runtime: rt.name, errors, info: {} };
  }
}

/**
 * Loads data in a spine-core runtime and returns world positions/scales of the given bones at the given times
 * (first animation unless `animation` is given), after playing every animation through to catch errors.
 */
export function sampleRuntime(core: SpineCore, json: unknown, atlasText: string, probes: { bone: string; time: number; animation?: string }[]) {
  const s = openSkeleton(core, json, atlasText);
  if (!s.animations.length) throw new Error("no animation in skeleton");
  const first = s.animations[0].name;

  const results = probes.map((p) => {
    s.pose(p.animation ?? first, p.time);
    const w = s.bone(p.bone);
    return { ...p, x: w.x, y: w.y, sx: Math.hypot(w.a, w.c), sy: Math.hypot(w.b, w.d) };
  });

  let visibleMax = 0;
  for (const anim of s.animations) {
    for (let t = 0; t <= anim.duration + 1e-6; t += 1 / 30) {
      s.pose(anim.name, t);
      let vis = 0;
      for (const slot of s.skeleton.slots) if (slot.getAttachment?.() ?? slot.appliedPose?.attachment) vis++;
      visibleMax = Math.max(visibleMax, vis);
      for (const b of s.skeleton.bones) {
        const a = b.appliedPose ?? b;
        if (!Number.isFinite(a.worldX) || !Number.isFinite(a.worldY)) throw new Error(`non-finite transform on ${b.data.name} in ${anim.name} at t=${t.toFixed(3)}`);
      }
    }
  }
  return {
    probes: results,
    info: { bones: s.data.bones.length, slots: s.data.slots.length, animations: s.animations.map((a) => a.name), animation: first, duration: s.animations[0].duration, maxVisibleSlots: visibleMax },
  };
}

/**
 * Version-aware checks of the subset of the Spine JSON format SpineMagic emits.
 * With `prefix` (a merged character), attachment/timeline checks only cover names starting with it,
 * because the character's own data may use features we never write (meshes, paths, constraints).
 */
export function structuralCheck(json: any, atlasText: string, version: SpineVersion, opts: { prefix?: string } = {}): string[] {
  const err: string[] = [];
  const v3 = version === "3.8";
  const ours = (name: string) => !opts.prefix || name.startsWith(opts.prefix);
  if (!json?.skeleton?.spine?.startsWith(version)) err.push(`skeleton.spine should start with ${version}`);
  const bones = new Set<string>();
  for (const b of json.bones ?? []) {
    if (b.parent && !bones.has(b.parent)) err.push(`bone ${b.name}: parent ${b.parent} must be defined earlier`);
    if (bones.has(b.name)) err.push(`duplicate bone ${b.name}`);
    bones.add(b.name);
  }
  const slots = new Set<string>();
  for (const s of json.slots ?? []) {
    if (!bones.has(s.bone)) err.push(`slot ${s.name}: unknown bone ${s.bone}`);
    if (slots.has(s.name)) err.push(`duplicate slot ${s.name}`);
    slots.add(s.name);
  }
  if (!Array.isArray(json.skins)) err.push("skins must be an array (3.8+ format)");
  const regions = new Set(atlasText.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !/^\s/.test(l) && !l.includes(":") && !/\.(png|jpe?g|webp)$/i.test(l)));
  for (const skin of json.skins ?? [])
    for (const [slot, atts] of Object.entries<any>(skin.attachments ?? {})) {
      if (!ours(slot)) continue;
      if (!slots.has(slot)) err.push(`skin attachment for unknown slot ${slot}`);
      for (const [name, a] of Object.entries<any>(atts)) if (!a.type && !regions.has(a.path ?? name)) err.push(`attachment ${name}: region missing from atlas`);
    }
  for (const [animName, anim] of Object.entries<any>(json.animations ?? {})) {
    const checkKeys = (where: string, keys: any[]) => {
      let prev = -1;
      for (const k of keys) {
        const t = k.time ?? 0;
        if (t < prev) err.push(`${animName}/${where}: key times must increase`);
        prev = t;
      }
    };
    for (const [b, tls] of Object.entries<any>(anim.bones ?? {})) {
      if (!ours(b)) continue;
      if (!bones.has(b)) err.push(`animation bone ${b} unknown`);
      for (const [tl, keys] of Object.entries<any[]>(tls)) {
        checkKeys(`${b}/${tl}`, keys);
        if (tl === "rotate" && keys.some((k) => (v3 ? "value" in k : "angle" in k))) err.push(`${b}/rotate uses ${v3 ? "value" : "angle"}; ${version} expects ${v3 ? "angle" : "value"}`);
      }
    }
    for (const [s, tls] of Object.entries<any>(anim.slots ?? {})) {
      if (!ours(s)) continue;
      if (!slots.has(s)) err.push(`animation slot ${s} unknown`);
      for (const [tl, keys] of Object.entries<any[]>(tls)) {
        checkKeys(`${s}/${tl}`, keys);
        if (tl === (v3 ? "rgba" : "color")) err.push(`${s}: slot colour timeline must be "${v3 ? "color" : "rgba"}" for ${version}`);
        if (tl === "color" || tl === "rgba") for (const k of keys) if (!/^[0-9a-f]{8}$/i.test(k.color)) err.push(`${s}: bad colour ${k.color}`);
      }
    }
  }
  return err;
}
