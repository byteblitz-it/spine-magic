---
type: llm
weight: 1
---

A successful run builds the effect with the SpineMagic tools and hands over usable files. Check:

1. It created the effect through the tools (create_effect / update_emitter), not by writing Spine JSON itself.
2. The emitter uses `textures/coin.png`, a normal (non-additive) blend, and keeps the sprite's colours (`colorize: false` or an equivalent untinted setup).
3. Particles travel downward (direction angle about -90 or 270) with a spread of roughly 40–70°, gravity pulling down, and an alpha curve that fades out toward the end of life.
4. Something models the flipping coins (a separate `sizeY` curve, or spin) — or the response explains it chose not to.
5. It called preview_effect at least once before exporting and commented on what it saw.
6. It exported for Spine 3.8 and told the user that 3.8 output is checked structurally, not in a real 3.8 runtime.
7. The final message lists where the files are and the bone count (lanes/bones).

Score 1 if all of 1, 2, 3, 6 and 7 hold and at least one of 4 or 5 holds; 0.5 if the effect was exported but one or two of these are missing; 0 if it hand-wrote Spine JSON or exported nothing.
