// Builds the sample characters (knight, wizard) from art/sample-characters.png as Spine 3.8 and 4.2 skeletons.
// Each character is one sprite on a "body" bone that leans, bobs and lunges, plus anchor bones placed on the art
// (sword tip, grip, staff orb, gems) for attach_effect. Pages are premultiplied, like Spine's default export.
// Usage: npx tsx scripts/make-sample-characters.ts  → samples/characters/<name>-<version>/
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAtlas, createImage, decodePng, encodePng, type Image } from "../src/core/index.js";

const SCALE = 0.5;
const src = decodePng(new Uint8Array(readFileSync(join("art", "sample-characters.png"))));

/** Crops [x0,x1)×[y0,y1) and downsamples by 2 with alpha-weighted averaging, then premultiplies. */
function cutout(x0: number, y0: number, x1: number, y1: number): Image {
  const w = Math.ceil((x1 - x0) * SCALE), h = Math.ceil((y1 - y0) * SCALE);
  const out = createImage(w, h);
  const k = Math.round(1 / SCALE);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const sx = x0 + x * k + dx, sy = y0 + y * k + dy;
      n++;
      if (sx >= src.width || sy >= src.height) continue;
      const i = (sy * src.width + sx) * 4, al = src.data[i + 3];
      r += src.data[i] * al; g += src.data[i + 1] * al; b += src.data[i + 2] * al; a += al;
    }
    const alpha = a / n;
    // premultiplied: colour × alpha (the alpha-weighted mean colour times the coverage)
    const o = (y * w + x) * 4;
    if (a > 0) out.data.set([Math.round((r / a) * alpha / 255), Math.round((g / a) * alpha / 255), Math.round((b / a) * alpha / 255), Math.round(alpha)], o);
  }
  return out;
}

interface Def {
  name: string;
  /** source-pixel crop and the point between the feet (skeleton origin) */
  box: [number, number, number, number];
  feet: [number, number];
  /** where the body bone (the pivot for leaning and swinging) sits, source pixels; default = feet */
  pivot?: [number, number];
  /** anchor bones under "body", at source-pixel positions */
  anchors: Record<string, [number, number]>;
  animations: (v3: boolean) => Record<string, unknown>;
}

const rot = (v3: boolean, time: number, angle: number, curve?: boolean) => ({ time, ...(v3 ? { angle } : { value: angle }), ...(curve ? smooth(v3) : {}) });
const tr = (v3: boolean, time: number, x: number, y: number, curve?: boolean) => ({ time, x, y, ...(curve ? smooth(v3) : {}) });
const sc = (v3: boolean, time: number, x: number, y: number, curve?: boolean) => ({ time, x, y, ...(curve ? smooth(v3) : {}) });
/** ease in-out to the next key. 3.8: normalized curve/c2/c3/c4. 4.x needs absolute handles per value, filled in by ease4x(). */
const smooth = (v3: boolean) => (v3 ? { curve: 0.42, c2: 0, c3: 0.58, c4: 1 } : { _ease: true });

/** 4.x bezier: [cx1, cy1, cx2, cy2] per value channel, in time/value units, for keys marked _ease. */
function ease4x(animations: Record<string, any>) {
  for (const anim of Object.values<any>(animations)) for (const tls of Object.values<any>(anim.bones ?? {})) for (const keys of Object.values<any[]>(tls)) {
    keys.forEach((k, i) => {
      const next = keys[i + 1];
      if (!k._ease || !next) { delete k._ease; return; }
      delete k._ease;
      const t0 = k.time, t1 = next.time;
      const channels = "value" in k ? ["value"] : ["x", "y"];
      k.curve = channels.flatMap((c) => [t0 + (t1 - t0) * 0.42, k[c], t0 + (t1 - t0) * 0.58, next[c]]);
    });
  }
  return animations;
}

const DEFS: Def[] = [
  {
    name: "knight",
    box: [36, 54, 728, 840],
    feet: [470, 835],
    pivot: [470, 560],
    anchors: { sword_tip: [640, 770], blade_mid: [485, 695], grip: [255, 580], chest: [440, 385], head: [470, 210] },
    animations: (v3) => ({
      idle: { bones: {
        body: { scale: [sc(v3, 0, 1, 1, true), sc(v3, 0.6, 1, 1.025, true), sc(v3, 1.2, 1, 1)], rotate: [rot(v3, 0, 0, true), rot(v3, 0.6, -1, true), rot(v3, 1.2, 0)] },
      } },
      // a hop-slash pivoting at the hip: wind up raises the blade, the slash sweeps the tip down through a wide arc
      attack: { bones: {
        body: {
          rotate: [rot(v3, 0, 0, true), rot(v3, 0.3, 40, true), rot(v3, 0.5, -30, true), rot(v3, 0.9, 0)],
          translate: [tr(v3, 0, 0, 0, true), tr(v3, 0.3, -12, 8, true), tr(v3, 0.5, 34, 24, true), tr(v3, 0.9, 0, 0)],
        },
      } },
      walk: { bones: {
        body: {
          translate: [tr(v3, 0, 0, 0, true), tr(v3, 0.25, 0, 10, true), tr(v3, 0.5, 0, 0, true), tr(v3, 0.75, 0, 10, true), tr(v3, 1, 0, 0)],
          rotate: [rot(v3, 0, -2, true), rot(v3, 0.5, 2, true), rot(v3, 1, -2)],
        },
      } },
    }),
  },
  {
    name: "wizard",
    box: [968, 46, 1742, 842],
    feet: [1300, 835],
    anchors: { staff_orb: [1663, 300], staff_hand: [1505, 520], hat_gem: [1360, 190], chest_gem: [1310, 470], potion: [1262, 640] },
    animations: (v3) => ({
      idle: { bones: {
        body: {
          translate: [tr(v3, 0, 0, 0, true), tr(v3, 0.8, 0, 6, true), tr(v3, 1.6, 0, 0)],
          rotate: [rot(v3, 0, 0, true), rot(v3, 0.8, 1.5, true), rot(v3, 1.6, 0)],
        },
      } },
      // rises, rears back and thrusts the staff forward
      cast: { bones: {
        body: {
          translate: [tr(v3, 0, 0, 0, true), tr(v3, 0.3, -6, 16, true), tr(v3, 0.55, 14, 10, true), tr(v3, 1, 0, 0)],
          rotate: [rot(v3, 0, 0, true), rot(v3, 0.3, 5, true), rot(v3, 0.55, -7, true), rot(v3, 1, 0)],
          scale: [sc(v3, 0, 1, 1, true), sc(v3, 0.3, 1.03, 1.03, true), sc(v3, 1, 1, 1)],
        },
      } },
    }),
  },
];

for (const d of DEFS) {
  const [x0, y0, x1, y1] = d.box;
  const [fx, fy] = d.feet;
  const at = (px: number, py: number) => ({ x: r2((px - fx) * SCALE), y: r2((fy - py) * SCALE) });
  const [bx, by] = d.pivot ?? d.feet;
  const bodyAt = at(bx, by);
  /** position relative to the body bone */
  const rel = (px: number, py: number) => { const p = at(px, py); return { x: r2(p.x - bodyAt.x), y: r2(p.y - bodyAt.y) }; };
  const image = cutout(x0, y0, x1, y1);
  const atlas = buildAtlas(d.name, [{ name: d.name, image }]);
  const centre = rel((x0 + x1) / 2, (y0 + y1) / 2);
  for (const version of ["3.8", "4.2"] as const) {
    const v3 = version === "3.8";
    const json = {
      skeleton: { hash: d.name, spine: v3 ? "3.8.99" : "4.2.43", x: r2((x0 - fx) * SCALE), y: 0, width: image.width, height: image.height, images: "./", audio: "" },
      bones: [
        { name: "root" },
        { name: "body", parent: "root", ...bodyAt, color: "ffffffff" },
        ...Object.entries(d.anchors).map(([name, [px, py]]) => ({ name, parent: "body", ...rel(px, py), color: "ffcc00ff" })),
      ],
      slots: [{ name: d.name, bone: "body", attachment: d.name }],
      skins: [{ name: "default", attachments: { [d.name]: { [d.name]: { ...centre, width: image.width, height: image.height } } } }],
      animations: v3 ? d.animations(v3) : ease4x(d.animations(v3)),
    };
    const dir = join("samples", "characters", `${d.name}-${version}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${d.name}.json`), JSON.stringify(json, null, 2));
    // 4.x atlases record premultiplied alpha; 3.8 atlases cannot (Spine assumes it)
    writeFileSync(join(dir, `${d.name}.atlas`), v3 ? atlas.text : atlas.text.replace(/^repeat: none$/m, "repeat: none\npma: true"));
    writeFileSync(join(dir, atlas.pageName), encodePng(atlas.page));
    console.log(`wrote ${dir}`);
  }
}

function r2(v: number) { return Math.round(v * 100) / 100; }
