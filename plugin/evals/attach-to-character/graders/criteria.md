---
type: llm
weight: 1
---

Needs `characters/hero/` (copy `test/fixtures/hero-3.8`) in the server's home. A successful run:

1. Calls inspect_character on characters/hero/hero.json and picks the `hand` bone and the `swing` animation.
2. Builds a glow effect through the tools (create_effect, typically from a sparkle/glow preset) — not hand-written JSON.
3. Calls attach_effect in follow mode with `inheritRotation: false` (stays upright) and a draw order above the
   arm (`slot: "arm"`, `place: "above"`, or on top of everything).
4. Reports that validation passed in the 3.8 runtime, the output file (hero_fx.json next to the original, original untouched) and the bones added.
5. Mentions the premultiplied-alpha assumption for 3.8 (or asks the user to confirm their export setting).

Score 1 if 1–4 hold; 0.5 if it attached the effect but missed the upright or draw-order requirement or did not report
validation; 0 if it hand-wrote Spine JSON or did not attach the effect to the character.
