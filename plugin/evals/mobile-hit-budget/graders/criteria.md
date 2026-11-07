---
type: llm
weight: 1
---

A successful run makes a light, punchy one-shot impact. Check:

1. The effect does not loop (`loop: false`) — a hit is a one-shot.
2. It reads as punchy: a burst (not continuous emission), fast initial speed, a short lifetime (well under 1 s for the main sparks), and some way of stopping or slowing (drag) or of streaking (spark/dash texture, alignToVelocity or velocityStretch).
3. It respects the mobile budget: the reported bone/lane count is at most about 60, and the response mentions the number. Extra credit if it explains why it matters that many copies are spawned.
4. It exported for Spine 4.1 and reports that validation passed (or reports the failure honestly).
5. It did not hand-write Spine JSON.

Score 1 if all five hold; 0.5 if it exported but misses one of 1–3; 0 otherwise.
