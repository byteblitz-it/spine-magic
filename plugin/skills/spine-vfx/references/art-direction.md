# Art direction for particle effects

## Contents
1. Reading a reference image (cue → parameter)
2. Motion vocabulary
3. Recipes
4. Layering multi-part effects

## 1. Reading a reference image

A still frame of an effect still tells you most of what you need. Work through the cues in this order and
write down the value you chose for each, so you can explain the mapping to the user.

| Cue in the image | Parameter | How to read it |
|---|---|---|
| Where particles come from | `shape` | One tight origin → `point`; a ring of origins → `circle` + `edgeOnly`; a band (rain, snow) → `line` with `width`; a patch → `rectangle` |
| Direction they travel | `direction.angle` | Y is up: 90 up, -90 (or 270) down, 0 right, 180 left. Curved paths (arcs falling down) come from gravity, not the angle |
| How wide they fan | `direction.spread` | Measure the cone at the origin: a thin stream 10–20°, a fountain 40–70°, an explosion 360 |
| How far before vanishing | `initial.speed`, `initial.lifetime` | distance ≈ speed × lifetime (minus drag); pick lifetime from the brief's feel (0.3–0.6 s snappy, 1–2 s ambient, 3+ s slow smoke) |
| Where they fade | `overLifetime.alpha` | Faded near the origin → fade-in at the start; faded at the far end → `[[0,1],[0.6,0.9],[1,0]]` |
| Size change along the path | `overLifetime.size` | Shrinking sparks `[[0,1],[1,0.2]]`; growing smoke `[[0,0.6],[1,2]]` |
| Size variety | `initial.size` range | Count distinct sizes: big spread → `[0.6×, 1.4×]` of the typical size |
| Glow / light bloom | `blend` | Glow that brightens overlaps → `additive`; solid objects that occlude → `normal` |
| Colour ramp | `overLifetime.color` | Sample the colour at the origin and at the tail; hot effects go white → yellow → orange → red |
| Object sprites (coins, leaves, gems, shards) | `texture` + `colorize: false` | Needs a PNG on disk; keep its own colours |
| Squashed or edge-on sprites | `overLifetime.sizeY` | Coins/cards flipping: oscillate sizeY between 1 and ~0.3 |
| Motion streaks | `velocityStretch` / `spark` + `alignToVelocity` | Streak length ∝ speed |
| Swirl | `vortex` affector | Direction of swirl = sign of strength |
| Wobble / flicker | `turbulence` | Low frequency + low strength for smoke; high for electric |
| Sideways drift | `wind` or gravity x | Gusty → wind `turbulence` 0.3–0.8 |
| A trail behind something moving | `motion` path, `simulationSpace: "world"`, `rateOverDistance` | |

Then preview and compare: say plainly what matches and what still differs (e.g. "yours is denser at the top").

## 2. Motion vocabulary

Translate feelings into physics:

- **Punchy / impactful** — high initial speed, quadratic drag (sharp stop), short lifetime, a bright first frame (burst with white → colour gradient).
- **Floaty / magical** — low speed, no gravity or slight negative gravity ("Rise"), turbulence, long soft fade, star or soft-circle, additive.
- **Heavy** — gravity -1500 to -2500 or `useWeight` with weight > 1, little drag, normal blend.
- **Juicy (game feel)** — overshoot in size (`[[0,0.3],[0.15,1.2],[0.3,1],[1,0.6]]`), slight spin, colour shift, a second layer of tiny sparks.
- **Calm / ambient** — loop, low rate, long lifetime, wide shape, gentle turbulence.
- **Electric** — dash/spark texture, very short lifetime (0.1–0.25 s), high turbulence strength and frequency, additive, cyan/white.

## 3. Recipes

Start values; tune by eye.

| Effect | Key settings |
|---|---|
| Coin burst / fountain | custom coin PNG, `colorize:false`, normal blend, direction up or down with spread 40–70, gravity -300 to -980, `sizeY` flip curve, angularVelocity ±60 |
| Hit spark | burst 12–20, spread 360 (or 120 toward the hit normal), speed 300–600, `spark` + alignToVelocity, quadratic drag 2, lifetime 0.2–0.4, white → yellow |
| Magic aura | loop, circle radius 40–80, direction up spread 30, star/soft-circle, additive, turbulence 40–60, alpha fade in/out, cyan → violet |
| Fire | loop, line width 30–60, up, soft-circle additive, size shrinking, yellow → orange → dark red, attractor above + turbulence |
| Smoke | loop, normal blend, `smoke` texture, grey, size growing to 2×, slow speed, lifetime 2–3, wind x 10–30 |
| Explosion | burst 40–80 spread 360, quadratic drag, size shrink, white → orange → red, + a ring layer and a smoke layer |
| Shockwave | burst 1, `ring`, speed 0, size curve 0.2 → 5, alpha 1 → 0, lifetime 0.4–0.6 |
| Comet / trail | motion path, world space, rateOverDistance 8–15, lifetime 0.5–0.8, velocityStretch, white → blue |
| Rain | line width = screen, `dash`, alignToVelocity, speed 450–550 down, wind with gusts |
| Confetti | burst 40–60 up spread 70, `confetti`, angularVelocity ±540, gravity -500, drag 1.8, multicolour gradient |
| Level-up pillar | loop, line width 60, up, `dash` + alignToVelocity, additive, gold, plus a slow `star` layer |

## 4. Layering multi-part effects

Strong game VFX are usually 2–4 simple layers, each doing one job, rather than one complicated emitter:

1. **Flash** — 1 particle, big, very short (0.08–0.15 s), additive white.
2. **Main body** — the thing the effect is about (sparks, coins, flames).
3. **Secondary detail** — tiny fast sparks or slow drifting embers, different timing.
4. **Residue** — smoke, ring, or dust that lingers after the main body.

Give each emitter a clear name; order them back → front. Budget the bones across all layers together.
