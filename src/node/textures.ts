import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { decodePng } from "../core/png.js";
import { builtinTexture, isBuiltinTexture, textureNameFromPath, type Texture, type TextureResolver } from "../core/textures.js";

const cache = new Map<string, Texture>();

/** Resolves builtin names, or PNG paths (absolute, or relative to `baseDir`). */
export function nodeTextureResolver(baseDir = process.cwd()): TextureResolver {
  return (ref) => {
    if (isBuiltinTexture(ref)) return builtinTexture(ref);
    const path = isAbsolute(ref) ? ref : resolve(baseDir, ref);
    const hit = cache.get(path);
    if (hit) return hit;
    if (!existsSync(path)) throw new Error(`texture "${ref}" is not a builtin and file ${path} does not exist`);
    const tex = { name: textureNameFromPath(path), image: decodePng(readFileSync(path)) };
    cache.set(path, tex);
    return tex;
  };
}
