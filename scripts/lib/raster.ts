// Software rasterizer for posed Spine 4.2 skeletons (region + mesh attachments, premultiplied pages, normal/additive).
// Used by the scripts that render README images and rig previews.
import type { Image } from "../../src/core/png.js";

export interface Frame { buf: Float32Array; W: number; H: number }

export function newFrame(W: number, H: number, rgb: number[]): Frame {
  const buf = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) buf.set(rgb.map((c) => c / 255), i * 3);
  return { buf, W, H };
}

/** Draws every visible region/mesh attachment of a posed skeleton into the cell at (ox, oy), size cw×ch. */
export function drawSkeleton(core: any, skeleton: any, pages: Map<string, Image>, f: Frame, cell: { ox: number; oy: number; cw: number; ch: number }, view: { x: number; y: number; scale: number }) {
  for (const slot of skeleton.drawOrder) {
    const att: any = slot.getAttachment();
    if (!att || !(att instanceof core.RegionAttachment || att instanceof core.MeshAttachment)) continue;
    const img = pages.get(att.region.page.name)!;
    let verts: Float32Array, uvs: ArrayLike<number>, tris: ArrayLike<number>;
    if (att instanceof core.RegionAttachment) {
      verts = new Float32Array(8);
      att.computeWorldVertices(slot, verts, 0, 2);
      uvs = att.uvs; tris = [0, 1, 2, 2, 3, 0];
    } else {
      verts = new Float32Array(att.worldVerticesLength);
      att.computeWorldVertices(slot, 0, att.worldVerticesLength, verts, 0, 2);
      uvs = att.uvs; tris = att.triangles;
    }
    const c = slot.color, ac = att.color;
    const tint = [c.r * ac.r, c.g * ac.g, c.b * ac.b, c.a * ac.a];
    const additive = slot.data.blendMode === core.BlendMode.Additive;
    // view.x/y = world point at the cell centre
    const sx = (i: number) => cell.cw / 2 + (verts[i * 2] - view.x) * view.scale;
    const sy = (i: number) => cell.ch / 2 - (verts[i * 2 + 1] - view.y) * view.scale;
    for (let k = 0; k < tris.length; k += 3) {
      const [a, b, d] = [tris[k], tris[k + 1], tris[k + 2]];
      triangle(f, cell, [sx(a), sy(a), sx(b), sy(b), sx(d), sy(d)], [uvs[a * 2], uvs[a * 2 + 1], uvs[b * 2], uvs[b * 2 + 1], uvs[d * 2], uvs[d * 2 + 1]], img, tint, additive);
    }
  }
}

/** Premultiplied textured triangle with bilinear sampling: normal = src + dst·(1−a), additive = src + dst. */
function triangle(f: Frame, cell: { ox: number; oy: number; cw: number; ch: number }, p: number[], uv: number[], tex: Image, tint: number[], additive: boolean) {
  const [x0, y0, x1, y1, x2, y2] = p;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-6) return;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(cell.cw - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(cell.ch - 1, Math.ceil(Math.max(y0, y1, y2)));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
    const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const s = sample(tex, (w0 * uv[0] + w1 * uv[2] + w2 * uv[4]) * tex.width - 0.5, (w0 * uv[1] + w1 * uv[3] + w2 * uv[5]) * tex.height - 0.5);
    const a = s[3] * tint[3];
    if (a <= 0 && !additive) continue;
    const o = ((cell.oy + y) * f.W + cell.ox + x) * 3;
    for (let c = 0; c < 3; c++) {
      const src = s[c] * tint[c] * tint[3];
      f.buf[o + c] = additive ? f.buf[o + c] + src : src + f.buf[o + c] * (1 - a);
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

/** Frame → RGBA image */
export function toImage(f: Frame, createImage: (w: number, h: number) => Image): Image {
  const out = createImage(f.W, f.H);
  for (let i = 0; i < f.W * f.H; i++) {
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(f.buf[i * 3 + c] * 255)));
    out.data[i * 4 + 3] = 255;
  }
  return out;
}
