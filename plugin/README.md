# SpineMagic plugin

Particle effects for **Spine 3.8 – 4.3**, authored by an AI agent. Spine has no particle system, so
SpineMagic simulates the effect, bakes every particle into bones and slots with keyframes, and validates
the result by loading it in the official Spine runtime. You describe the effect (or show a reference
image), the agent builds it, looks at rendered previews, iterates, and exports `.json` + `.atlas` + `.png`
ready for the Spine editor or any Spine runtime (Unity, Cocos Creator, Godot, PixiJS, Phaser, …).

The plugin bundles:

- **`spinemagic` MCP server** — 16 tools: create/update effects and emitters, preview as images, export to
  Spine 3.8/4.0/4.1/4.2/4.3 with automatic validation, and bake effects into a character skeleton so they
  follow a bone (or trail behind it) inside one of its animations.
- **`spine-vfx` skill** — how to use them well: the preview-critique loop, translating briefs and reference
  images into parameters, layering multi-part effects, mobile bone budgets, choosing the Spine version,
  binding effects to character bones, and loading the export in common engines.

## Install

Requires Node.js 20+ and Claude Code. The MCP server ships prebuilt inside the plugin
(`server/spinemagic-mcp.mjs`, with the Spine runtimes it validates against), so no clone or build is needed:

```bash
claude plugin marketplace add byteblitz-it/spine-magic
claude plugin install spinemagic@spinemagic
```

(or in Claude Code: `/plugin install spinemagic --marketplace byteblitz-it/spine-magic`). From a local clone,
use `claude plugin marketplace add ./` instead.

Restart Claude Code, then ask for an effect, e.g. *"make a gold coin burst for Spine 4.2, mobile, one-shot"*.
Effects are saved in `projects/`, exports in `out/`, custom sprites go in `textures/` (all under the
working directory, or `SPINEMAGIC_HOME`).

Optional: `npm run web` opens a visual editor at http://localhost:5174 that shows the agent's changes live.

## Evals

`evals/` holds three cases (reference-image match, mobile budget, missing tools). They need the real MCP
server and a `textures/coin.png` in the server's home:

```bash
claude plugin eval ./plugin --mocks off --allow-tools "mcp__*" --runs 1
```

## License

MIT — © 2026 ByteBlitz IT Solutions (see the repository's `LICENSE` and `THIRD-PARTY-NOTICES.md`).

Exports are standard Spine data. Using Spine data in a product requires a Spine license from
Esoteric Software; the validator uses the official Spine runtimes under the Spine Runtimes License.
