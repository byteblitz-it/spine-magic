# SpineMagic — Design

Particle-effect authoring for Spine, driven by AI agents through MCP (a web editor comes later on the same core).

## Goal

An agent says *"make a blue magic burst, additive, 1.5 s loop"* and gets a Spine skeleton
(JSON + atlas + PNG) that loads in Spine **3.8, 4.0, 4.1, 4.2, 4.3**. The agent never writes Spine JSON by hand —
it edits a small validated **effect document**, previews it as images, and exports.

## Key fact: Spine has no particle system

Particles must be **baked**: a fixed pool of bones+slots ("lanes"), each with per-frame keys
(translate / rotate / scale / color / attachment). A lane is reused by successive particles.

## Pipeline

```
EffectDoc (zod-validated JSON)
   │ simulate()     deterministic, seeded, per-particle independent
   ▼
ParticleTracks      list of particles: birth time, samples per frame
   │ assignLanes()  greedy interval colouring (circular when looping)
   ▼
Lanes               lane → [particle segments]
   │ bake(version)  keys per frame → reduce collinear keys → version adapter
   ▼
Spine JSON + .atlas + .png        ── validate() loads 4.x output in real spine-core runtime
   └ preview()      software rasterizer → PNG contact sheet (for agent vision)
```

### Determinism and seamless loops
- PRNG: mulberry32, seeded per particle from `hash(effect.seed, emitterIndex, particleIndex)`, so editing one
  emitter never reshuffles another.
- Particles do not interact, and affectors depend only on a particle's own state, so a particle's
  state is a pure function of its age. When looping with duration `D`, spawns are scheduled on `[0, D)` and every
  particle's life is wrapped modulo `D`. This makes frame `D` identical to frame `0`, which means a seamless loop with built-in prewarm.
- Non-looping: linear time; animation length = `duration + max lifetime` (tails finish).

### Baking rules
- One bone + slot per lane. `simulationSpace: local` → lane bones parented to the emitter bone; `world` → root.
- Region size = texture size; particle size → bone scale.
- At a lane hand-over (particle A dies, B is born) the last key of A is `stepped` so A never tweens into B.
- The attachment timeline hides the lane (`null`) while it is empty.
- Key reduction: drop a key when linear interpolation of its neighbours reproduces it within tolerance
  (per channel), which keeps exports light.

### Version adapters (only differences that matter for our subset)
| | 3.8 | 4.0 – 4.3 |
|---|---|---|
| rotate key | `angle` | `value` |
| slot colour timeline | `color` | `rgba` |
| stepped | `"curve":"stepped"` | `"curve":"stepped"` |
| rotation interp | shortest path | linear (we emit unwrapped angles) |
| `skeleton.spine` | `3.8.99` | `4.x.00` |

Atlas uses the legacy text format, which 3.8 and 4.x runtimes both read.

## Effect document (v1)

```
Effect   { name, fps=30, duration=2, loop=true, seed, emitters[] }
Emitter  { name, enabled, texture, blend: normal|additive|multiply|screen,
           simulationSpace: world|local,
           emission: { type: continuous|burst, rate, bursts[{time,count}], limit },
           shape:     { type: point|circle|rectangle|line, radius, width, height, edgeOnly },
           direction: { angle, spread },              // degrees, 90 = up
           transform: { x, y, rotation, scale },
           initial:   { lifetime, speed, size, rotation, angularVelocity, color, alpha }, // number | [min,max]
           overLifetime: { size, alpha, speed : Curve, color: Gradient, alignToVelocity },
           affectors: [ gravity | drag | vortex | attractor | turbulence ] }
Curve    [[t 0..1, value], ...]        Gradient [[t, "#rrggbb"], ...]
```
Grouped like the editor's panels (Emitter / Shape / Direction / Transform / Initial / Lifetime / Affectors).

## MCP surface

| tool | purpose |
|---|---|
| `get_effect_reference` | parameter docs + example (also exposed as a resource) |
| `list_presets`, `list_textures` | discover, don't invent |
| `create_effect` | from preset or full doc |
| `get_effect`, `list_effects` | read state |
| `update_effect` | deep-merge patch; emitter ops (add / remove / replace) |
| `preview_effect` | PNG contact sheet + stats (particles, lanes, keys) |
| `export_spine` | version, out dir, optimize tolerance → file paths |
| `validate_export` | load in spine-core 4.0/4.1/4.2/4.3 (structural check for 3.8) |

Effects persist as JSON in `./projects/` so humans and the future web editor share them.

## v0.2 additions
Emitter motion path (Catmull-Rom, arc-length, loop/pingpong/once) → animated emitter bone in local space;
inherit velocity; emission density = rate × rateOverTime + rateOverDistance × emitter speed; uniform direction
distribution; weight; wind; velocity stretch, separate size axes → independent scaleX/scaleY keys; spin over life;
quadratic / per-axis drag; sprite pivot → region attachment offset; colorize; per-affector enabled flag.

## v0.3: effects inside characters
`src/core/character.ts` (browser-safe, shared by MCP and editor) merges a baked effect into a copy of a
3.8–4.3 character: anchor bone `fx_<e>__anchor` under the target bone (inherit mode → `transform` 3.8–4.1 /
`inherit` 4.2+), effect bones/slots/attachments/regions prefixed `fx_<e>__`, slots inserted at a draw-order
slot, keys merged into one animation (time-shifted for one-shots, loop length matched), page appended to the
atlas in the character's alpha mode. Trail mode samples the bone's world path with the version's runtime
(Node: vendored 3.8 / npm 4.x; browser: 3.8 webgl build / spine-webgl 4.2), converts it to root-bone space and
feeds it as a time-uniform motion track (`motion.timing: "time"`) to world-space emitters, baked under
`fx_<e>__root`. Re-merge removes the previous copy by prefix first. Every merge is validated by loading and
playing all animations in the runtime and checking the anchor's world position against the bone.

## Not yet (needs new Spine attachment paths)
Ribbon trails (mesh + deform keys), flipbook / sequence sprites, bone following (import user skeleton),
generic parameter keyframes, binary `.skel`, Spine 3.6/3.7, sub-emitters.

## Layout
```
src/core/   browser-safe: schema, math, simulate, lanes, bake, atlas, png (fflate), textures, render, presets, merge
src/node/   node-only: file textures, export to disk, runtime validation (spine-core 4.0–4.3)
src/mcp/    server.ts (stdio), store.ts
web/        Vite + React + PixiJS editor; api-plugin.ts serves projects/ + SSE change feed
test/       vitest
```
The editor and the MCP server share `projects/`: the dev-server API watches the folder and pushes changes to the
open editor over SSE, so agent and human edit the same document. Spine preview = bake 4.3 in the browser →
`spine-pixi-v8`.
