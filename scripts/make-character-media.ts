// Renders the README "on a character" strips: sample characters with effects merged by attach_effect, posed by the
// official Spine 4.2 runtime and rasterized in software. Usage: npx tsx scripts/make-character-media.ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as core from "spine-core-42";
import { PRESETS, attachToCharacter, createImage, decodePng, encodePng, parseEffect, type AttachmentInput, type Image } from "../src/node/index.js";

interface Shot { out: string; character: string; effect: unknown; attach: AttachmentInput; frames: number; times?: number[] }

const SHOTS: Shot[] = [
  {
    // enchanted blade: electric sparks and glow along the sword, riding it through the attack
    out: "knight-enchanted-blade.png", character: "knight", frames: 4, times: [0.15, 0.32, 0.48, 0.7],
    effect: {
      name: "enchanted_blade", loop: true,
      emitters: [
        {
          name: "glow", texture: "blurred-circle", blend: "additive",
          emission: { rate: 30, limit: 30 }, shape: { type: "line", width: 150 }, direction: { spread: 360 },
          transform: { rotation: -26 },
          initial: { lifetime: [0.4, 0.7], speed: [0, 8], size: [30, 44], color: "#3a90ff", alpha: 0.3 },
          overLifetime: { alpha: [[0, 0], [0.3, 1], [1, 0]] },
        },
        {
          name: "sparks", texture: "soft-circle", blend: "additive",
          emission: { rate: 40, limit: 40 }, shape: { type: "line", width: 160 }, direction: { angle: 64, spread: 120 },
          transform: { rotation: -26 },
          initial: { lifetime: [0.3, 0.55], speed: [220, 380], size: [20, 30] },
          overLifetime: { alignToVelocity: true, size: [[0, 1], [1, 0.2]], alpha: [[0, 1], [1, 0]], color: [[0, "#ffffff"], [1, "#5ac8ff"]] },
          affectors: [{ type: "turbulence", strength: 400, frequency: 0.05, speed: 4 }, { type: "velocityStretch", amount: 1.5, max: 4, minSpeed: 0, volume: 0.3 }],
        },
      ],
    },
    attach: { bone: "blade_mid", animation: "attack" },
  },
  {
    out: "wizard-orb-magic.png", character: "wizard", frames: 4,
    effect: {
      name: "orb_magic", loop: true,
      emitters: [
        {
          // pulsing glow behind the orb
          name: "glow", texture: "blurred-circle", blend: "additive",
          emission: { rate: 3, limit: 6 }, direction: { spread: 0 },
          initial: { lifetime: 1, speed: 0, size: 90, rotation: 0, color: "#b060ff", alpha: 0.8 },
          overLifetime: { size: [[0, 0.7], [0.5, 1.1], [1, 0.7]], alpha: [[0, 0], [0.5, 0.9], [1, 0]] },
        },
        {
          // sparkles swirling around the orb
          name: "swirl", texture: "star", blend: "additive",
          emission: { rate: 22, limit: 40 }, shape: { type: "circle", radius: 34, edgeOnly: true }, direction: { mode: "outward", spread: 20 },
          initial: { lifetime: [0.6, 0.9], speed: [10, 30], size: [30, 46], rotation: [0, 90], angularVelocity: [-180, 180] },
          overLifetime: { size: [[0, 0.3], [0.3, 1], [1, 0]], alpha: [[0, 0], [0.2, 1], [1, 0]], color: [[0, "#ffffff"], [0.4, "#e0b0ff"], [1, "#8030ff"]] },
          affectors: [{ type: "vortex", strength: 220 }],
        },
      ],
    },
    attach: { bone: "staff_orb", animation: "cast", inheritRotation: false },
  },
];

const CELL = 300, BG = [16, 18, 24];

for (const shot of SHOTS) {
  const dir = mkdtempSync(join(tmpdir(), "sm-media-"));
  cpSync(join("samples", "characters", `${shot.character}-4.2`), dir, { recursive: true });
  const r = await attachToCharacter({ effect: parseEffect(shot.effect), jsonPath: join(dir, `${shot.character}.json`), attach: shot.attach });
  if (!r.validation.ok) throw new Error(`${shot.out}: ${r.validation.errors.join("; ")}`);

  const atlasText = readFileSync(r.files.atlas, "utf8");
  const pages = new Map<string, Image>();
  const atlas = new core.TextureAtlas(atlasText);
  for (const page of atlas.pages) {
    const img = decodePng(new Uint8Array(readFileSync(join(dirname(r.files.atlas), page.name))));
    pages.set(page.name, img);
    page.setTexture({ getImage: () => ({ width: img.width, height: img.height }), setFilters() {}, setWraps() {}, dispose() {} } as any);
  }
  const data = new core.SkeletonJson(new core.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(readFileSync(r.files.json, "utf8")));
  const skeleton = new core.Skeleton(data);
  const anim = data.findAnimation(shot.attach.animation)!;

  // fixed framing: the character's bounds over the animation, plus margin
  const poses = shot.times ?? Array.from({ length: shot.frames }, (_, i) => (anim.duration * (i + 0.5)) / shot.frames);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pose = (t: number) => { skeleton.setToSetupPose(); anim.apply(skeleton, 0, t, true, [], 1, core.MixBlend.setup, core.MixDirection.in); skeleton.updateWorldTransform(core.Physics.pose); };
  for (const t of poses) {
    pose(t);
    const off = new core.Vector2(), size = new core.Vector2();
    skeleton.getBounds(off, size, []);
    minX = Math.min(minX, off.x); minY = Math.min(minY, off.y); maxX = Math.max(maxX, off.x + size.x); maxY = Math.max(maxY, off.y + size.y);
  }
  const side = Math.max(maxX - minX, maxY - minY) * 1.08;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, scale = CELL / side;

  const W = shot.frames * CELL + (shot.frames + 1) * 2, H = CELL + 4;
  const buf = new Float32Array(W * H * 3).fill(10 / 255);
  poses.forEach((t, fi) => {
    const ox = 2 + fi * (CELL + 2), oy = 2;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) buf.set(BG.map((c) => c / 255), ((oy + y) * W + ox + x) * 3);
    pose(t);
    for (const slot of skeleton.drawOrder) {
      const att: any = slot.getAttachment();
      if (!att || !(att instanceof core.RegionAttachment || att instanceof core.MeshAttachment)) continue;
      const region: any = att.region;
      const img = pages.get(region.page.name)!;
      let verts: number[], uvs: ArrayLike<number>, tris: ArrayLike<number>;
      if (att instanceof core.RegionAttachment) {
        const v = new Float32Array(8);
        att.computeWorldVertices(slot, v, 0, 2);
        verts = [...v]; uvs = att.uvs; tris = [0, 1, 2, 2, 3, 0];
      } else {
        const v = new Float32Array(att.worldVerticesLength);
        att.computeWorldVertices(slot, 0, att.worldVerticesLength, v, 0, 2);
        verts = [...v]; uvs = att.uvs; tris = att.triangles;
      }
      const c = slot.color, ac = att.color;
      const tint = [c.r * ac.r, c.g * ac.g, c.b * ac.b, c.a * ac.a];
      const additive = slot.data.blendMode === core.BlendMode.Additive;
      const sx = (i: number) => (verts[i * 2] - (cx - side / 2)) * scale, sy = (i: number) => CELL - (verts[i * 2 + 1] - (cy - side / 2)) * scale;
      for (let k = 0; k < tris.length; k += 3) {
        const [a, b, d] = [tris[k], tris[k + 1], tris[k + 2]];
        triangle(buf, W, ox, oy, [sx(a), sy(a), sx(b), sy(b), sx(d), sy(d)], [uvs[a * 2], uvs[a * 2 + 1], uvs[b * 2], uvs[b * 2 + 1], uvs[d * 2], uvs[d * 2 + 1]], img, tint, additive, r.stats && true);
      }
    }
  });
  const out = createImage(W, H);
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(buf[i * 3 + c] * 255))), out.data[i * 4 + 3] = 255;
  writeFileSync(join("docs", "media", shot.out), encodePng(out));
  console.log(`docs/media/${shot.out}  (+${r.stats.addedBones} bones, follow error ${r.followError ?? "n/a"})`);
}

/** Premultiplied textured triangle with bilinear sampling: normal = src + dst·(1−a), additive = src + dst. */
function triangle(buf: Float32Array, W: number, ox: number, oy: number, p: number[], uv: number[], tex: Image, tint: number[], additive: boolean, _: boolean) {
  const [x0, y0, x1, y1, x2, y2] = p;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-6) return;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(CELL - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(CELL - 1, Math.ceil(Math.max(y0, y1, y2)));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
    const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const s = sample(tex, (w0 * uv[0] + w1 * uv[2] + w2 * uv[4]) * tex.width - 0.5, (w0 * uv[1] + w1 * uv[3] + w2 * uv[5]) * tex.height - 0.5);
    // premultiplied texel × tint (tint alpha scales everything)
    const a = s[3] * tint[3];
    if (a <= 0 && !additive) continue;
    const o = ((oy + y) * W + ox + x) * 3;
    for (let c = 0; c < 3; c++) {
      const src = s[c] * tint[c] * tint[3];
      buf[o + c] = additive ? buf[o + c] + src : src + buf[o + c] * (1 - a);
    }
  }
}

function sample(t: Image, u: number, v: number): number[] {
  const x0 = Math.max(0, Math.min(t.width - 1, Math.floor(u))), y0 = Math.max(0, Math.min(t.height - 1, Math.floor(v)));
  const x1 = Math.min(t.width - 1, x0 + 1), y1 = Math.min(t.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
  const px = (x: number, y: number, c: number) => t.data[(y * t.width + x) * 4 + c] / 255;
  return [0, 1, 2, 3].map((c) => (px(x0, y0, c) * (1 - fx) + px(x1, y0, c) * fx) * (1 - fy) + (px(x0, y1, c) * (1 - fx) + px(x1, y1, c) * fx) * fy);
}
