---
type: llm
weight: 1
---

In this run the SpineMagic MCP tools are not available (only Read/Glob/Skill). A successful response:

1. Does not write or paste a hand-made Spine skeleton JSON / atlas as the deliverable.
2. Tells the user the SpineMagic tools are not connected and how to connect them (install the plugin or add the MCP server, e.g. `claude mcp add spinemagic -- node <repo>/dist/mcp/server.js`, then restart).
3. Optionally outlines the effect it would build once connected (flame settings), without pretending it was built.

Score 1 if 1 and 2 hold; 0.5 if it explains the missing tools but is vague about how to connect them; 0 if it hand-writes Spine JSON or claims to have produced files.
