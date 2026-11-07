// Browser Spine runtimes for character previews: 3.8 (vendored spine-ts webgl build) and 4.2 (npm spine-webgl).
// Both expose the same classes under different packaging; `SpineRuntime` papers over that.
import type { SpineVersion } from "@core/schema";
import type { BoneSampler } from "@core/character";

export interface SpineRuntime {
  version: SpineVersion;
  /** core classes (TextureAtlas, SkeletonJson, Skeleton, AnimationState, …) */
  core: any;
  /** webgl classes (ManagedWebGLRenderingContext, SceneRenderer, GLTexture) */
  webgl: any;
}

export const PREVIEW_VERSIONS: SpineVersion[] = ["3.8", "4.2"];

const cache = new Map<string, Promise<SpineRuntime>>();

export function loadRuntime(version: SpineVersion): Promise<SpineRuntime> {
  let p = cache.get(version);
  if (!p) {
    p = (async (): Promise<SpineRuntime> => {
      if (version === "3.8") {
        // the official 3.8 build is a classic script defining a global-style `spine` namespace
        const code = (await import("../../../vendor/spine-3.8/spine-webgl.js?raw")).default;
        const spine = new Function(`${code}\nreturn spine;`)();
        return { version, core: spine, webgl: spine.webgl };
      }
      if (version === "4.2") {
        const m = await import("spine-webgl-42");
        return { version, core: m, webgl: m };
      }
      throw new Error(`character preview supports Spine ${PREVIEW_VERSIONS.join(" and ")} (this skeleton is ${version}); baking into it still works`);
    })();
    cache.set(version, p);
  }
  return p;
}

const fakeTexture = () => ({ getImage: () => ({ width: 1, height: 1 }), setFilters() {}, setWraps() {}, dispose() {} });

/** Builds an atlas whose pages use `textureFor(pageName)`; works for 3.8 (loader arg) and 4.x (setTexture). */
export function makeAtlas(rt: SpineRuntime, atlasText: string, textureFor: (page: string) => any) {
  const atlas = new rt.core.TextureAtlas(atlasText, (path: string) => textureFor(path));
  if (rt.version !== "3.8") for (const page of atlas.pages) page.setTexture(textureFor(page.name));
  return atlas;
}

export function readSkeleton(rt: SpineRuntime, json: unknown, atlas: any) {
  return new rt.core.SkeletonJson(new rt.core.AtlasAttachmentLoader(atlas)).readSkeletonData(json);
}

/** Poses a skeleton at an absolute animation time (no mixing), version-independent. */
export function poser(rt: SpineRuntime, data: any) {
  const skeleton = new rt.core.Skeleton(data);
  const state = new rt.core.AnimationState(new rt.core.AnimationStateData(data));
  let current = "";
  return {
    skeleton,
    pose(animation: string, time: number, loop = true) {
      if (animation !== current || !state.tracks[0]) { state.setAnimation(0, animation, loop); current = animation; }
      const entry = state.tracks[0];
      entry.loop = loop;
      entry.trackTime = time;
      skeleton.setToSetupPose();
      state.apply(skeleton);
      skeleton.updateWorldTransform(rt.core.Physics?.update);
    },
  };
}

/** Bone sampler for trail-mode merges, from the character's own data (no textures needed). */
export function boneSampler(rt: SpineRuntime, json: unknown, atlasText: string): BoneSampler {
  const data = readSkeleton(rt, json, makeAtlas(rt, atlasText, () => fakeTexture()));
  const p = poser(rt, data);
  let last = "";
  return (animation, time, bone) => {
    const key = `${animation}@${time}`;
    if (key !== last) { p.pose(animation, time); last = key; }
    const b = p.skeleton.findBone(bone);
    if (!b) throw new Error(`bone ${bone} not found`);
    return { x: b.worldX, y: b.worldY, a: b.a, b: b.b, c: b.c, d: b.d };
  };
}
