import type { Effect, SpineVersion } from "./schema.js";
import { simulate, type PState, type Simulation } from "./simulate.js";
import { assignLanes, type Lane } from "./lanes.js";
import { builtinTexture, type Texture, type TextureResolver } from "./textures.js";
import { buildAtlas, type AtlasResult } from "./atlas.js";
import { DEG } from "./math.js";
import { emitterOffset, emitterOrigin } from "./motion.js";

export interface BakeOptions {
  version: SpineVersion;
  /** Key reduction tolerance; 0 keeps every frame. Position in px, rotation in deg, scale ×100, colour ×255. */
  tolerance?: number;
  /** Base file name for .json/.atlas/.png. */
  name?: string;
  /** Defaults to builtin textures only. */
  resolveTexture?: TextureResolver;
  animationName?: string;
  /** Prepended to every bone, slot, attachment and region name (used when merging into a character). */
  namePrefix?: string;
}

export interface BakeStats {
  frames: number;
  durationSeconds: number;
  particles: number;
  lanes: number;
  droppedParticles: number;
  keys: number;
  keysBeforeReduction: number;
  perEmitter: { name: string; particles: number; lanes: number; dropped: number }[];
}

export interface BakeResult {
  json: Record<string, unknown>;
  atlas: AtlasResult;
  stats: BakeStats;
}

const VERSION_STRING: Record<SpineVersion, string> = { "3.8": "3.8.99", "4.0": "4.0.64", "4.1": "4.1.24", "4.2": "4.2.43", "4.3": "4.3.00" };

type Key = Record<string, unknown> & { time: number };

export function bake(effect: Effect, opts: BakeOptions): BakeResult {
  const sim = simulate(effect);
  return bakeSimulation(effect, sim, opts);
}

export function bakeSimulation(effect: Effect, sim: Simulation, opts: BakeOptions): BakeResult {
  const v3 = opts.version === "3.8";
  const tol = opts.tolerance ?? 0.5;
  const name = opts.name ?? safe(effect.name);
  const animName = opts.animationName ?? "animation";
  const fps = sim.fps;
  const N = sim.frames;
  const length = sim.loop ? N / fps : (N - 1) / fps;

  // textures → one atlas page
  const pre = opts.namePrefix ?? "";
  const resolve = opts.resolveTexture ?? builtinTexture;
  const loadTexture = (ref: string): Texture => { const t = resolve(ref); return pre ? { ...t, name: pre + t.name } : t; };
  const textures = new Map<string, Texture>();
  for (const e of effect.emitters) if (e.enabled) {
    const t = loadTexture(e.texture);
    textures.set(t.name, t);
  }
  const atlas = buildAtlas(name, [...textures.values()]);

  const bones: Record<string, unknown>[] = [{ name: "root" }];
  const slots: Record<string, unknown>[] = [];
  const skinAttachments: Record<string, Record<string, unknown>> = {};
  const animBones: Record<string, Record<string, Key[]>> = {};
  const animSlots: Record<string, Record<string, Key[]>> = {};
  const stats: BakeStats = { frames: N, durationSeconds: round(length), particles: 0, lanes: 0, droppedParticles: 0, keys: 0, keysBeforeReduction: 0, perEmitter: [] };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const track of sim.emitters) {
    const e = track.emitter;
    if (!e.enabled) continue;
    const tex = loadTexture(e.texture);
    const { lanes, dropped } = assignLanes(track, N, sim.loop);
    stats.particles += track.particles.length - dropped;
    stats.lanes += lanes.length;
    stats.droppedParticles += dropped;
    stats.perEmitter.push({ name: e.name, particles: track.particles.length - dropped, lanes: lanes.length, dropped });

    const ename = `${pre}${safe(e.name)}_${track.index}`;
    const local = e.simulationSpace === "local";
    const tf = e.transform;
    if (local) {
      bones.push({ name: ename, parent: "root", ...nz({ x: r2(tf.x), y: r2(tf.y), rotation: r2(tf.rotation) }), ...(tf.scale !== 1 ? { scaleX: tf.scale, scaleY: tf.scale } : {}) });
      // a moving emitter is a moving bone: particles parented to it travel with it
      if (e.motion.enabled) {
        const last = sim.loop ? N : N - 1;
        const times: number[] = [], vals: number[][] = [];
        for (let f = 0; f <= last; f++) { times.push(f / fps); vals.push(emitterOffset(e, sim.period, f / fps)); }
        const keep = reduce(times, vals, tol);
        animBones[ename] = { translate: keep.map((i) => key(times[i], false, { x: r2(vals[i][0]), y: r2(vals[i][1]) })) };
        stats.keys += keep.length;
        stats.keysBeforeReduction += times.length;
      }
    }
    const cos = Math.cos(-tf.rotation * DEG), sin = Math.sin(-tf.rotation * DEG);
    const toBone = (s: PState, f: number): PState => {
      if (!local) return s;
      const [ox, oy] = emitterOrigin(e, sim.period, f / fps);
      const dx = s.x - ox, dy = s.y - oy;
      return { ...s, x: (dx * cos - dy * sin) / tf.scale, y: (dx * sin + dy * cos) / tf.scale, rotation: s.rotation - tf.rotation, size: s.size / tf.scale, sizeY: s.sizeY / tf.scale };
    };
    const texMax = Math.max(tex.image.width, tex.image.height);
    // pivot: the bone sits at the sprite origin, so the region is offset from it
    const [px, py] = e.pivot;
    const offset = nz({ x: r2((0.5 - px) * tex.image.width), y: r2((py - 0.5) * tex.image.height) });

    lanes.forEach((lane, li) => {
      const lname = `${ename}_p${li}`;
      bones.push({ name: lname, parent: local ? ename : "root" });
      slots.push({ name: lname, bone: lname, ...(e.blend !== "normal" ? { blend: e.blend } : {}) });
      skinAttachments[lname] = { [tex.name]: { ...offset, width: tex.image.width, height: tex.image.height } };

      const ch = bakeLane(lane, sim.loop, N, fps, (s, f) => {
        const b = toBone(s, f);
        return {
          t: [b.x, b.y],
          r: [b.rotation],
          s: [(b.size / texMax) * 100, (b.sizeY / texMax) * 100],
          c: [b.r * 255, b.g * 255, b.b * 255, b.a * 255],
        };
      }, tol);
      stats.keysBeforeReduction += ch.raw;

      animBones[lname] = {
        translate: ch.t.map(({ time, v, stepped }) => key(time, stepped, { x: r2(v[0]), y: r2(v[1]) })),
        rotate: ch.r.map(({ time, v, stepped }) => key(time, stepped, v3 ? { angle: r2(v[0]) } : { value: r2(v[0]) })),
        scale: ch.s.map(({ time, v, stepped }) => key(time, stepped, { x: r4(v[0] / 100), y: r4(v[1] / 100) })),
      };
      animSlots[lname] = {
        attachment: ch.att.map(({ time, on }) => ({ time: round(time), name: on ? tex.name : null })),
        [v3 ? "color" : "rgba"]: ch.c.map(({ time, v, stepped }) => key(time, stepped, { color: hex(v) })),
      };
      stats.keys += ch.t.length + ch.r.length + ch.s.length + ch.c.length + ch.att.length;
    });

    for (const p of track.particles) for (const s of p.samples) {
      const h = Math.max(s.size, s.sizeY) / 2;
      minX = Math.min(minX, s.x - h); maxX = Math.max(maxX, s.x + h);
      minY = Math.min(minY, s.y - h); maxY = Math.max(maxY, s.y + h);
    }
  }
  if (!isFinite(minX)) minX = minY = maxX = maxY = 0;

  const json = {
    skeleton: {
      hash: "spinemagic",
      spine: VERSION_STRING[opts.version],
      x: r2(minX), y: r2(minY), width: r2(maxX - minX), height: r2(maxY - minY),
      fps,
      images: "./",
      audio: "",
    },
    bones,
    slots,
    skins: [{ name: "default", attachments: skinAttachments }],
    animations: { [animName]: { slots: animSlots, bones: animBones } },
  };
  return { json, atlas, stats };
}

interface ChKey { time: number; v: number[]; stepped: boolean }
interface LaneChannels { t: ChKey[]; r: ChKey[]; s: ChKey[]; c: ChKey[]; att: { time: number; on: boolean }[]; raw: number }
/** `f` is the absolute frame (may be N when closing a loop — same state as frame 0, but bone-space conversion uses time). */
type Extract = (s: PState, f: number) => { t: number[]; r: number[]; s: number[]; c: number[] };

/** Turns a lane's per-frame states into reduced keys per channel. */
function bakeLane(lane: Lane, loop: boolean, N: number, fps: number, ex: Extract, tol: number): LaneChannels {
  // segments of consecutive frames with the same owner
  const segs: { start: number; end: number; closesLoop: boolean }[] = [];
  for (let f = 0; f < N; f++) {
    if (lane.owner[f] === -1) continue;
    if (f > 0 && lane.owner[f - 1] === lane.owner[f]) { segs[segs.length - 1].end = f; continue; }
    segs.push({ start: f, end: f, closesLoop: false });
  }
  // a particle crossing the loop seam continues into frame N (== frame 0)
  if (loop && segs.length && lane.owner[N - 1] !== -1 && lane.owner[N - 1] === lane.owner[0]) segs[segs.length - 1].closesLoop = true;

  const out: LaneChannels = { t: [], r: [], s: [], c: [], att: [], raw: 0 };
  const visible = new Array<boolean>(N).fill(false);
  for (const seg of segs) {
    const frames: number[] = [];
    for (let f = seg.start; f <= seg.end; f++) frames.push(f);
    if (seg.closesLoop) frames.push(N);
    const vals = frames.map((f) => ex(lane.state[f % N]!, f));
    const times = frames.map((f) => f / fps);
    out.raw += frames.length * 4;
    for (const chName of ["t", "r", "s", "c"] as const) {
      const keep = reduce(times, vals.map((v) => v[chName]), tol);
      keep.forEach((i, k) => out[chName].push({
        time: times[i], v: vals[i][chName],
        // hold the final key of a particle so it never tweens into the next one
        stepped: k === keep.length - 1 && !seg.closesLoop,
      }));
    }
    for (let f = seg.start; f <= seg.end; f++) visible[f] = true;
  }
  // attachment on/off transitions
  let prev: boolean | null = null;
  for (let f = 0; f < N; f++) {
    if (visible[f] !== prev) out.att.push({ time: f / fps, on: visible[f] });
    prev = visible[f];
  }
  // Spine's animation length is the last key time: pin it to the loop length / last frame.
  const end = loop ? N / fps : (N - 1) / fps;
  if (out.att[out.att.length - 1].time < end - 1e-9) out.att.push({ time: end, on: loop ? visible[0] : false });
  if (out.t.length === 0) {
    const zero = { time: 0, v: [0, 0], stepped: false };
    out.t.push(zero); out.r.push({ ...zero, v: [0] }); out.s.push({ ...zero, v: [0, 0] }); out.c.push({ ...zero, v: [255, 255, 255, 0] });
  }
  return out;
}

/** Greedy linear key reduction: keeps a key only where dropping it would exceed `tol` on any component. */
export function reduce(times: number[], vals: number[][], tol: number): number[] {
  const n = times.length;
  if (n <= 2 || tol <= 0) return times.map((_, i) => i);
  const keep = [0];
  let anchor = 0;
  for (let cand = 2; cand < n; cand++) {
    let ok = true;
    for (let j = anchor + 1; j < cand && ok; j++) {
      const k = (times[j] - times[anchor]) / (times[cand] - times[anchor]);
      for (let c = 0; c < vals[j].length; c++) {
        const lerp = vals[anchor][c] + (vals[cand][c] - vals[anchor][c]) * k;
        if (Math.abs(lerp - vals[j][c]) > tol) { ok = false; break; }
      }
    }
    if (!ok) { anchor = cand - 1; keep.push(anchor); }
  }
  keep.push(n - 1);
  return keep;
}

function key(time: number, stepped: boolean, fields: Record<string, unknown>): Key {
  return { time: round(time), ...fields, ...(stepped ? { curve: "stepped" } : {}) };
}

function hex(c: number[]): string {
  return c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** Drop zero-valued fields so the JSON stays tidy. */
function nz(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0));
}

export const safe = (s: string) => s.replace(/[^\w-]+/g, "_") || "effect";
const round = (t: number) => Math.round(t * 10000) / 10000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
