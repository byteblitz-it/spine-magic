# Worked sessions

Four complete sessions showing how the loop should feel. Tool arguments are exact; outputs are abridged.

## 1. Coin fountain from a reference image

**User:** "Make this in Spine 3.8" + screenshot: gold coins falling from a point, fanning out and fading,
some edge-on.

Reading the image: origin is a point; travel is downward → angle -90; fan ≈ 40°, widening as they fall
(gravity + spread); fades out in the lower half; solid coins, so normal blend; coin sprite needed;
some coins appear thin → flipping (`sizeY`).

1. Check for a sprite. `textures/coin.png` exists in the workspace (otherwise ask the user for a PNG, or use
   `hard-circle` tinted gold as a placeholder and say so).
2. `create_effect`:
```json
{ "name": "coin_fountain", "effect": { "duration": 2, "loop": true, "emitters": [{
  "name": "coins", "texture": "textures/coin.png", "blend": "normal", "colorize": false,
  "emission": { "type": "continuous", "rate": 14, "limit": 40 },
  "direction": { "angle": -90, "spread": 40 },
  "initial": { "lifetime": [1.4, 1.8], "speed": [60, 120], "size": [30, 40], "rotation": [-15, 15] },
  "overLifetime": { "alpha": [[0,0],[0.08,1],[0.55,0.9],[1,0]], "size": [[0,0.8],[0.15,1],[1,1]] },
  "affectors": [{ "type": "gravity", "x": 0, "y": -220 }, { "type": "drag", "amount": 0.4 }] }] } }
```
   → `cost: { lanes: 28, keys: 912, dropped: 0 }`
3. `preview_effect` `{ "id": "coin_fountain" }` → a narrow column; the reference fans wider and coins tumble.
4. `update_emitter`:
```json
{ "id": "coin_fountain", "emitter": "coins", "patch": {
  "emission": { "rate": 18, "limit": 48 }, "direction": { "spread": 60 },
  "initial": { "angularVelocity": [-60, 60], "speed": [40, 110] },
  "overLifetime": { "sizeY": [[0,0.8],[0.15,1],[0.35,0.55],[0.55,1],[0.75,0.55],[1,1]] } } }
```
5. Preview again → matches: wider fan, flipping coins, fading as they fall. 36 bones — fine for mobile.
6. `export_spine` `{ "id": "coin_fountain", "version": "3.8" }` → structural check OK.
7. Hand-over: files in `out/coin_fountain/3.8/`, 36 bones / 1,396 keys, loops every 2 s, note that 3.8 was
   validated structurally only.

## 2. Comet trail on a loop path

**User:** "A glowing blue comet circling the logo, leaving a trail. Spine 4.2, web game."

1. `create_effect` `{ "preset": "comet", "name": "logo_comet" }` — the preset already has a motion path in
   world space with `rateOverDistance`, so the trail density follows the comet's speed.
2. Preview → the loop is wider than the logo. Shrink the path: the user says the logo is ~200 px wide.
```json
{ "id": "logo_comet", "emitter": "trail", "patch": { "motion": { "points": [[-120,0],[0,60],[120,0],[0,-60]] } } }
```
   (points is an array → send all of them).
3. Preview → good. `cost.lanes` dropped from 49 to 40 — a shorter path means less distance travelled, so
   `rateOverDistance` emits fewer particles. Acceptable for web.
4. `export_spine` `{ "id": "logo_comet", "version": "4.2" }` → runtime validation OK. Hand over.

## 3. Layered hit impact (one-shot)

**User:** "Sword hit spark for a mobile action game, Spine 4.1, keep it light."

Plan four layers but keep the total under ~60 bones: flash (1), sparks (16), ring (1), smoke (8).

1. `create_effect`:
```json
{ "name": "sword_hit", "effect": { "loop": false, "duration": 0.1, "emitters": [
  { "name": "flash", "texture": "soft-circle", "blend": "additive",
    "emission": { "type": "burst", "bursts": [{ "time": 0, "count": 1 }], "limit": 1 },
    "initial": { "lifetime": 0.12, "speed": 0, "size": 140 },
    "overLifetime": { "alpha": [[0,1],[1,0]], "size": [[0,0.6],[1,1.2]] } },
  { "name": "sparks", "texture": "spark", "blend": "additive",
    "emission": { "type": "burst", "bursts": [{ "time": 0, "count": 16 }], "limit": 16 },
    "direction": { "spread": 360 },
    "initial": { "lifetime": [0.2, 0.35], "speed": [350, 600], "size": [20, 34] },
    "overLifetime": { "alignToVelocity": true, "alpha": [[0,1],[1,0]], "color": [[0,"#ffffff"],[1,"#ffb030"]] },
    "affectors": [{ "type": "drag", "mode": "quadratic", "amount": 2 }, { "type": "velocityStretch", "amount": 0.6 }] }
] } }
```
2. `add_emitter` `{ "id": "sword_hit", "fromPreset": "shockwave", "patch": { "name": "ring", "initial": { "lifetime": 0.3 } } }`
3. `add_emitter` `{ "id": "sword_hit", "fromPreset": "smoke", "patch": { "name": "smoke",
   "emission": { "type": "burst", "bursts": [{ "time": 0.03, "count": 8 }], "limit": 8 },
   "initial": { "lifetime": [0.5, 0.8], "speed": [30, 70] }, "direction": { "spread": 360 } } }`
4. Preview → check the flash is only on the first frames and smoke lingers after the sparks.
5. Total bones 26 — light. `export_spine` `{ "id": "sword_hit", "version": "4.1" }`. Hand over; mention it
   plays once (not looping) and lasts ~0.9 s (the export reports `durationSeconds`).

## 4. Sword trail baked into a 3.8 character

**User:** "Our hero is Spine 3.8 (characters/hero/hero.json). Add a glowing trail behind the hand during the
swing animation, drawn behind the arm."

1. `inspect_character` `{ "character": "characters/hero/hero.json" }` → version 3.8, bones
   `root, body, arm, hand`, animations `swing (1 s), walk (2 s), idle (2 s)`, slots `body, arm`.
2. A trail needs a **world-space** emitter (particles stay where they were emitted) with a short life:
```json
{ "name": "sword_trail", "effect": { "loop": true, "emitters": [{
  "name": "trail", "simulationSpace": "world", "texture": "soft-circle", "blend": "additive",
  "emission": { "type": "continuous", "rate": 20, "rateOverDistance": 8, "limit": 60 },
  "direction": { "spread": 360 }, "initial": { "lifetime": [0.25, 0.4], "speed": [5, 20], "size": [16, 26] },
  "overLifetime": { "alpha": [[0,1],[1,0]], "size": [[0,1],[1,0.3]], "color": [[0,"#ffffff"],[1,"#60c0ff"]] } }] } }
```
   (`create_effect`). Preview it alone first only to check colour and fade — the shape of the trail comes
   from the animation, so it looks like a blob until attached.
3. `attach_effect`:
```json
{ "id": "sword_trail", "character": "characters/hero/hero.json", "bone": "hand", "animation": "swing",
  "mode": "trail", "slot": "arm", "place": "below" }
```
   → `version 3.8`, validation ok in the 3.8 runtime, bones 4 → 28, one warning: 3.8 atlases don't record
   premultiplied alpha, assumed premultiplied.
4. Hand-over: `characters/hero/hero_fx.json` + `hero_fx.atlas` + `fx_sword_trail.png`; open the `_fx.json` in
   Spine 3.8 (Import Data) and play `swing` — the trail draws the hand's arc behind the arm; the effect loops
   with the 1 s swing; 24 bones added. Ask whether their 3.8 export used premultiplied alpha (the default);
   if not, re-attach with `"premultiplied": false`. The effect is baked for `swing` only — re-attach if that
   animation changes.
