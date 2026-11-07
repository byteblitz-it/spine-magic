import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { detectVersion, effectPrefix, inspectCharacter, mergeEffect, removeEffect, type BoneSampler, type CharacterInfo, type MergeResult } from "../core/character.js";
import type { AttachmentInput, Effect, SpineVersion } from "../core/schema.js";
import { encodePng } from "../core/png.js";
import { loadRuntime, openSkeleton, sampleRuntime, validateData, type ValidationResult } from "./validate.js";
import { nodeTextureResolver } from "./textures.js";
import { skelToJson } from "../core/skel.js";

export interface CharacterFiles { json: any; atlasText: string; jsonPath: string; atlasPath: string; dir: string }

const SKEL = /\.skel(\.bytes)?$/i;

/** Skeleton data from .json, or from binary .skel / .skel.bytes (3.8, 4.2) converted to the equivalent JSON. */
export function readSkeletonFile(path: string): any {
  const p = resolve(path);
  if (!existsSync(p)) throw new Error(`character file ${p} not found`);
  if (SKEL.test(p)) return skelToJson(new Uint8Array(readFileSync(p)));
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Reads a character's skeleton (JSON or binary .skel) and its atlas (default: same name with .atlas or .atlas.txt). */
export function loadCharacterFiles(jsonPath: string, atlasPath?: string): CharacterFiles {
  const jp = resolve(jsonPath);
  const json = readSkeletonFile(jp);
  const base = SKEL.test(jp) ? jp.replace(SKEL, "") : jp.slice(0, -extname(jp).length);
  const plain = base.replace(/_fx$/, "").replace(/-(pro|ess)$/, "");
  const candidates = atlasPath ? [resolve(atlasPath)] : [...new Set([`${base}.atlas`, `${base}.atlas.txt`, `${plain}.atlas`, `${plain}.atlas.txt`])];
  const ap = candidates.find((p) => existsSync(p));
  if (!ap) throw new Error(`atlas not found (tried ${candidates.join(", ")}); pass atlasPath`);
  return { json, atlasText: readFileSync(ap, "utf8"), jsonPath: jp, atlasPath: ap, dir: dirname(jp) };
}

export function inspectCharacterFile(jsonPath: string): CharacterInfo & { jsonPath: string } {
  const jp = resolve(jsonPath);
  return { ...inspectCharacter(readSkeletonFile(jp)), jsonPath: jp, ...(SKEL.test(jp) ? { binary: true } : {}) };
}

/** Bone sampler backed by the official runtime for the character's version (3.8 vendored, 4.x npm). */
export async function runtimeBoneSampler(json: any, atlasText: string, version: SpineVersion = detectVersion(json)): Promise<BoneSampler> {
  const { core } = await loadRuntime(version);
  const s = openSkeleton(core, json, atlasText);
  let last = "";
  return (animation, time, bone) => {
    const key = `${animation}@${time}`;
    if (key !== last) { s.pose(animation, time); last = key; }
    return s.bone(bone);
  };
}

export interface AttachResult {
  files: { json: string; atlas: string; png: string };
  version: SpineVersion;
  stats: MergeResult["stats"];
  warnings: string[];
  validation: ValidationResult;
  /** follow mode: max distance between the anchor bone and the target bone over the animation (should be ~0) */
  followError?: number;
}

/**
 * Merges a baked effect into a character and writes `<character>_fx.json/.atlas` + the effect page next to the
 * character (so the character's own pages still resolve). Never overwrites the source files unless `out` says so.
 */
export async function attachToCharacter(opts: {
  effect: Effect; jsonPath: string; atlasPath?: string; attach: AttachmentInput; out?: string; tolerance?: number; textureDir?: string;
}): Promise<AttachResult> {
  const ch = loadCharacterFiles(opts.jsonPath, opts.atlasPath);
  const version = detectVersion(ch.json);
  const sampleBone = opts.attach.mode === "trail" ? await runtimeBoneSampler(ch.json, ch.atlasText, version) : undefined;
  const merged = mergeEffect({
    character: ch.json, characterAtlas: ch.atlasText, effect: opts.effect, attach: opts.attach,
    resolveTexture: nodeTextureResolver(opts.textureDir), tolerance: opts.tolerance, sampleBone,
  });

  const files = outputPaths(ch, opts.out, merged.page.name);
  writeFileSync(files.json, JSON.stringify(merged.json));
  writeFileSync(files.atlas, merged.atlasText);
  writeFileSync(files.png, encodePng(merged.page.image));

  const validation = await validateData(merged.json, merged.atlasText, version, { prefix: `${merged.prefix}__` });
  let followError: number | undefined;
  if (validation.ok) {
    // the anchor must sit exactly on the target bone in follow mode
    const { core } = await loadRuntime(version);
    const anim = String(opts.attach.animation);
    const dur = Math.max(0.01, inspectCharacter(merged.json).animations.find((a) => a.name === anim)?.duration ?? 1);
    const times = Array.from({ length: 7 }, (_, i) => (i / 6) * dur);
    const probes = times.flatMap((time) => [
      { bone: String(opts.attach.bone), time, animation: anim },
      { bone: `${merged.prefix}__anchor`, time, animation: anim },
    ]);
    const { probes: got } = sampleRuntime(core, merged.json, merged.atlasText, probes);
    followError = 0;
    for (let i = 0; i < got.length; i += 2) followError = Math.max(followError, Math.hypot(got[i].x - got[i + 1].x, got[i].y - got[i + 1].y));
    followError = Math.round(followError * 1000) / 1000;
    if (followError > 0.01) validation.errors.push(`anchor drifted ${followError}px from bone ${opts.attach.bone}`), (validation.ok = false);
  }
  return { files, version, stats: merged.stats, warnings: merged.warnings, validation, followError };
}

export async function detachFromCharacter(opts: { jsonPath: string; atlasPath?: string; effectName: string; out?: string }) {
  const ch = loadCharacterFiles(opts.jsonPath, opts.atlasPath);
  const version = detectVersion(ch.json);
  const r = removeEffect(ch.json, ch.atlasText, opts.effectName);
  const files = outputPaths(ch, opts.out, `${effectPrefix(opts.effectName)}.png`);
  writeFileSync(files.json, JSON.stringify(r.json));
  writeFileSync(files.atlas, r.atlasText);
  const validation = await validateData(r.json, r.atlasText, version);
  return { files: { json: files.json, atlas: files.atlas }, removedBones: r.removed, validation };
}

/** <dir>/<name>_fx.json + .atlas(.txt) by default; a merged file keeps its own name. */
function outputPaths(ch: CharacterFiles, out: string | undefined, pageName: string) {
  const name = SKEL.test(ch.jsonPath) ? basename(ch.jsonPath).replace(SKEL, "") : basename(ch.jsonPath, extname(ch.jsonPath));
  const jsonOut = out ? resolve(ch.dir, out) : join(ch.dir, name.endsWith("_fx") ? `${name}.json` : `${name}_fx.json`);
  const atlasExt = ch.atlasPath.endsWith(".atlas.txt") ? ".atlas.txt" : ".atlas";
  const atlasOut = jsonOut.replace(/\.json$/i, "") + atlasExt;
  return { json: jsonOut, atlas: atlasOut, png: join(dirname(atlasOut), pageName) };
}
