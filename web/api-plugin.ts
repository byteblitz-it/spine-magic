// Dev-server API: the editor and the MCP server share SPINEMAGIC_HOME/projects, so agent edits show up live.
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { join, resolve, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { EffectStore, formatError } from "../src/mcp/store";
import { PRESETS } from "../src/core/presets";
import { parseEffect } from "../src/core/schema";
import { deepMerge } from "../src/core/merge";

const MAX_BODY = 8 * 1024 * 1024;

export function spineMagicApi(): Plugin {
  const home = resolve(process.env.SPINEMAGIC_HOME ?? fileURLToPath(new URL("..", import.meta.url)));
  const store = new EffectStore(join(home, "projects"));
  const textureDir = join(home, "textures");
  const characterDir = join(home, "characters");
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  /** characters/<name>/<file> with no path tricks */
  const charPath = (name: string, file?: string) => {
    if (!/^[\w.-]+$/.test(name) || (file !== undefined && !/^[\w.-]+$/.test(file))) throw new Error("bad character path");
    const p = normalize(file ? join(characterDir, name, file) : join(characterDir, name));
    if (!p.startsWith(characterDir + sep)) throw new Error("bad character path");
    return p;
  };
  const clients = new Set<ServerResponse>();
  const lastWrite = new Map<string, string>();

  return {
    name: "spinemagic-api",
    configureServer(server) {
      // Push file changes (e.g. an agent calling update_effect) to open editors.
      const timers = new Map<string, NodeJS.Timeout>();
      watch(store.dir, (_ev, file) => {
        if (!file || !file.endsWith(".json")) return;
        const id = file.slice(0, -5);
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => {
          let content = "";
          try { content = readFileSync(join(store.dir, file), "utf8"); } catch { /* deleted */ }
          if (content && lastWrite.get(id) === content) return; // our own save
          const msg = `data: ${JSON.stringify({ type: "changed", id })}\n\n`;
          for (const c of clients) c.write(msg);
        }, 80));
      });

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (!url.pathname.startsWith("/api/")) return next();
        try {
          const parts = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent);
          const method = req.method ?? "GET";

          if (parts[0] === "events" && method === "GET") {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
            res.write(": connected\n\n");
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
          }

          if (parts[0] === "info") return send(res, 200, { home, projects: store.dir });

          if (parts[0] === "effects") {
            const id = parts[1];
            if (!id && method === "GET") return send(res, 200, store.list());
            if (!id && method === "POST") {
              const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
              let base: unknown = {};
              if (body.preset) {
                if (!PRESETS[body.preset]) return send(res, 400, { error: `unknown preset ${body.preset}` });
                base = structuredClone(PRESETS[body.preset].effect);
              }
              const doc = deepMerge(base, body.effect ?? {}) as Record<string, unknown>;
              const parsed = parseEffect(body.name ? { ...doc, name: body.name } : doc);
              const newId = store.uniqueId(parsed.name);
              const saved = store.save(newId, parsed);
              lastWrite.set(newId, JSON.stringify(saved, null, 2));
              return send(res, 201, { id: newId, effect: saved });
            }
            if (id && method === "GET") return send(res, 200, store.get(id));
            if (id && method === "PUT") {
              const effect = parseEffect(JSON.parse((await readBody(req)).toString("utf8")));
              lastWrite.set(id, JSON.stringify(effect, null, 2));
              return send(res, 200, store.save(id, effect));
            }
          }

          if (parts[0] === "characters") {
            mkdirSync(characterDir, { recursive: true });
            const [, name, file] = parts;
            if (!name && method === "GET") {
              const list = readdirSync(characterDir).filter((d) => statSync(join(characterDir, d)).isDirectory()).map((d) => ({
                name: d,
                skeletons: readdirSync(join(characterDir, d)).filter((f) => /\.(json|skel|skel\.bytes)$/i.test(f)),
              })).filter((c) => c.skeletons.length);
              return send(res, 200, list);
            }
            if (name === "_samples" && method === "POST") {
              for (const v of ["3.8", "4.2"]) cpSync(join(repoRoot, "test", "fixtures", `hero-${v}`), charPath(`hero-${v}`), { recursive: true });
              return send(res, 200, { ok: true });
            }
            if (name && file && method === "GET") {
              const p = charPath(name, file);
              if (!existsSync(p)) return send(res, 404, { error: "not found" });
              res.writeHead(200, { "Content-Type": p.endsWith(".png") ? "image/png" : p.endsWith(".json") ? "application/json" : "text/plain" });
              return res.end(readFileSync(p));
            }
            if (name && file && method === "PUT") {
              if (!/\.(json|skel|bytes|atlas|txt|png)$/i.test(file)) return send(res, 400, { error: "upload the skeleton .json or .skel, the .atlas (or .atlas.txt) and its .png pages" });
              mkdirSync(charPath(name), { recursive: true });
              writeFileSync(charPath(name, file), await readBody(req));
              return send(res, 200, { ok: true });
            }
          }

          if (parts[0] === "attach" && method === "POST") {
            // same code path as the MCP attach_effect tool
            const body = JSON.parse((await readBody(req)).toString("utf8"));
            const { id, character, ...attach } = body;
            const m = /^characters\/([\w.-]+)\/([\w.-]+\.(?:json|skel|skel\.bytes))$/.exec(character ?? "");
            if (!m) return send(res, 400, { error: "character must be characters/<name>/<file>.json or .skel" });
            const { attachToCharacter } = await import("../src/node/character");
            const effect = store.get(id);
            const r = await attachToCharacter({ effect, jsonPath: charPath(m[1], m[2]), attach, textureDir: home });
            return send(res, 200, r);
          }

          if (parts[0] === "textures") {
            mkdirSync(textureDir, { recursive: true });
            const name = parts[1];
            if (!name || !/^[\w-]+\.png$/.test(name)) return send(res, 400, { error: "texture name must be <name>.png" });
            const path = normalize(join(textureDir, name));
            if (!path.startsWith(textureDir + sep)) return send(res, 400, { error: "bad path" });
            if (method === "GET") {
              if (!existsSync(path)) return send(res, 404, { error: "not found" });
              res.writeHead(200, { "Content-Type": "image/png" });
              return res.end(readFileSync(path));
            }
            if (method === "PUT") {
              const png = await readBody(req);
              if (png.readUInt32BE(0) !== 0x89504e47) return send(res, 400, { error: "not a PNG" });
              writeFileSync(path, png);
              return send(res, 200, { ref: `textures/${name}` });
            }
          }
          send(res, 404, { error: "not found" });
        } catch (e) {
          send(res, 400, { error: formatError(e) });
        }
      });
    },
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { fail(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}
