# Setup

## Connecting the MCP server

The tools come from the SpineMagic MCP server (bundled as `plugin/server/spinemagic-mcp.mjs` in the
SpineMagic repository, https://github.com/byteblitz-it/spine-magic; Node 20+).

- **As a Claude Code plugin** (recommended): installing the `spinemagic` plugin registers the server (bundled
  inside the plugin) and this skill together — Node.js 20+ is the only requirement:
  ```
  claude plugin marketplace add byteblitz-it/spine-magic
  claude plugin install spinemagic@spinemagic
  ```
  Restart Claude Code afterwards so the server starts.
- **Server only**, any MCP client (Claude Desktop, Cursor, VS Code, …): run the bundled
  `plugin/server/spinemagic-mcp.mjs` (or `dist/mcp/server.js` after `npm install && npm run build` in a clone)
  with `node` over stdio. In Claude Code: `claude mcp add spinemagic -- node <repo>/plugin/server/spinemagic-mcp.mjs`.

`SPINEMAGIC_HOME` (default: the server's working directory) holds `projects/` (effect documents),
`textures/` (custom sprites), `out/` (exports) and, by convention, `characters/<name>/` (character
skeleton `.json` + `.atlas` + `.png` pages for `attach_effect`). Relative paths in tool calls resolve against it.

If the tools are missing in a session, tell the user which of these steps applies; don't try to emulate the
tools by writing files.

## Custom textures

An emitter's `texture` is a builtin name (`list_textures`) or a path to a PNG relative to `SPINEMAGIC_HOME`,
e.g. `"textures/coin.png"`. The server reads 8-bit, non-interlaced PNGs. You cannot upload images through
the tools: ask the user to save the file into `textures/`, or to upload it in the web editor (which converts
JPG/WebP and saves it there). Keep sprites small (64–256 px); they are packed into one atlas page.

## Web editor (optional)

`npm run web` serves an editor at http://localhost:5174 that reads and writes the same `projects/` folder.
When the user has it open, every change you make through the tools appears there live — a good way for them
to watch and fine-tune by hand. Its Character panel previews an effect on a 3.8 or 4.2 character with that
version's own runtime, using the same merge as `attach_effect` (the binding you set is stored on the effect). Their edits are saved to the same file, so call `get_effect` before patching
if they may have changed something.
