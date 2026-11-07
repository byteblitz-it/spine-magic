// Binary .skel → JSON: the converted JSON must load to the same skeleton as the runtime's own binary reader.
// Uses the official example skeletons (node scripts/fetch-spine-examples.mjs); skipped when they are missing.
import { describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as spine42 from "spine-core-42";
import { PRESETS, attachToCharacter, inspectCharacterFile, loadRuntime, parseEffect, skelToJson, skelVersion } from "../src/node/index.js";

const spine38 = (await loadRuntime("3.8")).core;
const RUNTIMES: Record<string, any> = { "3.8": spine38, "4.2": spine42 };
const root = join("test", "fixtures", "official");

const fakeTexture = () => ({ getImage: () => ({ width: 1024, height: 1024 }), setFilters() {}, setWraps() {}, dispose() {} });

function load(core: any, version: string, atlasText: string, read: (atlas: any) => any) {
  const atlas = new core.TextureAtlas(atlasText, () => fakeTexture());
  for (const page of atlas.pages) page.setTexture?.(fakeTexture());
  return read(atlas);
}

/** Poses both skeletons through every animation and skin and returns the largest differences seen. */
function compare(core: any, version: string, a: any, b: any) {
  const v3 = version === "3.8";
  let maxBone = 0, maxVert = 0, attachmentMismatch = 0, colorMismatch = 0, samples = 0;
  const skins = a.skins.length > 1 ? a.skins.slice(1, 3).map((s: any) => s.name) : [a.skins[0]?.name];
  for (const skinName of skins) for (const anim of a.animations) {
    const sa = new core.Skeleton(a), sb = new core.Skeleton(b);
    for (const [s, d] of [[sa, a], [sb, b]] as const) { if (skinName) s.setSkinByName(skinName); s.setSlotsToSetupPose(); void d; }
    const animB = b.findAnimation(anim.name);
    expect(animB, anim.name).toBeTruthy();
    expect(animB.duration).toBeCloseTo(anim.duration, 4);
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const t = (anim.duration * k) / steps;
      for (const [s, an] of [[sa, anim], [sb, animB]] as const) {
        s.setToSetupPose();
        if (v3) an.apply(s, 0, t, true, [], 1, core.MixBlend.setup, core.MixDirection.mixIn);
        else an.apply(s, 0, t, true, [], 1, core.MixBlend.setup, core.MixDirection.in);
        if (v3) s.updateWorldTransform(); else s.updateWorldTransform(core.Physics.pose);
      }
      samples++;
      sa.bones.forEach((ba: any, i: number) => {
        const bb = sb.bones[i];
        maxBone = Math.max(maxBone, Math.abs(ba.worldX - bb.worldX), Math.abs(ba.worldY - bb.worldY), Math.abs(ba.a - bb.a) * 100, Math.abs(ba.d - bb.d) * 100);
      });
      sa.slots.forEach((xa: any, i: number) => {
        const xb = sb.slots[i];
        const aa = xa.getAttachment(), ab = xb.getAttachment();
        if ((aa?.name ?? null) !== (ab?.name ?? null)) { attachmentMismatch++; return; }
        if (Math.abs(xa.color.r - xb.color.r) + Math.abs(xa.color.a - xb.color.a) > 0.01) colorMismatch++;
        if (aa && aa.computeWorldVertices && aa.worldVerticesLength) {
          const n = aa.worldVerticesLength;
          const va = new Float32Array(n), vb = new Float32Array(n);
          if (v3 && aa.constructor.name === "RegionAttachment") return;
          if (!v3 && aa.constructor.name === "RegionAttachment") return;
          aa.computeWorldVertices(xa, 0, n, va, 0, 2);
          ab.computeWorldVertices(xb, 0, n, vb, 0, 2);
          for (let j = 0; j < n; j++) maxVert = Math.max(maxVert, Math.abs(va[j] - vb[j]));
        }
      });
      // draw order
      expect(sa.drawOrder.map((s: any) => s.data.name)).toEqual(sb.drawOrder.map((s: any) => s.data.name));
    }
  }
  return { maxBone, maxVert, attachmentMismatch, colorMismatch, samples };
}

for (const version of ["3.8", "4.2"]) {
  const dir = join(root, version);
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith("-pro.skel")).map((f) => f.replace(/-pro\.skel$/, "")) : [];
  describe.skipIf(names.length === 0)(`.skel ${version} → JSON loads to the same skeleton`, () => {
    for (const name of names) {
      it(name, () => {
        const core = RUNTIMES[version];
        const bytes = new Uint8Array(readFileSync(join(dir, `${name}-pro.skel`)));
        const atlasText = readFileSync(join(dir, `${name}.atlas`), "utf8");
        expect(skelVersion(bytes).startsWith(version)).toBe(true);
        const json = skelToJson(bytes);
        expect(json.skeleton.spine.startsWith(version)).toBe(true);
        const fromBinary = load(core, version, atlasText, (atlas) => new core.SkeletonBinary(new core.AtlasAttachmentLoader(atlas)).readSkeletonData(bytes));
        const fromJson = load(core, version, atlasText, (atlas) => new core.SkeletonJson(new core.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(JSON.stringify(json))));
        expect(fromJson.bones.length).toBe(fromBinary.bones.length);
        expect(fromJson.slots.length).toBe(fromBinary.slots.length);
        expect(fromJson.animations.map((a: any) => a.name)).toEqual(fromBinary.animations.map((a: any) => a.name));
        const r = compare(core, version, fromBinary, fromJson);
        expect(r.samples).toBeGreaterThan(10);
        expect(r.attachmentMismatch).toBe(0);
        expect(r.colorMismatch).toBe(0);
        expect(r.maxBone).toBeLessThan(0.01);
        expect(r.maxVert).toBeLessThan(0.01);
      });
    }

    it.skipIf(!names.includes("spineboy"))("attach_effect works on a binary character (writes JSON, runtime-valid, anchor on the bone)", async () => {
      const tmp = mkdtempSync(join(tmpdir(), `sm-skel-${version}-`));
      for (const f of ["spineboy-pro.skel", "spineboy.atlas"]) copyFileSync(join(dir, f), join(tmp, f));
      const skel = join(tmp, "spineboy-pro.skel");
      const info = inspectCharacterFile(skel);
      expect(info.version).toBe(version);
      const bone = info.bones.find((b) => /gun|hand|fist/.test(b.name))!.name;
      const animation = info.animations.find((a) => a.name === "run")?.name ?? info.animations[0].name;
      const effect = parseEffect({ ...PRESETS["magic-sparkles"].effect, name: "gun_glow" });
      const r = await attachToCharacter({ effect, jsonPath: skel, attach: { bone, animation } });
      expect(r.files.json.endsWith("spineboy-pro_fx.json")).toBe(true);
      expect(r.validation.ok).toBe(true);
      expect(r.followError).toBe(0);
    });
  });
}
