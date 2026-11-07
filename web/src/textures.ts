import { Texture as PixiTexture } from "pixi.js";
import { builtinTexture, isBuiltinTexture, textureNameFromPath, type Texture, type TextureResolver } from "@core/textures";
import { decodePng, encodePng, type Image } from "@core/png";
import type { Effect } from "@core/schema";
import { api } from "./api";

/** Custom (uploaded) textures keyed by their effect ref, e.g. "textures/leaf.png". */
const custom = new Map<string, Texture>();
const pixiCache = new Map<string, PixiTexture>();

export const resolveTexture: TextureResolver = (ref) => {
  if (isBuiltinTexture(ref)) return builtinTexture(ref);
  const t = custom.get(ref);
  if (!t) throw new Error(`texture "${ref}" is not loaded`);
  return t;
};

/** Loads any custom textures an effect references. Missing ones fall back to soft-circle. */
export async function ensureTextures(effect: Effect): Promise<string[]> {
  const missing: string[] = [];
  for (const e of effect.emitters) {
    if (isBuiltinTexture(e.texture) || custom.has(e.texture)) continue;
    try {
      custom.set(e.texture, { name: textureNameFromPath(e.texture), image: decodePng(await api.fetchTexture(e.texture)) });
    } catch {
      missing.push(e.texture);
      custom.set(e.texture, { ...builtinTexture("soft-circle"), name: textureNameFromPath(e.texture) });
    }
  }
  return missing;
}

/** Decodes a user-picked image (any browser format) to straight RGBA, uploads it as PNG, returns its ref. */
export async function importTexture(file: File): Promise<string> {
  const bmp = await createImageBitmap(file, { premultiplyAlpha: "none" });
  const max = 512;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const image: Image = { width: w, height: h, data: new Uint8Array(data.buffer.slice(0)) };
  const name = textureNameFromPath(file.name);
  const ref = await api.uploadTexture(name, encodePng(image));
  custom.set(ref, { name, image });
  pixiCache.delete(ref);
  return ref;
}

export function imageToCanvas(img: Image): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

export function pixiTexture(ref: string): PixiTexture {
  let t = pixiCache.get(ref);
  if (!t) {
    t = PixiTexture.from(imageToCanvas(resolveTexture(ref).image));
    pixiCache.set(ref, t);
  }
  return t;
}

/** Small data-URL thumbnail for UI lists. */
const thumbs = new Map<string, string>();
export function textureThumb(ref: string): string {
  let u = thumbs.get(ref);
  if (!u) {
    try { u = imageToCanvas(resolveTexture(ref).image).toDataURL(); } catch { u = ""; }
    thumbs.set(ref, u);
  }
  return u;
}
