import type { EmitterTrack, PState } from "./simulate.js";

/** One reusable Spine bone+slot. `owner[f]` is the particle index shown at frame f, or -1. */
export interface Lane {
  owner: Int32Array;
  state: (PState | null)[];
}

export interface LaneAssignment {
  lanes: Lane[];
  dropped: number;
}

/** Greedy first-fit interval colouring; circular when looping. Respects `emission.limit` as the lane cap. */
export function assignLanes(track: EmitterTrack, frames: number, loop: boolean): LaneAssignment {
  const limit = track.emitter.emission.limit;
  const lanes: Lane[] = [];
  let dropped = 0;
  const order = track.particles.map((_, i) => i).sort((a, b) => track.particles[a].startFrame - track.particles[b].startFrame || a - b);

  for (const pi of order) {
    const p = track.particles[pi];
    const span: number[] = [];
    const n = loop ? Math.min(p.samples.length, frames) : p.samples.length;
    for (let j = 0; j < n; j++) {
      const f = loop ? (p.startFrame + j) % frames : p.startFrame + j;
      if (f < frames) span.push(f);
    }
    if (span.length === 0) continue;
    let lane = lanes.find((l) => span.every((f) => l.owner[f] === -1));
    if (!lane) {
      if (lanes.length >= limit) { dropped++; continue; }
      lane = { owner: new Int32Array(frames).fill(-1), state: new Array(frames).fill(null) };
      lanes.push(lane);
    }
    span.forEach((f, j) => {
      lane!.owner[f] = pi;
      lane!.state[f] = p.samples[j];
    });
  }
  return { lanes, dropped };
}
