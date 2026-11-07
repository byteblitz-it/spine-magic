import { z } from "zod";

/** A fixed number or a uniform random [min, max]. */
export const Range = z.union([z.number(), z.tuple([z.number(), z.number()])]);
export type Range = z.infer<typeof Range>;

/** Piecewise-linear curve over a normalized time 0..1: [[t, value], ...]. */
export const Curve = z.array(z.tuple([z.number().min(0).max(1), z.number()])).min(1);
export type Curve = z.infer<typeof Curve>;

const Hex = z.string().regex(/^#?[0-9a-fA-F]{6}$/, "colour must be #rrggbb");
/** Colour over normalized lifetime: [[t 0..1, "#rrggbb"], ...]. */
export const Gradient = z
  .array(z.tuple([z.number().min(0).max(1), Hex]))
  .min(1)
  .transform((g) => [...g].sort((a, b) => a[0] - b[0]));
export type Gradient = z.infer<typeof Gradient>;

const on = { enabled: z.boolean().default(true) };

export const Affector = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gravity"), ...on, x: z.number().default(0), y: z.number().default(-300), useWeight: z.boolean().default(false) }),
  z.object({
    type: z.literal("drag"), ...on, amount: z.number().min(0).default(1),
    mode: z.enum(["linear", "quadratic"]).default("linear"),
    /** per-axis multipliers ("separate axes") */
    x: z.number().min(0).default(1), y: z.number().min(0).default(1),
  }),
  z.object({ type: z.literal("vortex"), ...on, x: z.number().default(0), y: z.number().default(0), strength: z.number().default(180) }),
  z.object({ type: z.literal("attractor"), ...on, x: z.number().default(0), y: z.number().default(0), strength: z.number().default(300), radius: z.number().positive().default(10) }),
  z.object({ type: z.literal("turbulence"), ...on, strength: z.number().default(100), frequency: z.number().positive().default(0.01), speed: z.number().default(1) }),
  z.object({
    type: z.literal("wind"), ...on,
    angle: z.number().default(0),
    strength: Range.default([25, 50]),
    turbulence: z.number().min(0).default(0),
    frequency: z.number().positive().default(0.05),
  }),
  z.object({
    type: z.literal("velocityStretch"), ...on,
    amount: z.number().min(0).default(0.5),
    max: z.number().min(1).default(4),
    minSpeed: z.number().min(0).default(50),
    /** 0 = only lengthen, 1 = keep area (thin while stretching) */
    volume: z.number().min(0).max(1).default(0.5),
    align: z.boolean().default(true),
  }),
]);
export type Affector = z.infer<typeof Affector>;
export type AffectorType = Affector["type"];

const Point = z.tuple([z.number(), z.number()]);

export const Emitter = z.object({
  name: z.string().min(1).default("emitter"),
  enabled: z.boolean().default(true),
  texture: z.string().default("soft-circle"),
  /** Sprite origin, 0..1 from the texture's left/top. [0.5, 0.5] = centre. */
  pivot: Point.default([0.5, 0.5]),
  /** false: ignore colour/gradient tint (keep the texture's own colours). */
  colorize: z.boolean().default(true),
  /** Several sprites per emitter. Non-empty `frames` replaces `texture`. */
  sprite: z
    .object({
      frames: z.array(z.string()).default([]),
      /** random: each particle keeps one random frame. flipbook: frames play in order over the particle's life */
      mode: z.enum(["random", "flipbook"]).default("flipbook"),
      /** flipbook frames per second; 0 = play the frames once across the particle's lifetime */
      fps: z.number().min(0).default(12),
      /** flipbook: wrap around (true) or hold the last frame */
      loop: z.boolean().default(true),
      /** flipbook: each particle starts on a random frame */
      randomStart: z.boolean().default(false),
    })
    .prefault({}),
  blend: z.enum(["normal", "additive", "multiply", "screen"]).default("additive"),
  simulationSpace: z.enum(["world", "local"]).default("local"),
  emission: z
    .object({
      type: z.enum(["continuous", "burst"]).default("continuous"),
      rate: z.number().min(0).default(10),
      /** multiplier on rate over the effect's duration (curve mode) */
      rateOverTime: Curve.optional(),
      /** extra particles per 100 px the emitter travels (needs motion) */
      rateOverDistance: z.number().min(0).default(0),
      bursts: z.array(z.object({ time: z.number().min(0), count: z.number().int().min(1) })).default([{ time: 0, count: 20 }]),
      limit: z.number().int().min(1).max(2000).default(200),
    })
    .prefault({}),
  shape: z
    .object({
      type: z.enum(["point", "circle", "rectangle", "line"]).default("point"),
      radius: z.number().min(0).default(20),
      width: z.number().min(0).default(100),
      height: z.number().min(0).default(100),
      edgeOnly: z.boolean().default(false),
    })
    .prefault({}),
  direction: z
    .object({
      angle: z.number().default(90),
      spread: z.number().min(0).max(360).default(30),
      /** "outward": emit away from the shape centre (ignores angle). */
      mode: z.enum(["angle", "outward"]).default("angle"),
      /** random, or evenly fanned across the spread */
      distribution: z.enum(["random", "uniform"]).default("random"),
    })
    .prefault({}),
  transform: z
    .object({
      x: z.number().default(0), y: z.number().default(0), rotation: z.number().default(0), scale: z.number().default(1),
      /** fraction of the emitter's velocity given to new particles */
      inheritVelocity: z.number().default(0),
    })
    .prefault({}),
  /** Emitter travels along a path (relative to transform) over the effect duration. */
  motion: z
    .object({
      enabled: z.boolean().default(false),
      points: z.array(Point).min(2).default([[-150, 0], [0, 100], [150, 0], [0, -100]]),
      closed: z.boolean().default(true),
      smooth: z.boolean().default(true),
      /** laps per effect duration; whole numbers keep loops seamless */
      loops: z.number().positive().default(1),
      mode: z.enum(["loop", "pingpong", "once"]).default("loop"),
      /** distance: constant speed along the path; time: points are evenly spaced keyframes (sampled tracks) */
      timing: z.enum(["distance", "time"]).default("distance"),
    })
    .prefault({}),
  initial: z
    .object({
      lifetime: Range.default([0.8, 1.2]),
      speed: Range.default([80, 120]),
      size: Range.default([24, 40]),
      rotation: Range.default([0, 360]),
      angularVelocity: Range.default(0),
      color: Hex.default("#ffffff"),
      alpha: Range.default(1),
      /** scales gravity (when useWeight) and divides wind */
      weight: Range.default(1),
    })
    .prefault({}),
  overLifetime: z
    .object({
      size: Curve.default([[0, 1], [1, 1]]),
      /** separate Y size curve; omitted = same as size */
      sizeY: Curve.optional(),
      alpha: Curve.default([[0, 0], [0.1, 1], [0.7, 1], [1, 0]]),
      speed: Curve.default([[0, 1], [1, 1]]),
      spin: Curve.default([[0, 1], [1, 1]]),
      color: Gradient.optional(),
      alignToVelocity: z.boolean().default(false),
    })
    .prefault({}),
  affectors: z.array(Affector).default([]),
  /** A smooth textured strip trailing behind the emitter's path (needs motion, or a character trail). */
  ribbon: z
    .object({
      enabled: z.boolean().default(false),
      /** seconds of path history the strip covers */
      length: z.number().positive().max(5).default(0.35),
      /** strip resolution (quads along the length) */
      segments: z.number().int().min(2).max(64).default(16),
      /** px at the head */
      width: z.number().min(0).default(28),
      /** width multiplier from head (t=0) to tail (t=1) */
      widthOverLength: Curve.default([[0, 1], [1, 0]]),
      /** builtin "ribbon" fades along its length; any texture works (u runs head → tail) */
      texture: z.string().default("ribbon"),
      color: Hex.default("#ffffff"),
      alpha: z.number().min(0).max(1).default(1),
    })
    .prefault({}),
});
export type Emitter = z.infer<typeof Emitter>;

/** The emitter's sprite refs: `sprite.frames` when set, else `[texture]`. PState.frame indexes this list. */
export const emitterSprites = (e: Pick<Emitter, "texture" | "sprite">): string[] => (e.sprite?.frames?.length ? e.sprite.frames : [e.texture]);

/** How an effect is bound into a character skeleton (see merge.ts). */
export const Attachment = z.object({
  /** character skeleton JSON path (relative to SPINEMAGIC_HOME); stored so tools and the editor can re-attach */
  character: z.string().optional(),
  /** character bone the effect sticks to */
  bone: z.string(),
  /** character animation that receives the effect keys */
  animation: z.string(),
  /** follow: rigidly under the bone. trail: world-space emitters emit from the bone's animated path and leave trails */
  mode: z.enum(["follow", "trail"]).default("follow"),
  /** one-shot effects start at this animation time (s) */
  startTime: z.number().min(0).default(0),
  inheritRotation: z.boolean().default(true),
  inheritScale: z.boolean().default(true),
  /** draw-order anchor slot; omitted = on top of everything */
  slot: z.string().optional(),
  place: z.enum(["above", "below"]).default("above"),
  /** looping effects take the animation's duration so both loops line up */
  matchLoop: z.boolean().default(true),
  /** match the character atlas' alpha mode. auto: read 4.x "pma:" flag; 3.8 atlases don't record it → assume Spine's default (premultiplied) */
  premultiplied: z.union([z.boolean(), z.literal("auto")]).default("auto"),
});
export type Attachment = z.infer<typeof Attachment>;
export type AttachmentInput = z.input<typeof Attachment>;

export const Effect = z.object({
  name: z.string().min(1).default("effect"),
  fps: z.number().int().min(10).max(60).default(30),
  /** Loop length (loop=true) or emission length (loop=false), seconds. */
  duration: z.number().positive().max(20).default(2),
  loop: z.boolean().default(true),
  seed: z.number().int().default(12345),
  emitters: z.array(Emitter).min(1).prefault([{}]),
  /** last character binding (optional; set by attach_effect / the editor's Character panel) */
  attach: Attachment.optional(),
});
export type Effect = z.infer<typeof Effect>;
export type EffectInput = z.input<typeof Effect>;

export const SPINE_VERSIONS = ["3.8", "4.0", "4.1", "4.2", "4.3"] as const;
export type SpineVersion = (typeof SPINE_VERSIONS)[number];

export function parseEffect(input: unknown): Effect {
  return Effect.parse(input);
}
