// Ribbon trails: a textured triangle strip following the emitter's recent path.
// Baked as one Spine mesh attachment whose vertices are keyed per frame (deform timeline).
import type { Emitter } from "./schema.js";
import { evalCurve } from "./math.js";
import { emitterOrigin } from "./motion.js";

export interface RibbonMesh {
  /** [x0, y0, x1, y1, ...] — two vertices (left, right) per point, head first */
  vertices: number[];
  /** matching UVs: u = 0 at the head, 1 at the tail; v = 0 left edge, 1 right edge */
  uvs: number[];
  triangles: number[];
}

/** Static topology for `segments` quads. */
export function ribbonTopology(segments: number): { uvs: number[]; triangles: number[]; hull: number } {
  const uvs: number[] = [], triangles: number[] = [];
  for (let i = 0; i <= segments; i++) { const u = i / segments; uvs.push(u, 0, u, 1); }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    triangles.push(a, b, c, b, d, c);
  }
  return { uvs, triangles, hull: (segments + 1) * 2 };
}

/**
 * Ribbon vertices at effect time t, in effect (skeleton root) space.
 * `period` is the motion period; `loop` wraps history before t=0 (seamless loops), otherwise it is clamped (the ribbon grows).
 */
export function ribbonVertices(e: Emitter, period: number, t: number, loop: boolean): number[] {
  const r = e.ribbon;
  const n = r.segments;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    let ti = t - (i / n) * r.length;
    if (!loop) ti = Math.max(0, ti);
    pts.push(emitterOrigin(e, period, ti));
  }
  const out: number[] = [];
  let nx = 0, ny = 1;
  for (let i = 0; i <= n; i++) {
    // tangent from neighbours; keep the last good normal where points coincide
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    const dx = a[0] - b[0], dy = a[1] - b[1], len = Math.hypot(dx, dy);
    if (len > 1e-6) { nx = -dy / len; ny = dx / len; }
    const w = (r.width * Math.max(0, evalCurve(r.widthOverLength, i / n))) / 2;
    out.push(pts[i][0] + nx * w, pts[i][1] + ny * w, pts[i][0] - nx * w, pts[i][1] - ny * w);
  }
  return out;
}

export function ribbonMesh(e: Emitter, period: number, t: number, loop: boolean): RibbonMesh {
  const topo = ribbonTopology(e.ribbon.segments);
  return { vertices: ribbonVertices(e, period, t, loop), uvs: topo.uvs, triangles: topo.triangles };
}
