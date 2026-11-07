import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRESETS, attachToCharacter, detachFromCharacter, inspectCharacter, loadRuntime, mergeEffect, openSkeleton, parseEffect, runtimeBoneSampler,
} from "../src/node/index.js";

const VERSIONS = ["3.8", "4.2"] as const;
const fixture = (v: string) => {
  const dir = mkdtempSync(join(tmpdir(), `sm-char-${v}-`));
  cpSync(join("test", "fixtures", `hero-${v}`), dir, { recursive: true });
  return { dir, json: join(dir, "hero.json") };
};
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const glow = parseEffect({ ...PRESETS["magic-sparkles"].effect, name: "hand_glow" });
// one-frame particles that never move: each sits exactly where the hand was when it was born
const stamp = parseEffect({
  name: "stamp", loop: true, fps: 30,
  emitters: [{ name: "s", simulationSpace: "world", emission: { rate: 30, limit: 10 }, initial: { lifetime: 0.02, speed: 0, size: 10 }, overLifetime: { alpha: [[0, 1], [1, 1]] } }],
});

describe.each(VERSIONS)("sample characters — Spine %s", (v) => {
  it.each([["knight", "sword_tip", "attack"], ["wizard", "staff_orb", "cast"]])("%s loads in the runtime and takes an effect on %s", async (name, bone, animation) => {
    const dir = mkdtempSync(join(tmpdir(), `sm-sample-${name}-${v}-`));
    cpSync(join("samples", "characters", `${name}-${v}`), dir, { recursive: true });
    const r = await attachToCharacter({ effect: glow, jsonPath: join(dir, `${name}.json`), attach: { bone, animation } });
    expect(r.validation.ok).toBe(true);
    expect(r.followError).toBe(0);
  });
});

describe.each(VERSIONS)("character merge — Spine %s", (v) => {
  it("follow: the anchor sits on the bone through the whole animation; original files untouched", async () => {
    const f = fixture(v);
    const before = readFileSync(f.json, "utf8");
    const r = await attachToCharacter({ effect: glow, jsonPath: f.json, attach: { bone: "hand", animation: "swing", slot: "arm" } });
    expect(r.validation).toMatchObject({ ok: true, method: "runtime" });
    expect(r.followError).toBe(0);
    expect(readFileSync(f.json, "utf8")).toBe(before);
    const merged = read(r.files.json);
    // slots inserted right above "arm"
    const order = merged.slots.map((s: any) => s.name);
    expect(order.slice(0, 2)).toEqual(["body", "arm"]);
    expect(order[2]).toMatch(/^fx_hand_glow__/);
    expect(merged.bones.find((b: any) => b.name === "fx_hand_glow__anchor").parent).toBe("hand");
    expect(inspectCharacter(merged).effects).toEqual(["hand_glow"]);
  });

  it("inheritRotation:false keeps the effect upright while the arm swings", async () => {
    const f = fixture(v);
    const r = await attachToCharacter({ effect: glow, jsonPath: f.json, attach: { bone: "hand", animation: "swing", inheritRotation: false } });
    const merged = read(r.files.json);
    const { core } = await loadRuntime(v);
    const s = openSkeleton(core, merged, readFileSync(r.files.atlas, "utf8"));
    for (const t of [0, 0.25, 0.5, 0.75]) {
      s.pose("swing", t);
      const a = s.bone("fx_hand_glow__anchor"), h = s.bone("hand");
      expect(Math.atan2(a.c, a.a)).toBeCloseTo(0, 3);
      expect(Math.hypot(a.x - h.x, a.y - h.y)).toBeLessThan(1e-3);
    }
  });

  it("trail: world-space particles are born on the hand's animated path", async () => {
    const f = fixture(v);
    const r = await attachToCharacter({ effect: stamp, jsonPath: f.json, attach: { bone: "hand", animation: "swing", mode: "trail" } });
    expect(r.validation.ok).toBe(true);
    const merged = read(r.files.json);
    const { core } = await loadRuntime(v);
    const s = openSkeleton(core, merged, readFileSync(r.files.atlas, "utf8"));
    const lanes = merged.slots.filter((x: any) => x.name.startsWith("fx_stamp__")).map((x: any) => x.name);
    expect(merged.bones.find((b: any) => b.name === lanes[0]).parent).toBe("fx_stamp__root");
    let checked = 0;
    for (let fr = 0; fr < 30; fr += 5) {
      const t = fr / 30 + 1e-4;
      s.pose("swing", t);
      const hand = s.bone("hand");
      const visible = s.skeleton.slots.filter((sl: any) => lanes.includes(sl.data.name) && (sl.getAttachment?.() ?? sl.appliedPose?.attachment));
      expect(visible.length).toBe(1); // one particle per frame, alive for that frame only
      const b = s.bone(visible[0].bone.data.name);
      expect(Math.hypot(b.x - hand.x, b.y - hand.y)).toBeLessThan(0.5);
      checked++;
    }
    expect(checked).toBe(6);
  });

  it("trail + ribbon: the ribbon head follows the hand; detach removes its deform keys", async () => {
    const f = fixture(v);
    const swish = parseEffect({ name: "swish", loop: true, emitters: [{ name: "r", simulationSpace: "world", emission: { rate: 0 }, ribbon: { enabled: true, length: 0.3, segments: 8, width: 20 } }] });
    const r = await attachToCharacter({ effect: swish, jsonPath: f.json, attach: { bone: "hand", animation: "swing", mode: "trail" } });
    expect(r.validation.ok).toBe(true);
    const merged = read(r.files.json);
    const { core } = await loadRuntime(v);
    const s = openSkeleton(core, merged, readFileSync(r.files.atlas, "utf8"));
    const slot = s.skeleton.findSlot("fx_swish__r_0_ribbon");
    expect(slot).toBeTruthy();
    for (let fr = 0; fr < 30; fr += 6) {
      s.pose("swing", fr / 30 + 1e-4);
      const att = slot.getAttachment?.() ?? slot.appliedPose.attachment;
      const out = new Float32Array(att.worldVerticesLength);
      if (slot.appliedPose) att.computeWorldVertices(s.skeleton, slot, 0, out.length, out, 0, 2);
      else att.computeWorldVertices(slot, 0, out.length, out, 0, 2);
      const hand = s.bone("hand");
      // the two head vertices straddle the hand
      expect(Math.hypot((out[0] + out[2]) / 2 - hand.x, (out[1] + out[3]) / 2 - hand.y)).toBeLessThan(1);
    }
    const d = await detachFromCharacter({ jsonPath: r.files.json, effectName: "swish" });
    const after = read(d.files.json);
    expect(JSON.stringify(after)).not.toContain("fx_swish__");
  });

  it("startTime shifts a one-shot burst; re-attach replaces; detach restores the character", async () => {
    const f = fixture(v);
    const burst = parseEffect({ ...PRESETS.fireworks.effect, name: "pop", loop: false, duration: 0.2 });
    const a = await attachToCharacter({ effect: burst, jsonPath: f.json, attach: { bone: "hand", animation: "swing", startTime: 0.4 } });
    const m1 = read(a.files.json);
    const att = Object.entries<any>(m1.animations.swing.slots).filter(([k]) => k.startsWith("fx_pop__")).map(([, tl]) => tl.attachment);
    expect(att.length).toBeGreaterThan(0);
    for (const keys of att) expect(keys.find((k: any) => k.name)?.time ?? 0).toBeGreaterThanOrEqual(0.4);

    const again = await attachToCharacter({ effect: burst, jsonPath: a.files.json, attach: { bone: "hand", animation: "swing", startTime: 0.4 } });
    const m2 = read(again.files.json);
    expect(m2.bones.length).toBe(m1.bones.length);
    expect(new Set(m2.bones.map((b: any) => b.name)).size).toBe(m2.bones.length);

    const d = await detachFromCharacter({ jsonPath: again.files.json, effectName: "pop" });
    expect(d.validation.ok).toBe(true);
    const restored = read(d.files.json), original = read(f.json);
    expect(restored.bones).toEqual(original.bones);
    expect(restored.slots).toEqual(original.slots);
    expect(Object.keys(restored.animations.swing.bones)).toEqual(Object.keys(original.animations.swing.bones));
    expect(readFileSync(d.files.atlas, "utf8")).not.toContain("fx_pop.png");
  });
});

describe("merge input checks", () => {
  const ch = JSON.parse(readFileSync("test/fixtures/hero-4.2/hero.json", "utf8"));
  const atlas = readFileSync("test/fixtures/hero-4.2/hero.atlas", "utf8");
  it("names the problem", () => {
    expect(() => mergeEffect({ character: ch, characterAtlas: atlas, effect: glow, attach: { bone: "tail", animation: "swing" } })).toThrow(/bone "tail"/);
    expect(() => mergeEffect({ character: ch, characterAtlas: atlas, effect: glow, attach: { bone: "hand", animation: "jump" } })).toThrow(/swing, walk, idle/);
    expect(() => mergeEffect({ character: { ...ch, skeleton: { spine: "3.7.94" } }, characterAtlas: atlas, effect: glow, attach: { bone: "hand", animation: "swing" } })).toThrow(/unsupported Spine version/);
    expect(() => mergeEffect({ character: ch, characterAtlas: atlas, effect: stamp, attach: { bone: "hand", animation: "swing", mode: "trail" } })).toThrow(/sampler/);
  });
  it("looping effects take the animation's length", async () => {
    const r = mergeEffect({ character: ch, characterAtlas: atlas, effect: glow, attach: { bone: "hand", animation: "walk" } });
    expect(r.stats.durationSeconds).toBe(2);
    const s = await runtimeBoneSampler(ch, atlas);
    expect(s("walk", 1, "body").x).toBeCloseTo(120, 3);
  });
});
