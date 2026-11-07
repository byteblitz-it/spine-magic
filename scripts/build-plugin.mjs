// Bundles the MCP server into plugin/server/ so the plugin is self-contained: Claude Code copies only the
// plugin folder into its cache, so it cannot reach the repository's dist/ or node_modules/.
// Usage: npm run build:plugin
import { build } from "esbuild";
import { copyFileSync, cpSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "plugin", "server");
const req = createRequire(join(root, "package.json"));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "vendor"), { recursive: true });

await build({
  entryPoints: [join(root, "src", "mcp", "server.ts")],
  outfile: join(out, "spinemagic-mcp.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "inline",
  // CommonJS dependencies inside an ESM bundle need require()
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});

// runtimes loaded from disk at run time (see src/node/validate.ts)
// spine-webgl.js is for the browser editor only
cpSync(join(root, "vendor", "spine-3.8"), join(out, "vendor", "spine-3.8"), { recursive: true, filter: (src) => !src.endsWith("spine-webgl.js") });
copyFileSync(req.resolve("spine-core-40/dist/iife/spine-core.js"), join(out, "vendor", "spine-core-4.0.js"));
copyFileSync(join(root, "THIRD-PARTY-NOTICES.md"), join(out, "THIRD-PARTY-NOTICES.md"));
copyFileSync(join(root, "LICENSE"), join(out, "LICENSE"));

const kb = (p) => Math.round(statSync(p).size / 1024);
console.log(`plugin/server/spinemagic-mcp.mjs ${kb(join(out, "spinemagic-mcp.mjs"))} KB + vendor runtimes`);
