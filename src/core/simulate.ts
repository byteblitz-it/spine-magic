import { emitterSprites, type Effect, type Emitter } from "./schema.js";
import { DEG, evalCurve, evalGradient, hash, hexToRgb, noise2, rangeMax, rng, sample } from "./math.js";
import { emitterOrigin, emitterVelocity } from "./motion.js";

/** Particle state at one frame, in world space (skeleton coordinates, y up). */
export interface PState {
  x: number;
  y: number;
  rotation: number; // degrees, unwrapped (continuous)
  size: number; // width in pixels (longest texture edge maps to this)
  sizeY: number; // height scale in pixels on the same basis (== size unless stretched / separate axes)
  r: number;
  g: number;
  b: number;
  a: number;
  /** index into emitterSprites(emitter) */
  frame: number;
}

export interface Particle {
  /** Absolute frame index of samples[0]; with looping, frames wrap modulo `frames`. */
  startFrame: number;
  samples: PState[];
}

export interface EmitterTrack {
  index: number;
  emitter: Emitter;
  particles: Particle[];
}

export interface Simulation {
  fps: number;
  /** Number of frames in the animation (loop: frame `frames` == frame 0). */
  frames: number;
  loop: boolean;
  /** Emission / motion period in seconds (loop length, or emission duration). */
  period: number;
  emitters: EmitterTrack[];
}

const SUBSTEP = 1 / 120;

export function frameCount(effect: Effect): number {
  if (effect.loop) return Math.max(1, Math.round(effect.duration * effect.fps));
  const maxLife = Math.max(0, ...effect.emitters.map((e) => rangeMax(e.initial.lifetime)));
  return Math.ceil((effect.duration + maxLife) * effect.fps) + 1;
}

export function simulate(effect: Effect): Simulation {
  const frames = frameCount(effect);
  const period = effect.loop ? frames / effect.fps : effect.duration;
  const emitters = effect.emitters.map((emitter, index) => ({
    index,
    emitter,
    particles: emitter.enabled ? simulateEmitter(effect, emitter, index, period) : [],
  }));
  return { fps: effect.fps, frames, loop: effect.loop, period, emitters };
}

interface Spawn { time: number; spreadFrac: number }

/**
 * Spawn times from an emission density = rate × rateOverTime(t) + rateOverDistance × emitter speed.
 * Looping: a whole number of particles spread over the period (seamless). Otherwise one per unit of density.
 */
export function spawnSchedule(e: Emitter, period: number, loop: boolean): Spawn[] {
  const out: Spawn[] = [];
  const em = e.emission;
  const continuous = em.type === "continuous" && em.rate > 0;
  const byDistance = e.motion.enabled && em.rateOverDistance > 0;
  if (continuous || byDistance) {
    const M = Math.max(240, Math.ceil(period * 240));
    const density = (t: number) => {
      let d = continuous ? em.rate * Math.max(0, em.rateOverTime ? evalCurve(em.rateOverTime, t / period) : 1) : 0;
      if (byDistance) { const [vx, vy] = emitterVelocity(e, period, t); d += (em.rateOverDistance / 100) * Math.hypot(vx, vy); }
      return d;
    };
    const cum = new Float64Array(M + 1);
    let prev = density(0);
    for (let i = 1; i <= M; i++) {
      const cur = density((i / M) * period);
      cum[i] = cum[i - 1] + ((prev + cur) / 2) * (period / M);
      prev = cur;
    }
    const total = cum[M];
    const count = loop ? Math.round(total) : Math.floor(total + 1e-9);
    const invert = (c: number) => {
      let lo = 0, hi = M;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] < c) lo = mid; else hi = mid; }
      const span = cum[hi] - cum[lo];
      return ((lo + (span > 0 ? (c - cum[lo]) / span : 0)) / M) * period;
    };
    // the first spawn lands at the first moment there is any density (t=0 for a constant rate)
    for (let k = 0; k < count; k++) {
      const c = loop ? (k * total) / count : k;
      out.push({ time: Math.min(invert(c + 1e-9), period - 1e-9), spreadFrac: (k * 0.6180339887498949) % 1 });
    }
  }
  if (em.type === "burst") {
    for (const b of em.bursts) {
      if (!loop && b.time >= period) continue;
      const t = loop ? b.time % period : b.time;
      for (let j = 0; j < b.count; j++) {
        const frac = b.count === 1 ? 0.5 : e.direction.spread >= 360 ? j / b.count : j / (b.count - 1);
        out.push({ time: t, spreadFrac: frac });
      }
    }
  }
  return out;
}

function simulateEmitter(effect: Effect, e: Emitter, emitterIndex: number, period: number): Particle[] {
  const fps = effect.fps;
  const tf = e.transform;
  const local = e.simulationSpace === "local";
  const cosR = Math.cos(tf.rotation * DEG), sinR = Math.sin(tf.rotation * DEG);
  /** emitter-local vector → world axes (rotation + scale, no translation) */
  const toAxes = (x: number, y: number): [number, number] => [(x * cosR - y * sinR) * tf.scale, (x * sinR + y * cosR) * tf.scale];
  const baseColor = hexToRgb(e.initial.color);
  const noiseSeed = hash(effect.seed, emitterIndex, 999);
  const affectors = e.affectors.filter((a) => a.enabled);
  const stretch = affectors.find((a) => a.type === "velocityStretch");
  const sp = e.sprite;
  const nFrames = emitterSprites(e).length;

  return spawnSchedule(e, period, effect.loop).map(({ time: birth, spreadFrac }, i) => {
    const rand = rng(hash(effect.seed, emitterIndex, i));
    const life = Math.max(1e-3, sample(e.initial.lifetime, rand));

    // spawn position + direction (emitter local)
    const [lx, ly, outward] = spawnPoint(e, rand);
    let dirDeg = e.direction.angle;
    if (e.direction.mode === "outward" && outward !== null) dirDeg = outward;
    const jitter = rand() - 0.5; // always drawn so switching distribution keeps other randoms stable
    dirDeg += (e.direction.distribution === "uniform" ? spreadFrac - 0.5 : jitter) * e.direction.spread;
    const speed = sample(e.initial.speed, rand) * tf.scale;
    const worldDir = (dirDeg + tf.rotation) * DEG;

    // `x, y` are world coordinates (world space) or coordinates relative to the moving emitter (local space)
    const [ox, oy] = emitterOrigin(e, period, birth);
    const [sx0, sy0] = toAxes(lx, ly);
    let x = local ? sx0 : ox + sx0, y = local ? sy0 : oy + sy0;
    let vx = Math.cos(worldDir) * speed, vy = Math.sin(worldDir) * speed;
    if (tf.inheritVelocity !== 0) {
      const [evx, evy] = emitterVelocity(e, period, birth);
      vx += evx * tf.inheritVelocity; vy += evy * tf.inheritVelocity;
    }
    const size0 = sample(e.initial.size, rand) * tf.scale;
    let rot = sample(e.initial.rotation, rand);
    const angVel = sample(e.initial.angularVelocity, rand);
    const alpha0 = sample(e.initial.alpha, rand);
    const weight = Math.max(0.01, sample(e.initial.weight, rand));
    const windStrength = affectors.map((a) => (a.type === "wind" ? sample(a.strength, rand) : 0));
    // own stream, so adding frames never changes the other randoms of existing effects
    const randomFrame = Math.floor(rng(hash(effect.seed, emitterIndex, i, 77))() * nFrames) % nFrames;
    const frameAt = (age: number, t: number): number => {
      if (nFrames === 1) return 0;
      if (sp.mode === "random") return randomFrame;
      let k = sp.fps > 0 ? Math.floor(age * sp.fps + 1e-6) : Math.min(nFrames - 1, Math.floor(t * nFrames));
      if (sp.randomStart) k += randomFrame;
      return sp.loop ? k % nFrames : Math.min(nFrames - 1, k);
    };

    const worldPos = (t: number): [number, number] => {
      if (!local) return [x, y];
      const [cx, cy] = emitterOrigin(e, period, t);
      return [cx + x, cy + y];
    };
    const centre = (ax: number, ay: number, t: number): [number, number] => {
      const [cx, cy] = local ? [0, 0] : emitterOrigin(e, period, t);
      const [dx, dy] = toAxes(ax, ay);
      return [cx + dx, cy + dy];
    };

    const startFrame = Math.ceil(birth * fps - 1e-6);
    const samples: PState[] = [];
    let age = 0;
    let lastAngle = rot;
    for (let f = startFrame; ; f++) {
      const target = f / fps - birth;
      if (target > life + 1e-9) break;
      while (age < target - 1e-12) {
        const dt = Math.min(SUBSTEP, target - age);
        const tNorm = age / life;
        const k = evalCurve(e.overLifetime.speed, tNorm);
        const tAbs = birth + age;
        let ax = 0, ay = 0;
        affectors.forEach((a, ai) => {
          switch (a.type) {
            case "gravity": { const w = a.useWeight ? weight : 1; ax += a.x * w; ay += a.y * w; break; }
            case "drag": {
              if (a.mode === "linear") { vx *= Math.exp(-a.amount * a.x * dt); vy *= Math.exp(-a.amount * a.y * dt); }
              else { const sp = Math.hypot(vx, vy) * 0.01 * a.amount * dt; vx /= 1 + sp * a.x; vy /= 1 + sp * a.y; }
              break;
            }
            case "vortex": {
              const [cx, cy] = centre(a.x, a.y, tAbs);
              const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
              ax += (-dy / d) * a.strength; ay += (dx / d) * a.strength; break;
            }
            case "attractor": {
              const [cx, cy] = centre(a.x, a.y, tAbs);
              const dx = cx - x, dy = cy - y, d = Math.max(Math.hypot(dx, dy), a.radius);
              ax += (dx / d) * a.strength; ay += (dy / d) * a.strength; break;
            }
            case "turbulence": {
              const [wx, wy] = worldPos(tAbs);
              const t = tAbs * a.speed;
              ax += noise2(wx * a.frequency, wy * a.frequency + t, noiseSeed) * a.strength;
              ay += noise2(wx * a.frequency + 31.7, wy * a.frequency - t, noiseSeed) * a.strength;
              break;
            }
            case "wind": {
              const gust = a.turbulence > 0 ? 1 + a.turbulence * noise2(tAbs * a.frequency * 10, i * 0.37, noiseSeed + ai) : 1;
              const s = (windStrength[ai] * gust) / weight;
              ax += Math.cos(a.angle * DEG) * s; ay += Math.sin(a.angle * DEG) * s;
              break;
            }
            case "velocityStretch": break; // applied at sampling time
          }
        });
        vx += ax * dt; vy += ay * dt;
        x += vx * k * dt; y += vy * k * dt;
        rot += angVel * evalCurve(e.overLifetime.spin, tNorm) * dt;
        age += dt;
      }
      const t = Math.min(1, age / life);
      const k = evalCurve(e.overLifetime.speed, t);
      let rotation = rot;
      const moving = vx !== 0 || vy !== 0;
      if (moving && (e.overLifetime.alignToVelocity || (stretch?.type === "velocityStretch" && stretch.align))) {
        // keep the angle continuous so Spine never spins the long way round
        const a = Math.atan2(vy, vx) / DEG;
        rotation = lastAngle + ((((a - lastAngle) % 360) + 540) % 360) - 180;
        lastAngle = rotation;
      }
      let w = size0 * evalCurve(e.overLifetime.size, t);
      let h = size0 * evalCurve(e.overLifetime.sizeY ?? e.overLifetime.size, t);
      if (stretch?.type === "velocityStretch") {
        const sp = Math.hypot(vx, vy) * k;
        const st = Math.min(stretch.max, 1 + (Math.max(0, sp - stretch.minSpeed) * stretch.amount) / 100);
        w *= st;
        h /= Math.pow(st, stretch.volume);
      }
      const [r, g, b] = !e.colorize ? [1, 1, 1] as const : e.overLifetime.color ? mul(evalGradient(e.overLifetime.color, t), baseColor) : baseColor;
      const [wx, wy] = worldPos(birth + age);
      samples.push({ x: wx, y: wy, rotation, size: w, sizeY: h, r, g, b, a: clamp01(alpha0 * evalCurve(e.overLifetime.alpha, t)), frame: frameAt(age, t) });
    }
    return { startFrame, samples };
  }).filter((p) => p.samples.length > 0);
}

/** Returns local [x, y, outwardAngleDeg | null]. */
function spawnPoint(e: Emitter, rand: () => number): [number, number, number | null] {
  const s = e.shape;
  switch (s.type) {
    case "point":
      return [0, 0, rand() * 360];
    case "circle": {
      const a = rand() * Math.PI * 2;
      const r = s.edgeOnly ? s.radius : s.radius * Math.sqrt(rand());
      return [Math.cos(a) * r, Math.sin(a) * r, a / DEG];
    }
    case "rectangle": {
      let x: number, y: number;
      if (s.edgeOnly) {
        const p = rand() * 2 * (s.width + s.height);
        if (p < s.width) { x = p; y = 0; }
        else if (p < s.width + s.height) { x = s.width; y = p - s.width; }
        else if (p < 2 * s.width + s.height) { x = p - s.width - s.height; y = s.height; }
        else { x = 0; y = p - 2 * s.width - s.height; }
      } else { x = rand() * s.width; y = rand() * s.height; }
      x -= s.width / 2; y -= s.height / 2;
      return [x, y, Math.atan2(y, x) / DEG];
    }
    case "line":
      return [(rand() - 0.5) * s.width, 0, rand() < 0.5 ? 90 : -90];
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mul = (a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
