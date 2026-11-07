/** Agent-facing reference for the effect document. Keep in sync with schema.ts. */
export const EFFECT_REFERENCE = `# SpineMagic effect reference

An effect is a JSON document. Every field is optional and has a default, so send only what you change.
Units: pixels, seconds, degrees. Y points UP (Spine convention). Angle 0 = right, 90 = up.
Range = number | [min, max] (uniform random per particle).
Curve = [[t, value], ...] piecewise linear; t is normalized particle age 0..1 (or effect time 0..1 for rateOverTime).
Gradient = [[t, "#rrggbb"], ...].

## Effect
| field | default | notes |
|---|---|---|
| name | "effect" | also the export file name |
| fps | 30 | bake rate (10-60). Higher = smoother but more keys |
| duration | 2 | loop length (loop=true) or emission length (loop=false) |
| loop | true | true = seamless loop with built-in prewarm; false = plays once, tails finish |
| seed | 12345 | change for a different random variation of the same look |
| emitters | [ {} ] | one or more emitters, drawn in order (later = on top) |

## Emitter
| field | default | notes |
|---|---|---|
| name | "emitter" | |
| enabled | true | |
| texture | "soft-circle" | builtin name (see list_textures) or path to an 8-bit PNG |
| pivot | [0.5,0.5] | sprite origin, 0..1 from texture left/top (rotation + scale happen around it) |
| colorize | true | false = keep the texture's own colours (ignore initial.color / overLifetime.color) |
| sprite.frames | [] | several sprites (builtins or PNG paths); non-empty replaces texture. Builtin flipbooks: spin-1…spin-4 (coin turning), flicker-1…flicker-4 (flame) |
| sprite.mode | "flipbook" | random = each particle keeps one random frame (mixed debris, leaves); flipbook = frames play in order |
| sprite.fps | 12 | flipbook frame rate; 0 = the frames play once across the particle's lifetime |
| sprite.loop | true | flipbook wraps (false = holds the last frame) |
| sprite.randomStart | false | flipbook starts on a random frame per particle (de-syncs spinning coins) |
| blend | "additive" | normal / additive (glow, fire, magic) / multiply / screen |
| simulationSpace | "local" | local: particles parented to an emitter bone (they travel with a moving emitter). world: left behind = trails |
| emission.type | "continuous" | continuous / burst |
| emission.rate | 10 | particles per second (continuous) |
| emission.rateOverTime | none | Curve multiplier on rate across the effect duration, e.g. [[0,1],[0.5,0],[1,1]] |
| emission.rateOverDistance | 0 | extra particles per 100 px the emitter travels (needs motion) — dense trails |
| emission.bursts | [{time:0,count:20}] | burst list (burst) |
| emission.limit | 200 | max simultaneous particles = max Spine bones/slots for this emitter |
| shape.type | "point" | point / circle (radius) / rectangle (width,height) / line (width, horizontal) |
| shape.edgeOnly | false | spawn on the outline only |
| direction.angle | 90 | launch angle |
| direction.spread | 30 | cone width in degrees (360 = all directions) |
| direction.mode | "angle" | "outward" = launch away from the shape centre |
| direction.distribution | "random" | "uniform" = evenly fanned across the spread (perfect rings with burst + spread 360) |
| transform | {x:0,y:0,rotation:0,scale:1} | emitter placement |
| transform.inheritVelocity | 0 | 0..1: particles get this fraction of the moving emitter's velocity |
| motion.enabled | false | emitter travels along a path over the duration |
| motion.points | 4-point loop | [[x,y],...] relative to transform (≥2) |
| motion.closed / smooth | true / true | closed loop; Catmull-Rom smoothing |
| motion.loops | 1 | laps per duration — whole numbers keep loops seamless |
| motion.mode | "loop" | loop / pingpong / once |
| initial.lifetime | [0.8,1.2] | seconds |
| initial.speed | [80,120] | px/s |
| initial.size | [24,40] | px (longest texture edge) |
| initial.rotation | [0,360] | degrees |
| initial.angularVelocity | 0 | deg/s |
| initial.color | "#ffffff" | tint, multiplied with overLifetime.color |
| initial.alpha | 1 | |
| initial.weight | 1 | heavier = falls faster (gravity useWeight) and resists wind |
| overLifetime.size | [[0,1],[1,1]] | multiplier |
| overLifetime.sizeY | none | separate height curve (squash & stretch); omitted = same as size |
| overLifetime.alpha | [[0,0],[0.1,1],[0.7,1],[1,0]] | multiplier — keep the ends at 0 for clean pops |
| overLifetime.speed | [[0,1],[1,1]] | multiplier |
| overLifetime.spin | [[0,1],[1,1]] | multiplier on angularVelocity |
| overLifetime.color | none | gradient |
| overLifetime.alignToVelocity | false | rotate along motion (use with "spark" / "dash") |
| affectors | [] | see below; each has enabled:true and runs in list order |
| ribbon.enabled | false | smooth textured strip trailing the emitter's path (one Spine mesh + deform keys; costs 1 bone). Needs motion.enabled or attach_effect mode "trail"; a still emitter has no trail |
| ribbon.length | 0.35 | seconds of path history the strip covers |
| ribbon.width | 28 | px at the head |
| ribbon.widthOverLength | [[0,1],[1,0]] | width multiplier head (t=0) → tail (t=1) |
| ribbon.segments | 16 | quads along the length (2 vertices each); more = smoother curves, more deform data |
| ribbon.texture | "ribbon" | builtin "ribbon" fades head → tail; any texture works (u runs along the length) |
| ribbon.color / ribbon.alpha | "#ffffff" / 1 | tint; blend follows the emitter's blend |

## Affectors
- {type:"gravity", x:0, y:-300, useWeight:false} — acceleration px/s². Presets: Earth y:-981, Floaty -150, Heavy -2000, Rise +300
- {type:"drag", amount:1, mode:"linear"|"quadratic", x:1, y:1} — damping; quadratic bites harder at speed; x/y = per-axis
- {type:"wind", angle:0, strength:[25,50], turbulence:0, frequency:0.05} — push px/s² (÷ weight), turbulence = gusts
- {type:"velocityStretch", amount:0.5, max:4, minSpeed:50, volume:0.5, align:true} — lengthen along motion
- {type:"vortex", x:0, y:0, strength:180} — swirl around a point (relative to emitter); negative = clockwise
- {type:"attractor", x:0, y:0, strength:300, radius:10} — pull toward a point; negative = push
- {type:"turbulence", strength:100, frequency:0.01, speed:1} — smooth noise wobble
Disable one without deleting: {enabled:false}.

## How it becomes Spine
Spine has no particles: each simultaneous particle becomes a bone + slot ("lane") with baked keys.
A moving local-space emitter becomes an animated emitter bone. Cost ≈ lanes (bones/slots) and keys;
preview_effect and export_spine report both. To lighten an export: lower emission.limit / rate / lifetime,
lower fps, or raise export tolerance.

## Recipes
- Glow/magic: additive, soft-circle or star, alpha curve fading in and out, colour gradient light → saturated.
- Sparks: texture "spark", alignToVelocity:true, high speed, drag, gravity — add velocityStretch for speed.
- Comet / trail: motion.enabled, simulationSpace "world", rateOverDistance 8-15, short lifetime, velocityStretch.
- Rain: texture "dash", alignToVelocity, high downward speed, wind with turbulence.
- Smoke: blend normal, texture "smoke", grey colour, size grows (overLifetime.size up to ~2), slow speed, long lifetime.
- Explosion: burst, spread 360, drag 1-2 (quadratic for a sharp stop), size shrinking, colour white → orange → red.
- Perfect ring: burst, spread 360, distribution "uniform".
- Sword arc / dash streak / comet tail: ribbon.enabled true on an emitter with motion (or attach_effect mode "trail"), simulationSpace "world", length 0.3–0.5 s, width 20–40, blend additive; emission.rate 0 for a ribbon only, or rateOverDistance for sparks shed along it.
- Spinning coins: sprite.frames spin-1…spin-4 (or the user's coin frames), mode flipbook, fps ~12, randomStart true, blend normal, colour #ffcc33 (colorize:false for full-colour art).
- Mixed debris / leaves: sprite.frames with several PNGs, mode random.
- Shockwave: burst count 1, texture "ring", speed 0, size curve 0.2 → 5, alpha 1 → 0.
- Pulsing emission: rateOverTime [[0,1],[0.5,0.1],[1,1]].
- Seamless loops: loop:true. Burst effects loop each duration; motion.loops whole numbers.

## Putting an effect on a character
attach_effect bakes the effect INTO a copy of a character skeleton (Spine 3.8–4.3 JSON) under one bone and
inside one animation: inspect_character → attach_effect {id, character, bone, animation, mode, …} →
<character>_fx.json/.atlas + fx_<effect>.png next to the original (never overwritten), validated in that
version's runtime.
- mode "follow": rides rigidly on the bone (auras, glows). inheritRotation/inheritScale false = stay upright / keep size.
- mode "trail": world-space emitters emit from the bone's animated path → trails (sword swings). Baked for that animation.
- startTime: one-shot start inside the animation. Looping effects take the animation's length (matchLoop).
- slot + place: draw-order position (e.g. below "arm"). Default on top.
- premultiplied: "auto" matches the character atlas (4.x pma flag; 3.8 assumed premultiplied — confirm with the user).
- emitter.transform x/y = offset in the bone's space. Re-attach replaces; attach to the _fx file to stack; detach_effect removes.

## Workflow
1. create_effect (from a preset close to the brief) → 2. preview_effect and LOOK at the image →
3. update_effect / update_emitter → repeat 2-3 → 4. export_spine (validates automatically),
or attach_effect to bake it onto a character bone.
`;
