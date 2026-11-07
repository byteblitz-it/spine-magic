import type { Effect } from "./schema.js";
import type { Simulation, PState } from "./simulate.js";
import { createImage, type Image } from "./png.js";
import { builtinTexture, type TextureResolver } from "./textures.js";
import { DEG } from "./math.js";

export interface PreviewOptions {
  /** Number of frames sampled evenly across the animation. */
  frames?: number;
  /** Max edge of each cell in pixels. */
  cellSize?: number;
  columns?: number;
  background?: [number, number, number];
  resolveTexture?: TextureResolver;
  /** draw the green origin cross (default true) */
  showOrigin?: boolean;
}

export interface PreviewResult {
  image: Image;
  frameIndices: number[];
  times: number[];
  /** World-space bounds that each cell shows. */
  bounds: { x: number; y: number; width: number; height: number };
}

/** Renders a contact sheet of the simulation (y up, like Spine). */
export function renderPreview(effect: Effect, sim: Simulation, opts: PreviewOptions = {}): PreviewResult {
  const count = Math.max(1, Math.min(24, opts.frames ?? 8));
  const cell = Math.max(64, Math.min(512, opts.cellSize ?? 256));
  const cols = Math.max(1, Math.min(count, opts.columns ?? 4));
  const rows = Math.ceil(count / cols);
  const bg = opts.background ?? [24, 26, 32];
  const last = sim.loop ? sim.frames - 1 : sim.frames - 1;
  const frameIndices = Array.from({ length: count }, (_, i) => (count === 1 ? Math.floor(last / 2) : Math.round((i * last) / (count - 1))));

  // per-frame visible particles
  const visible = (f: number) => {
    const out: { s: PState; emitter: number }[] = [];
    for (const t of sim.emitters) for (const p of t.particles) {
      // same rule as lane baking: a looping particle is shown for at most one loop length
      const j = sim.loop ? (((f - p.startFrame) % sim.frames) + sim.frames) % sim.frames : f - p.startFrame;
      const len = sim.loop ? Math.min(p.samples.length, sim.frames) : p.samples.length;
      if (j >= 0 && j < len) out.push({ s: p.samples[j], emitter: t.index });
    }
    return out;
  };

  // bounds over all frames, square, with margin
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of sim.emitters) for (const p of t.particles) for (const s of p.samples) {
    const h = Math.max(s.size, s.sizeY) / 2;
    minX = Math.min(minX, s.x - h); maxX = Math.max(maxX, s.x + h);
    minY = Math.min(minY, s.y - h); maxY = Math.max(maxY, s.y + h);
  }
  if (!isFinite(minX)) { minX = -50; minY = -50; maxX = 50; maxY = 50; }
  const side = Math.max(maxX - minX, maxY - minY, 1) * 1.1;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const bounds = { x: cx - side / 2, y: cy - side / 2, width: side, height: side };
  const scale = cell / side;

  const img = createImage(cols * cell + (cols + 1) * 2, rows * cell + (rows + 1) * 2);
  const W = img.width;
  const buf = new Float32Array(W * img.height * 3);
  for (let i = 0; i < W * img.height; i++) buf.set([10 / 255, 10 / 255, 12 / 255], i * 3);

  const load = opts.resolveTexture ?? builtinTexture;
  const textures = effect.emitters.map((e) => (e.enabled ? load(e.texture) : null));

  frameIndices.forEach((f, ci) => {
    const ox = 2 + (ci % cols) * (cell + 2), oy = 2 + Math.floor(ci / cols) * (cell + 2);
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) buf.set([bg[0] / 255, bg[1] / 255, bg[2] / 255], ((oy + y) * W + ox + x) * 3);
    // origin cross
    const [ax, ay] = [(0 - bounds.x) * scale, cell - (0 - bounds.y) * scale];
    if (opts.showOrigin !== false) for (let k = -4; k <= 4; k++) {
      plot(buf, W, ox, oy, cell, Math.round(ax + k), Math.round(ay), [0.3, 0.8, 0.4]);
      plot(buf, W, ox, oy, cell, Math.round(ax), Math.round(ay + k), [0.3, 0.8, 0.4]);
    }
    for (const { s, emitter } of visible(f)) {
      const tex = textures[emitter];
      if (!tex) continue;
      drawSprite(buf, W, ox, oy, cell, tex.image, s, (s.x - bounds.x) * scale, cell - (s.y - bounds.y) * scale, scale, effect.emitters[emitter].blend, effect.emitters[emitter].pivot);
    }
  });

  for (let i = 0; i < W * img.height; i++) {
    img.data[i * 4] = to8(buf[i * 3]); img.data[i * 4 + 1] = to8(buf[i * 3 + 1]); img.data[i * 4 + 2] = to8(buf[i * 3 + 2]); img.data[i * 4 + 3] = 255;
  }
  return { image: img, frameIndices, times: frameIndices.map((f) => Math.round((f / sim.fps) * 1000) / 1000), bounds };
}

function plot(buf: Float32Array, W: number, ox: number, oy: number, cell: number, x: number, y: number, c: number[]) {
  if (x < 0 || y < 0 || x >= cell || y >= cell) return;
  buf.set(c, ((oy + y) * W + ox + x) * 3);
}

function drawSprite(buf: Float32Array, W: number, ox: number, oy: number, cell: number, tex: Image, s: PState, px: number, py: number, scale: number, blend: string, pivot: [number, number]) {
  const texMax = Math.max(tex.width, tex.height);
  const kx = (s.size / texMax) * scale, ky = (s.sizeY / texMax) * scale; // texture px → screen px
  if (kx * tex.width < 0.1 || ky * tex.height < 0.1 || s.a <= 0) return;
  // screen y is down, so the on-screen rotation is negated
  const cos = Math.cos(-s.rotation * DEG), sin = Math.sin(-s.rotation * DEG);
  const ext = Math.hypot(Math.max(pivot[0], 1 - pivot[0]) * tex.width * kx, Math.max(pivot[1], 1 - pivot[1]) * tex.height * ky);
  const x0 = Math.max(0, Math.floor(px - ext)), x1 = Math.min(cell - 1, Math.ceil(px + ext));
  const y0 = Math.max(0, Math.floor(py - ext)), y1 = Math.min(cell - 1, Math.ceil(py + ext));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - px, dy = y + 0.5 - py;
    // inverse rotate into sprite space (origin = pivot)
    const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
    const u = lx / kx + pivot[0] * tex.width, v = ly / ky + pivot[1] * tex.height;
    if (u < 0 || v < 0 || u >= tex.width || v >= tex.height) continue;
    const ti = (Math.floor(v) * tex.width + Math.floor(u)) * 4;
    const a = (tex.data[ti + 3] / 255) * s.a;
    if (a <= 0) continue;
    const sr = (tex.data[ti] / 255) * s.r, sg = (tex.data[ti + 1] / 255) * s.g, sb = (tex.data[ti + 2] / 255) * s.b;
    const o = ((oy + y) * W + ox + x) * 3;
    const d = [buf[o], buf[o + 1], buf[o + 2]];
    const src = [sr, sg, sb];
    for (let c = 0; c < 3; c++) {
      switch (blend) {
        case "additive": d[c] += src[c] * a; break;
        case "multiply": d[c] *= 1 - a + src[c] * a; break;
        case "screen": d[c] = 1 - (1 - d[c]) * (1 - src[c] * a); break;
        default: d[c] = src[c] * a + d[c] * (1 - a);
      }
    }
    buf[o] = d[0]; buf[o + 1] = d[1]; buf[o + 2] = d[2];
  }
}

const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
