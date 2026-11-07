import type { Emitter } from "./schema.js";
import { DEG } from "./math.js";

type P = [number, number];
interface Path { length: number; pts: P[]; cum: number[] }

const cache = new WeakMap<object, Path>();

/** Dense polyline through the control points (Catmull-Rom when smooth), with cumulative arc length. */
export function buildPath(m: Emitter["motion"]): Path {
  const hit = cache.get(m);
  if (hit) return hit;
  const src = m.points as P[];
  const n = src.length;
  const get = (i: number): P => (m.closed ? src[((i % n) + n) % n] : src[Math.max(0, Math.min(n - 1, i))]);
  const segs = m.closed ? n : n - 1;
  const pts: P[] = [];
  const STEPS = m.smooth ? 24 : 1;
  for (let s = 0; s < segs; s++) {
    const p0 = get(s - 1), p1 = get(s), p2 = get(s + 1), p3 = get(s + 2);
    for (let k = 0; k < STEPS; k++) {
      const t = k / STEPS;
      if (!m.smooth) { pts.push([p1[0], p1[1]]); continue; }
      const t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(m.closed ? [src[0][0], src[0][1]] : [src[n - 1][0], src[n - 1][1]]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const path = { length: cum[cum.length - 1], pts, cum };
  cache.set(m, path);
  return path;
}

/** Point at fraction u (0..1): by arc length, or by parameter when `byTime` (dense points are evenly spaced per segment). */
export function pathAt(path: Path, u: number, byTime = false): P {
  if (byTime) {
    const f = Math.max(0, Math.min(1, u)) * (path.pts.length - 1);
    const i = Math.min(path.pts.length - 2, Math.floor(f)), k = f - i;
    const a = path.pts[i], b = path.pts[i + 1] ?? a;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  const d = Math.max(0, Math.min(1, u)) * path.length;
  let lo = 0, hi = path.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path.cum[mid] < d) lo = mid; else hi = mid; }
  const span = path.cum[hi] - path.cum[lo] || 1;
  const k = (d - path.cum[lo]) / span;
  const a = path.pts[lo], b = path.pts[hi];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

function phase(m: Emitter["motion"], duration: number, t: number): number {
  const p = (t / duration) * m.loops;
  if (m.mode === "once") return Math.max(0, Math.min(1, p));
  if (m.mode === "pingpong") { const q = ((p % 2) + 2) % 2; return q > 1 ? 2 - q : q; }
  return p - Math.floor(p);
}

/** Emitter path offset at effect time t, in the emitter's parent space (rotation + scale applied, no translation). */
export function emitterOffset(e: Emitter, duration: number, t: number): P {
  if (!e.motion.enabled) return [0, 0];
  const [x, y] = pathAt(buildPath(e.motion), phase(e.motion, duration, t), e.motion.timing === "time");
  const c = Math.cos(e.transform.rotation * DEG), s = Math.sin(e.transform.rotation * DEG), k = e.transform.scale;
  return [(x * c - y * s) * k, (x * s + y * c) * k];
}

/** World-space emitter origin at effect time t. */
export function emitterOrigin(e: Emitter, duration: number, t: number): P {
  const [ox, oy] = emitterOffset(e, duration, t);
  return [e.transform.x + ox, e.transform.y + oy];
}

/** Emitter velocity (px/s) at effect time t, by central difference. */
export function emitterVelocity(e: Emitter, duration: number, t: number): P {
  if (!e.motion.enabled) return [0, 0];
  const h = Math.min(1 / 240, duration / 1000);
  let ta = t - h, tb = t + h;
  if (e.motion.mode === "once") { ta = Math.max(0, ta); tb = Math.min(duration / e.motion.loops, tb); }
  const a = emitterOffset(e, duration, ta), b = emitterOffset(e, duration, tb);
  const dt = tb - ta || 1;
  return [(b[0] - a[0]) / dt, (b[1] - a[1]) / dt];
}
