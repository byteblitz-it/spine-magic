---
name: spine-vfx
description: Create, tune and export particle effects (VFX) for Spine 2D skeletal animation using the SpineMagic MCP tools — sparks, coins, magic, fire, smoke, explosions, trails, hit effects, auras, confetti, rain, portals — and bake them into a character's skeleton so they follow a bone (hand, weapon, joint) inside its animation. Use this whenever the user wants a game effect or particle animation for Spine or a Spine-based engine (Unity spine-unity, Cocos Creator, Godot, PixiJS/Phaser spine, spine-player), wants an effect stuck to or trailing from a character's bone, wants to recreate an effect from a reference image, GIF or another particle tool, asks to export particles as Spine JSON/atlas, or wants to lighten or fix an existing SpineMagic effect — even if they never say "SpineMagic" or "MCP".
---

# Spine VFX with SpineMagic

Spine has no particle system. An effect is **baked**: every particle that is alive at the same time
occupies a "lane" (one bone + one slot) whose translate/rotate/scale/colour/attachment keys are
recorded frame by frame. SpineMagic does the simulation, the baking, and validation against the real
Spine runtime. Your job is the creative and technical direction: turn a brief into parameters, look at the
result, iterate, and ship files the user can drop into their game.

Never write Spine skeleton JSON by hand. Hand-written particle skeletons almost always break on load
(version-specific key names, atlas regions, loop seams) and you cannot see what they look like. Use the tools.

## 0. Check the tools are there

You need the `spinemagic` MCP tools (`create_effect`, `preview_effect`, `export_spine`, …). If they are
not available, stop and tell the user how to connect them (see `references/setup.md`) rather than
improvising — there is no useful fallback.

On first use in a session, call `get_effect_reference` once. It is the authoritative list of every field,
default and unit, and it stays in sync with the server version; this skill only covers judgment.

## 1. Pin down the brief

Settle these before building. Use the user's words and any reference image; ask only for what you cannot
reasonably default, in one short message.

| Question | Why it matters | Default if unknown |
|---|---|---|
| Loop or one-shot? | Loops bake a seamless cycle; one-shots end when the last particle dies | Ambient (aura, fire, rain) → loop; impact (hit, coin burst, explosion) → one-shot |
| Target Spine version | Export format differs by version | Ask; if unknown export `"all"` |
| Platform | Bone budget (see §5) | Mobile — the cautious choice |
| On-screen size | Particle size and speed scale with it | ~200–400 px tall effect |
| Background | Additive glow vanishes on white | Dark |
| Sprite art | Custom sprites must be PNG files on disk | Builtin textures |

## 2. Build: start from the closest preset

`list_presets`, then `create_effect` with `preset` + a partial `effect` override. Presets already
have sensible curves and affectors; starting from one is faster and looks better than building from
`{}`. Name the effect after the brief (it becomes the export file name).

Multi-part effects (an impact = flash + sparks + smoke + ring) work best as several emitters in one effect —
`add_emitter` with `fromPreset`, drawn in list order (later = on top).

## 3. Look, critique, adjust — the loop that makes it good

Call `preview_effect` after every meaningful change and actually inspect the image: it is a contact sheet of
frames left→right, top→bottom; the green cross is the effect origin. Judge it against the brief, then make
targeted `update_emitter` patches. Two or three rounds is normal.

Critique checklist — the usual problems and the fix:

- **Particles pop in/out** → alpha curve must start and end near 0 (`[[0,0],[0.1,1],[0.7,1],[1,0]]`).
- **Looks uniform / CG-fake** → turn single values into ranges (`size: [20,36]`, `speed: [60,140]`, `lifetime: [0.8,1.3]`), add a little rotation spread.
- **A clump that doesn't read** → widen `direction.spread`, use a `circle`/`line` shape, or lower density.
- **Too sparse / too dense** → `emission.rate` (continuous) or burst `count`; remember density ≈ rate × lifetime.
- **Floaty when it should be punchy** → higher initial speed + `drag` (quadratic for a sharp stop) + gravity.
- **Sparks look like dots** → texture `spark`/`dash`, `alignToVelocity: true`, `velocityStretch` affector.
- **Glow looks muddy or invisible** → additive for light/fire/magic; normal for solid things (coins, rocks, smoke, confetti). Colourful custom art → `colorize: false`.
- **Cut off at the edges of the preview** → the effect is larger than you think; reduce speed/lifetime or tell the user its real size.
- **Moving effects (trails, comets)** → `motion` path + `simulationSpace: "world"` leaves a trail; `"local"` makes particles ride along with the emitter.
- **A trail of dots should be one solid streak (sword arc, dash)** → `ribbon.enabled` — a single mesh, so it costs one bone instead of dozens of particles.
- **Objects that should spin or flicker (coins, flames, leaves)** → `sprite.frames` flipbook (builtin `spin-1…4`, `flicker-1…4`, or the user's frames) with `randomStart`; mixed debris → `sprite.mode: "random"`.

Patching rules that avoid surprises: objects deep-merge, **arrays replace wholesale** (send the full curve,
affector list or point list), and `null` resets a field to its default.

## 4. Matching a reference image or another tool

Read the reference like a VFX artist and translate cue by cue — see `references/art-direction.md` for the
full cue → parameter table and motion vocabulary. In short: direction of travel → `direction.angle`
(Y is up: 90 = up, -90 = down); how wide it fans → `spread`; how far it travels before fading → speed ×
lifetime; fade position → alpha curve; glow → additive; colour ramp → `overLifetime.color`; object
sprites (coins, leaves) → custom PNG with `colorize: false`. Then compare your preview side by side with
the reference and say what still differs.

## 5. Budgets — keep it shippable

Cost is reported as `cost.lanes` (= Spine bones and slots) and `cost.keys` on every create/update/preview.
Bones are what hurt at runtime, especially on mobile.

| Platform | Comfortable bones per effect | Hard ceiling |
|---|---|---|
| Mobile / web | ≤ 60 | ~120 |
| Desktop / console | ≤ 150 | ~300 |

Lanes per emitter ≈ rate × average lifetime (continuous) or the burst count. Levers, cheapest first:
lower `lifetime` → lower `rate`/burst count → set `emission.limit` (excess particles are dropped; watch
`cost.dropped`) → fewer emitters. Keys (file size) drop with lower `fps` (24 is usually fine) or a higher
`tolerance` on export (1–2 is still clean). Tell the user the final bones/keys numbers.

## 6. Export and hand over

`export_spine` with the version(s) the user needs (`"all"` when unsure). It validates automatically by
loading and playing the export in the matching official Spine runtime (3.8 is a vendored official build,
4.0–4.3 come from npm). If validation fails, report the error; don't hide it.

Finish with a short hand-over:
- what the effect is and how it loops (or that it plays once),
- the files written (`.json`, `.atlas`, `.png` per version) and where,
- bones / keys, and anything dropped by the limit,
- how to use it: import the `.json` in the Spine editor (Import Data), or load JSON + atlas in the game runtime and play the animation named `animation`.

## 7. Put it on a character

Spine animators usually want the effect *on* their character: glowing on a hand, sparks off a sword, a trail
behind a swing. Use `attach_effect` — it bakes the effect into a copy of the character skeleton, under one of
its bones and inside one of its animations, so it opens in the Spine editor already riding on the character.

1. `inspect_character` on the character's skeleton: `.json` (3.8–4.3) or binary `.skel` (3.8, 4.2 — the merged result is written as JSON)
   to see bones, slots in draw order, and animations with durations. Choose the bone from the user's words
   ("right hand", "sword tip") — ask if several fit.
2. Build or tune the effect as usual. Size it for the character: preview_effect shows it alone, so compare its
   size with the character's (the inspect output has the bones; the user can tell you the character's height).
3. `attach_effect` with `bone`, `animation`, and:
   - `mode: "follow"` — everything moves rigidly with the bone (auras, glows, held magic). `inheritRotation: false`
     keeps it upright while the bone spins; `inheritScale: false` keeps its size.
   - `mode: "trail"` — world-space emitters emit from the bone's animated path and leave trails (sword swings,
     dashes). It is baked for that one animation.
   - `startTime` for one-shots (the hit frame of an attack); looping effects take the animation's length.
   - `slot` + `place` to draw it above/below a body part (behind the body for back glows).
4. Read the result: `validation` (loaded and played in that version's runtime), `followError` (should be 0),
   added/total bones, and `warnings` — relay them, especially the premultiplied-alpha one for 3.8 characters.

It writes `<character>_fx.json/.atlas` + `fx_<effect>.png` next to the original and never overwrites it.
Re-attaching the same effect replaces its previous copy; attach a second effect to the `_fx.json` to stack;
`detach_effect` removes one. Bones added here count toward the character's budget — mention the total.
See `references/spine-integration.md` §5 for details and engine-side notes.

## Reference files

- `references/art-direction.md` — reference-image cue table, motion vocabulary, recipes for common effects. Read when designing or matching a look.
- `references/spine-integration.md` — versions, budgets in depth, engine loading notes, binding effects into characters. Read when the user asks how to use the export, targets a specific engine, or wants the effect on a character.
- `references/examples.md` — four complete worked sessions (coin burst from an image, comet trail, layered hit impact, sword trail on a character) with the exact tool calls. Read once if you are unsure how the loop should feel.
- `references/setup.md` — connecting the MCP server, custom textures, the optional web editor.
