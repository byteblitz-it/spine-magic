import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Effect, SpineVersion } from "../core/schema.js";
import { bake, safe, type BakeStats } from "../core/bake.js";
import { encodePng } from "../core/png.js";
import { nodeTextureResolver } from "./textures.js";

export interface ExportResult {
  version: SpineVersion;
  dir: string;
  files: { json: string; atlas: string; png: string };
  stats: BakeStats;
}

export function exportSpine(effect: Effect, outDir: string, version: SpineVersion, opts: { tolerance?: number; textureDir?: string } = {}): ExportResult {
  const name = safe(effect.name);
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const { json, atlas, stats } = bake(effect, { version, name, tolerance: opts.tolerance, resolveTexture: nodeTextureResolver(opts.textureDir) });
  const files = { json: join(dir, `${name}.json`), atlas: join(dir, `${name}.atlas`), png: join(dir, atlas.pageName) };
  writeFileSync(files.json, JSON.stringify(json));
  writeFileSync(files.atlas, atlas.text);
  writeFileSync(files.png, encodePng(atlas.page));
  return { version, dir, files, stats };
}
