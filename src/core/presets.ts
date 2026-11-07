import type { EffectInput } from "./schema.js";

export const PRESETS: Record<string, { description: string; effect: EffectInput }> = {
  fireworks: {
    description: "Burst of glowing sparks that fall with gravity and fade, gold to red.",
    effect: {
      name: "fireworks", duration: 2, loop: true,
      emitters: [{
        name: "burst", texture: "soft-circle", blend: "additive",
        emission: { type: "burst", bursts: [{ time: 0, count: 60 }], limit: 80 },
        direction: { spread: 360 },
        initial: { lifetime: [1.2, 1.8], speed: [150, 320], size: [10, 18], color: "#ffffff" },
        overLifetime: { size: [[0, 1], [1, 0.3]], alpha: [[0, 1], [0.6, 1], [1, 0]], color: [[0, "#fff6c0"], [0.4, "#ffb030"], [1, "#ff3010"]] },
        affectors: [{ type: "gravity", x: 0, y: -260 }, { type: "drag", amount: 1.4 }],
      }],
    },
  },
  "coin-shower": {
    description: "Fountain of spinning gold coins (flipbook sprites) arcing up and falling, with a few glints.",
    effect: {
      name: "coin_shower", duration: 2, loop: true,
      emitters: [
        {
          name: "coins", texture: "spin-1", blend: "normal",
          sprite: { frames: ["spin-1", "spin-2", "spin-3", "spin-4"], mode: "flipbook", fps: 14, randomStart: true },
          emission: { type: "continuous", rate: 14, limit: 40 },
          direction: { angle: 90, spread: 50 },
          initial: { lifetime: [1.1, 1.5], speed: [260, 360], size: [32, 42], rotation: [-15, 15], color: "#ffffff" },
          overLifetime: { alpha: [[0, 0], [0.05, 1], [0.85, 1], [1, 0]], color: [[0, "#fff2a8"], [1, "#ffc22e"]] },
          affectors: [{ type: "gravity", x: 0, y: -700 }],
        },
        {
          name: "glints", texture: "star", blend: "additive",
          emission: { type: "continuous", rate: 8, limit: 20 },
          shape: { type: "circle", radius: 60 },
          direction: { angle: 90, spread: 60 },
          transform: { y: 120 },
          initial: { lifetime: [0.4, 0.7], speed: [10, 40], size: [14, 24], rotation: [0, 90] },
          overLifetime: { size: [[0, 0.2], [0.4, 1], [1, 0]], alpha: [[0, 0], [0.3, 1], [1, 0]], color: [[0, "#fff8d0"], [1, "#ffc040"]] },
        },
      ],
    },
  },
  "light-ribbon": {
    description: "Glowing ribbon trail sweeping a figure-eight, with sparks shed along it — sword arcs, dashes, magic streaks.",
    effect: {
      name: "light_ribbon", duration: 2, loop: true,
      emitters: [
        {
          name: "streak", texture: "soft-circle", blend: "additive", simulationSpace: "world",
          motion: { enabled: true, points: [[-140, 0], [-70, 70], [0, 0], [70, -70], [140, 0], [70, 70], [0, 0], [-70, -70]], closed: true, smooth: true },
          emission: { type: "continuous", rate: 0, rateOverDistance: 3, limit: 50 },
          initial: { lifetime: [0.3, 0.6], speed: [10, 40], size: [8, 14] },
          overLifetime: { size: [[0, 1], [1, 0]], alpha: [[0, 1], [1, 0]], color: [[0, "#e8fbff"], [1, "#40b8ff"]] },
          ribbon: { enabled: true, length: 0.45, segments: 20, width: 34, widthOverLength: [[0, 1], [0.15, 0.85], [1, 0]], color: "#7fd8ff" },
        },
      ],
    },
  },
  "magic-sparkles": {
    description: "Twinkling stars rising gently from a circle, cyan/violet.",
    effect: {
      name: "magic_sparkles", duration: 2, loop: true,
      emitters: [{
        name: "sparkles", texture: "star", blend: "additive",
        emission: { type: "continuous", rate: 18, limit: 60 },
        shape: { type: "circle", radius: 40 },
        direction: { angle: 90, spread: 40 },
        initial: { lifetime: [0.8, 1.4], speed: [20, 60], size: [14, 30], rotation: [0, 90], angularVelocity: [-90, 90] },
        overLifetime: { size: [[0, 0.2], [0.3, 1], [1, 0]], alpha: [[0, 0], [0.2, 1], [1, 0]], color: [[0, "#a0f0ff"], [1, "#b070ff"]] },
        affectors: [{ type: "turbulence", strength: 60, frequency: 0.02 }],
      }],
    },
  },
  fire: {
    description: "Looping flame: additive soft puffs rising and shrinking, yellow to deep red.",
    effect: {
      name: "fire", duration: 1.5, loop: true,
      emitters: [{
        name: "flame", texture: "soft-circle", blend: "additive",
        emission: { type: "continuous", rate: 30, limit: 60 },
        shape: { type: "line", width: 40 },
        direction: { angle: 90, spread: 20 },
        initial: { lifetime: [0.6, 1.0], speed: [60, 110], size: [40, 60] },
        overLifetime: { size: [[0, 1], [1, 0.2]], alpha: [[0, 0], [0.15, 0.9], [1, 0]], color: [[0, "#fff090"], [0.4, "#ff9020"], [1, "#a01000"]] },
        affectors: [{ type: "attractor", x: 0, y: 120, strength: 60 }, { type: "turbulence", strength: 80, frequency: 0.03, speed: 2 }],
      }],
    },
  },
  smoke: {
    description: "Slow grey smoke puffs drifting up and spreading.",
    effect: {
      name: "smoke", duration: 3, loop: true,
      emitters: [{
        name: "smoke", texture: "smoke", blend: "normal",
        emission: { type: "continuous", rate: 6, limit: 30 },
        shape: { type: "circle", radius: 10 },
        direction: { angle: 90, spread: 25 },
        initial: { lifetime: [2.2, 3], speed: [30, 50], size: [40, 60], rotation: [0, 360], angularVelocity: [-30, 30], color: "#9a9aa0", alpha: [0.5, 0.7] },
        overLifetime: { size: [[0, 0.6], [1, 2.2]], alpha: [[0, 0], [0.2, 1], [1, 0]] },
        affectors: [{ type: "gravity", x: 15, y: 0 }],
      }],
    },
  },
  snow: {
    description: "Wide band of snowflakes drifting down.",
    effect: {
      name: "snow", duration: 4, loop: true,
      emitters: [{
        name: "snow", texture: "soft-circle", blend: "normal",
        emission: { type: "continuous", rate: 20, limit: 120 },
        shape: { type: "line", width: 500 }, transform: { y: 200 },
        direction: { angle: -90, spread: 20 },
        initial: { lifetime: [3, 4], speed: [50, 90], size: [6, 14] },
        overLifetime: { alpha: [[0, 0], [0.1, 1], [0.85, 1], [1, 0]] },
        affectors: [{ type: "turbulence", strength: 40, frequency: 0.01, speed: 0.5 }],
      }],
    },
  },
  confetti: {
    description: "Celebration burst of coloured squares tumbling down.",
    effect: {
      name: "confetti", duration: 2.5, loop: false,
      emitters: [{
        name: "confetti", texture: "square", blend: "normal",
        emission: { type: "burst", bursts: [{ time: 0, count: 50 }], limit: 60 },
        direction: { angle: 90, spread: 70 },
        initial: { lifetime: [1.8, 2.5], speed: [250, 420], size: [8, 14], rotation: [0, 360], angularVelocity: [-540, 540] },
        overLifetime: { alpha: [[0, 1], [0.8, 1], [1, 0]], color: [[0, "#ff4060"], [0.33, "#ffd040"], [0.66, "#40d0ff"], [1, "#80ff60"]] },
        affectors: [{ type: "gravity", y: -500 }, { type: "drag", amount: 1.8 }],
      }],
    },
  },
  shockwave: {
    description: "Single expanding ring that fades — impacts, landings.",
    effect: {
      name: "shockwave", duration: 0.6, loop: false,
      emitters: [{
        name: "ring", texture: "ring", blend: "additive",
        emission: { type: "burst", bursts: [{ time: 0, count: 1 }], limit: 1 },
        direction: { spread: 0 },
        initial: { lifetime: 0.6, speed: 0, size: 40, rotation: 0, color: "#a0e0ff" },
        overLifetime: { size: [[0, 0.2], [1, 5]], alpha: [[0, 1], [1, 0]] },
      }],
    },
  },
  comet: {
    description: "Glowing head orbiting a loop path, leaving a stretched, fading trail (world space + rate over distance).",
    effect: {
      name: "comet", duration: 2, loop: true,
      emitters: [{
        name: "trail", texture: "soft-circle", blend: "additive", simulationSpace: "world",
        emission: { type: "continuous", rate: 10, rateOverDistance: 12, limit: 160 },
        motion: { enabled: true, points: [[-160, 0], [0, 90], [160, 0], [0, -90]], closed: true, smooth: true },
        transform: { inheritVelocity: 0.15 },
        direction: { spread: 360 },
        initial: { lifetime: [0.5, 0.8], speed: [10, 30], size: [18, 30] },
        overLifetime: { size: [[0, 1], [1, 0.1]], alpha: [[0, 1], [1, 0]], color: [[0, "#ffffff"], [0.3, "#7fd8ff"], [1, "#3040ff"]] },
        affectors: [{ type: "drag", amount: 2 }, { type: "velocityStretch", amount: 1, max: 3, minSpeed: 10 }],
      }],
    },
  },
  rain: {
    description: "Slanted rain streaks blown by gusty wind.",
    effect: {
      name: "rain", duration: 2, loop: true,
      emitters: [{
        name: "rain", texture: "dash", blend: "normal", simulationSpace: "world",
        emission: { type: "continuous", rate: 60, limit: 120 },
        shape: { type: "line", width: 600 }, transform: { y: 260 },
        direction: { angle: -90, spread: 4 },
        initial: { lifetime: [0.9, 1.1], speed: [450, 550], size: [26, 36], color: "#a8c8ff", alpha: [0.4, 0.7] },
        overLifetime: { alignToVelocity: true, alpha: [[0, 0], [0.1, 1], [0.9, 1], [1, 0]] },
        affectors: [{ type: "wind", angle: 0, strength: [120, 180], turbulence: 0.6, frequency: 0.3 }],
      }],
    },
  },
  "hex-shield": {
    description: "Hexagon sparks fanned evenly in a ring, pulsing outward (uniform distribution).",
    effect: {
      name: "hex_shield", duration: 1.2, loop: true,
      emitters: [{
        name: "hexes", texture: "hexagon", blend: "additive",
        emission: { type: "burst", bursts: [{ time: 0, count: 24 }, { time: 0.6, count: 24 }], limit: 60 },
        direction: { spread: 360, distribution: "uniform" },
        initial: { lifetime: 0.9, speed: 90, size: 12, rotation: 0, color: "#70ffd0", alpha: 0.8 },
        overLifetime: { size: [[0, 0.4], [0.3, 1], [1, 0.6]], sizeY: [[0, 0.4], [0.3, 1.2], [1, 0.3]], alpha: [[0, 0], [0.2, 1], [1, 0]], spin: [[0, 1], [1, 0]] },
        affectors: [{ type: "drag", amount: 2.5 }],
      }],
    },
  },
  portal: {
    description: "Swirling vortex of violet sparks orbiting the centre.",
    effect: {
      name: "portal", duration: 2, loop: true,
      emitters: [{
        name: "swirl", texture: "spark", blend: "additive",
        emission: { type: "continuous", rate: 40, limit: 100 },
        shape: { type: "circle", radius: 90, edgeOnly: true },
        direction: { mode: "outward", angle: 0, spread: 10 },
        initial: { lifetime: [0.9, 1.3], speed: [10, 30], size: [16, 26] },
        overLifetime: { alignToVelocity: true, alpha: [[0, 0], [0.2, 1], [1, 0]], size: [[0, 1], [1, 0.4]], color: [[0, "#e0a0ff"], [1, "#5020ff"]] },
        affectors: [{ type: "vortex", strength: 320 }, { type: "attractor", strength: 140 }],
      }],
    },
  },
};
