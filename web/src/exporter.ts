import { zipSync, strToU8 } from "fflate";
import { bake, safe, type BakeStats } from "@core/bake";
import { encodePng } from "@core/png";
import type { Effect, SpineVersion } from "@core/schema";
import { resolveTexture } from "./textures";

/** Bakes the chosen versions and downloads one zip: <version>/<name>.json|.atlas|.png */
export function exportZip(effect: Effect, versions: SpineVersion[], tolerance: number): { stats: BakeStats; bytes: number } {
  const name = safe(effect.name);
  const files: Record<string, Uint8Array> = {};
  let stats: BakeStats | null = null;
  for (const v of versions) {
    const r = bake(effect, { version: v, name, tolerance, resolveTexture });
    const dir = versions.length > 1 ? `spine-${v}/` : "";
    files[`${dir}${name}.json`] = strToU8(JSON.stringify(r.json));
    files[`${dir}${name}.atlas`] = strToU8(r.atlas.text);
    files[`${dir}${r.atlas.pageName}`] = encodePng(r.atlas.page);
    stats = r.stats;
  }
  files[`${name}.spinemagic.json`] = strToU8(JSON.stringify(effect, null, 2));
  const zip = zipSync(files, { level: 6 });
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}_spine${versions.length === 1 ? `-${versions[0]}` : ""}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { stats: stats!, bytes: zip.length };
}
