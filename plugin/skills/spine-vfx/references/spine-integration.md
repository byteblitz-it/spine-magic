# Using SpineMagic exports in Spine and in game engines

## Contents
1. Choosing the version
2. What the export contains
3. Budgets in depth
4. Engine notes
5. Binding an effect into a character

## 1. Choosing the version

Export the version that matches the **runtime** the game uses (major.minor), not the newest one.
A 4.2 skeleton will not load in a 3.8 runtime and vice versa. When the user does not know, export `"all"` —
each version lands in its own folder — and tell them to use the folder matching their runtime.

Validation: every export is loaded and played through the matching official runtime — 4.0–4.3 from
`@esotericsoftware/spine-core` on npm, 3.8 from the official spine-ts 3.8 build vendored in the repository
(Esoteric does not publish 3.8 on npm).

## 2. What the export contains

Per version: `<name>.json` (skeleton), `<name>.atlas` (legacy text format, readable by 3.8 and 4.x),
`<name>.png` (atlas page). The skeleton has:

- a `root` bone; in local space, an emitter bone per emitter (animated when the emitter has a motion path);
- one bone + slot per lane, named `<emitter>_<index>_p<lane>`;
- one animation named `animation` — looping effects are seamless when played with loop on;
- slot blend modes (additive/multiply/screen) set per emitter.

Standalone exports use straight (non-premultiplied) alpha. Effects baked into a character match the
character's atlas instead (see §5).

## 3. Budgets in depth

- **Bones/slots** = lanes. Each lane costs a bone transform and a draw every frame, whether or not a particle is
  visible on it. This is the number that matters on mobile.
- **Keys** = file size and load time; they barely affect frame time.
- Lanes ≈ peak simultaneous particles. For continuous emission that is about rate × lifetime; bursts add
  their whole count at once.
- Several effects on screen at once multiply: ten 60-bone effects = 600 bones.
- Spine skeletons are not pooled like engine particles: if the game spawns many copies, suggest a
  lighter variant for repeated use (lower limit, shorter life).

## 4. Engine notes

General: import/load the `.json` + `.atlas` + `.png` with the runtime that matches the version; play
`animation` (loop for ambient effects, once for impacts). Because textures are straight alpha, disable
premultiplied-alpha in the runtime or material where that is an option, otherwise edges can look dark.

- **Spine editor** — Spine → Import Data → choose the `.json`. Images are referenced from the atlas folder.
- **Unity (spine-unity)** — rename `<name>.atlas` to `<name>.atlas.txt` before dropping the three files into
  Assets; Unity then creates the SkeletonData asset. Use the spine-unity package version matching the export.
  On the generated material enable "Straight Alpha Texture" (or the equivalent PMA setting for your shader).
- **Cocos Creator** — drop the three files in; use an `sp.Skeleton` component with `premultipliedAlpha` off.
  Check which Spine runtime your Cocos Creator version bundles (older 3.x bundles 3.8) and export that version.
- **PixiJS** — official `@esotericsoftware/spine-pixi-v8` (matches its own 4.x version); older community
  `pixi-spine` versions target 3.8/4.1.
- **Phaser** — official `@esotericsoftware/spine-phaser` matching the export version.
- **Godot** — official spine-godot build matching the export version.
- **Web preview** — Spine Web Player (`spine-player`) of the matching version.

When unsure about a specific engine version's Spine support, say so and point the user to that engine's
Spine runtime documentation rather than guessing.

## 5. Binding an effect into a character

`attach_effect` merges the baked effect into a copy of the character skeleton. What it does, so you can
explain it and predict the result:

- **Anchor bone** `fx_<effect>__anchor`, a child of the chosen bone. Its inherit mode comes from
  `inheritRotation` / `inheritScale` (written as `transform` in 3.8–4.1 and `inherit` in 4.2+). The effect's
  own transform (`emitter.transform`) is an offset in that bone's space — e.g. `x: 40` moves it along the bone.
- **Effect bones and slots** are prefixed `fx_<effect>__…`, so they never collide with the character's names
  and can be removed again (`detach_effect`). Slots go on top of the draw order, or above/below `slot`.
- **Keys** are written into the chosen animation only. In the character's other animations the effect's
  slots stay empty (invisible). One-shot effects are shifted to `startTime`; looping effects take the
  animation's duration (`matchLoop`) so both loops line up.
- **Atlas**: the effect page `fx_<effect>.png` is appended to a copy of the character atlas.
- **Output**: `<character>_fx.json` + `.atlas` (or `.atlas.txt`, matching the original) + the page, next to the
  character so its own pages still resolve. The original files are never modified.

### follow vs trail

- `follow` — the whole effect rides on the bone. Because it is baked under the bone, it follows every move of
  the character's animation in Spine and in any engine — this is the default and the right choice for
  auras, glows, held items, muzzle flashes, and impacts at a contact point.
- `trail` — for world-space emitters, SpineMagic samples the bone's animated path with the real runtime and
  emits from it, baking the particles under `fx_<effect>__root` (a child of the skeleton root). Particles are
  left behind as the bone moves: sword arcs, dash streaks, a comet from a hand. The trail is correct for the
  chosen animation; the effect is not re-simulated if the animation changes — re-attach after editing it.
  Local-space emitters in the same effect still follow the bone.

Runtime movement of the *whole* character (the game moving the skeleton) moves the baked particles too,
because they are part of the skeleton. Trails behind free runtime movement need the engine's own particles.

### Alpha (premultiplied)

The effect page must match the character atlas' alpha mode, or particle edges look wrong in the game.
`premultiplied: "auto"` reads the `pma:` flag of 4.x atlases. 3.8 atlases do not record it; auto assumes
premultiplied (Spine's export default) and warns — ask the user if their export had "Premultiply alpha"
unticked, then set `premultiplied: false`.

### Limits

- JSON skeletons only (3.8–4.3). Binary `.skel`: re-export as JSON.
- If the character has draw-order keys, inserted slots can shift them; a warning says so — tell the user to
  check those animations in Spine.
- Added bones count toward the character's budget everywhere the character is used. For a heavy effect that
  only appears in one animation, consider a lighter variant or keeping it as a separate skeleton that follows
  the bone in the engine (spine-unity `BoneFollower`, Cocos sockets).

