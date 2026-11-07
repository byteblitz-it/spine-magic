import { describe, expect, it } from "vitest";
import * as spine40 from "spine-core-40";
import * as spine42 from "spine-core-42";
import * as spine43 from "spine-core-43";
import {
  PRESETS, assignLanes, bakeSimulation, decodePng, encodePng, createImage, parseEffect, reduce, sampleRuntime, simulate, structuralCheck, safe, loadRuntime,
} from "../src/node/index.js";

// 3.8 comes from the vendored official build (no npm package)
const spine38 = (await loadRuntime("3.8")).core;
const runtimes = { "3.8": spine38, "4.0": spine40, "4.2": spine42, "4.3": spine43 } as const;

/** A local-space emitter that moves, rotates, scales and stretches: the hardest case for bone-space conversion. */
const MOVING_LOCAL = {
  name: "moving_local", duration: 2, loop: true,
  emitters: [{
    name: "m", simulationSpace: "local", texture: "spark",
    transform: { x: 40, y: -20, rotation: 30, scale: 1.5, inheritVelocity: 0.3 },
    motion: { enabled: true, points: [[-100, 0], [0, 60], [100, 0]], closed: true },
    emission: { rate: 12, rateOverDistance: 4, limit: 80 },
    initial: { speed: [60, 120], weight: [0.5, 2] },
    overLifetime: { sizeY: [[0, 0.5], [1, 2]], spin: [[0, 1], [1, 0]] },
    affectors: [{ type: "wind", strength: [40, 80], turbulence: 0.5 }, { type: "velocityStretch", amount: 1, minSpeed: 0 }, { type: "drag", mode: "quadratic", amount: 1, y: 2 }],
  }],
};

describe("bake matches the simulation inside the real Spine runtime", () => {
  const cases: [string, unknown][] = [
    ...["fireworks", "portal", "smoke", "comet"].map((p) => [p, PRESETS[p].effect] as [string, unknown]),
    ["moving local emitter", MOVING_LOCAL],
  ];
  for (const [label, input] of cases) {
    for (const [version, core] of Object.entries(runtimes)) {
      it(`${label} @ ${version}`, () => {
        const effect = parseEffect(input);
        const sim = simulate(effect);
        const { json, atlas } = bakeSimulation(effect, sim, { version: version as "4.0", tolerance: 0 });
        const track = sim.emitters[0];
        const texMax = Math.max(atlas.regions[0].width, atlas.regions[0].height);
        const { lanes } = assignLanes(track, sim.frames, sim.loop);
        const bonePrefix = `${safe(track.emitter.name)}_0_p`;
        const probes: { bone: string; time: number; expect: { x: number; y: number; sx: number; sy: number } }[] = [];
        lanes.slice(0, 6).forEach((lane, li) => {
          for (let f = 0; f < sim.frames; f += 3) {
            const s = lane.state[f];
            if (s) probes.push({ bone: `${bonePrefix}${li}`, time: f / sim.fps + 1e-4, expect: { x: s.x, y: s.y, sx: s.size / texMax, sy: s.sizeY / texMax } });
          }
        });
        expect(probes.length).toBeGreaterThan(10);
        const { probes: got } = sampleRuntime(core, json, atlas.text, probes);
        got.forEach((g, i) => {
          expect(g.x).toBeCloseTo(probes[i].expect.x, 0);
          expect(g.y).toBeCloseTo(probes[i].expect.y, 0);
          expect(g.sx).toBeCloseTo(probes[i].expect.sx, 2);
          expect(g.sy).toBeCloseTo(probes[i].expect.sy, 2);
        });
      });
    }
  }
});

describe("new emitter features", () => {
  it("uniform distribution fans a burst evenly", () => {
    const e = parseEffect({ loop: false, emitters: [{ emission: { type: "burst", bursts: [{ time: 0, count: 8 }] }, direction: { spread: 360, distribution: "uniform" }, initial: { speed: 100, lifetime: 0.5 } }] });
    const angles = simulate(e).emitters[0].particles.map((p) => {
      const s = p.samples[p.samples.length - 1];
      return ((Math.atan2(s.y, s.x) * 180) / Math.PI + 360) % 360;
    }).sort((a, b) => a - b);
    angles.forEach((a, i) => expect(Math.abs(a - ((angles[0] + i * 45) % 360))).toBeLessThan(0.5));
  });

  it("rateOverTime shapes emission and rateOverDistance follows motion", () => {
    const base = { duration: 2, emitters: [{ emission: { rate: 20 } }] };
    const flat = simulate(parseEffect(base)).emitters[0].particles.length;
    const pulsed = simulate(parseEffect({ ...base, emitters: [{ emission: { rate: 20, rateOverTime: [[0, 1], [0.5, 0], [1, 1]] } }] })).emitters[0].particles.length;
    expect(flat).toBe(40);
    expect(pulsed).toBe(20);
    const moving = parseEffect({ duration: 2, emitters: [{ emission: { rate: 0, rateOverDistance: 10 }, motion: { enabled: true, points: [[-100, 0], [100, 0]], closed: true, smooth: false } }] });
    expect(simulate(moving).emitters[0].particles.length).toBe(40); // 400 px of travel × 10 / 100 px
  });

  it("motion loops seamlessly and pivot offsets the attachment", () => {
    const e = parseEffect({ ...MOVING_LOCAL, emitters: [{ ...MOVING_LOCAL.emitters[0], pivot: [0, 0.5] }] });
    const { json } = bakeSimulation(e, simulate(e), { version: "4.2", tolerance: 0 });
    const tr = (json as any).animations.animation.bones.m_0.translate;
    expect(tr[0].x).toBeCloseTo(tr[tr.length - 1].x, 1);
    expect(tr[0].y).toBeCloseTo(tr[tr.length - 1].y, 1);
    const att = Object.values((json as any).skins[0].attachments.m_0_p0)[0] as any;
    expect(att.x).toBe(att.width / 2); // pivot on the left edge → region centred half a width to the right
  });

  it("old documents still parse (affectors gain enabled:true)", () => {
    const e = parseEffect({ emitters: [{ affectors: [{ type: "gravity" }] }] });
    expect(e.emitters[0].affectors[0]).toMatchObject({ type: "gravity", enabled: true, useWeight: false });
  });
});

describe("simulation", () => {
  it("is deterministic for a seed and changes with it", () => {
    const e = parseEffect(PRESETS["magic-sparkles"].effect);
    const a = JSON.stringify(bakeSimulation(e, simulate(e), { version: "4.2" }).json);
    const b = JSON.stringify(bakeSimulation(e, simulate(e), { version: "4.2" }).json);
    const c = JSON.stringify(bakeSimulation({ ...e, seed: 7 }, simulate({ ...e, seed: 7 }), { version: "4.2" }).json);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("loops seamlessly: wrapped particles continue across the seam", () => {
    const e = parseEffect(PRESETS.fire.effect);
    const sim = simulate(e);
    const { lanes } = assignLanes(sim.emitters[0], sim.frames, true);
    const crossing = lanes.filter((l) => l.owner[0] !== -1 && l.owner[0] === l.owner[sim.frames - 1]);
    expect(crossing.length).toBeGreaterThan(0);
    for (const l of crossing) {
      const a = l.state[sim.frames - 1]!, b = l.state[0]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(20); // one frame of motion, not a jump
    }
  });

  it("respects the particle limit as the lane cap", () => {
    const e = parseEffect({ emitters: [{ emission: { rate: 100, limit: 5 }, initial: { lifetime: 1 } }] });
    const sim = simulate(e);
    const { lanes, dropped } = assignLanes(sim.emitters[0], sim.frames, true);
    expect(lanes.length).toBe(5);
    expect(dropped).toBeGreaterThan(0);
  });
});

describe("version adapters", () => {
  it("3.8 uses angle/color, 4.x uses value/rgba, and both pass the structural check", () => {
    const e = parseEffect(PRESETS.confetti.effect);
    const sim = simulate(e);
    const v38 = bakeSimulation(e, sim, { version: "3.8" });
    const v42 = bakeSimulation(e, sim, { version: "4.2" });
    const s = JSON.stringify(v38.json);
    expect(s).toContain('"angle"');
    expect(s).toContain('"color":[');
    expect(s).not.toContain('"rgba"');
    expect(JSON.stringify(v42.json)).toContain('"rgba"');
    expect(structuralCheck(v38.json, v38.atlas.text, "3.8")).toEqual([]);
    expect(structuralCheck(v42.json, v42.atlas.text, "4.2")).toEqual([]);
    expect(structuralCheck(v42.json, v42.atlas.text, "3.8").length).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("reduce keeps endpoints and corners only", () => {
    const t = [0, 1, 2, 3, 4, 5, 6];
    const v = [[0], [1], [2], [3], [2], [1], [0]];
    expect(reduce(t, v, 0.01)).toEqual([0, 3, 6]);
    expect(reduce(t, v, 0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("png encode/decode round-trips", () => {
    const img = createImage(3, 2);
    img.data.set([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(3);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
  });
});
