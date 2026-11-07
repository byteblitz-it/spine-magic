import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const home = mkdtempSync(join(tmpdir(), "spinemagic-"));
let client: Client;

beforeAll(async () => {
  // the shipped server under plain Node (what .mcp.json runs); `npm test` builds first.
  // SPINEMAGIC_SERVER points the suite at another build, e.g. an isolated copy of the plugin bundle.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(process.env.SPINEMAGIC_SERVER ?? "dist/mcp/server.js")],
    env: { ...process.env, SPINEMAGIC_HOME: home } as Record<string, string>,
  });
  client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client?.close();
  rmSync(home, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: any[]; isError?: boolean };
  return r;
};
const parse = (r: { content: any[] }) => JSON.parse(r.content.find((c) => c.type === "text").text);

describe("MCP server", () => {
  it("lists the tools an agent needs", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_emitter", "attach_effect", "create_effect", "detach_effect", "export_spine", "get_effect", "get_effect_reference",
      "inspect_character", "list_effects", "list_presets", "list_textures", "preview_effect", "remove_emitter", "update_effect",
      "update_emitter", "validate_export",
    ]);
  });

  it("inspect → attach (follow + trail) → detach a 3.8 character over MCP", async () => {
    cpSync(resolve("test/fixtures/hero-3.8"), join(home, "characters", "hero"), { recursive: true });
    const info = parse(await call("inspect_character", { character: "characters/hero/hero.json" }));
    expect(info.version).toBe("3.8");
    expect(info.bones.map((b: any) => b.name)).toContain("hand");
    expect(info.animations.map((a: any) => a.name)).toEqual(["swing", "walk", "idle"]);

    parse(await call("create_effect", { preset: "magic-sparkles", name: "aura" }));
    const a = await call("attach_effect", { id: "aura", character: "characters/hero/hero.json", bone: "hand", animation: "swing", slot: "arm" });
    expect(a.isError).toBeFalsy();
    const ar = parse(a);
    expect(ar.validation).toMatchObject({ ok: true, method: "runtime" });
    expect(ar.followError).toBe(0);
    expect(parse(await call("get_effect", { id: "aura" })).attach).toMatchObject({ bone: "hand", animation: "swing", character: "characters/hero/hero.json" });

    parse(await call("create_effect", { preset: "comet", name: "swoosh" }));
    const t = parse(await call("attach_effect", { id: "swoosh", character: "characters/hero/hero_fx.json", bone: "hand", animation: "swing", mode: "trail" }));
    expect(t.validation.ok).toBe(true);
    expect(parse(await call("inspect_character", { character: "characters/hero/hero_fx.json" })).effects.sort()).toEqual(["aura", "swoosh"]);

    const d = parse(await call("detach_effect", { character: "characters/hero/hero_fx.json", effect: "swoosh" }));
    expect(d.validation.ok).toBe(true);
    expect(parse(await call("inspect_character", { character: "characters/hero/hero_fx.json" })).effects).toEqual(["aura"]);
  }, 60_000);

  it("create → update → preview → export (all versions) works end to end", async () => {
    const created = parse(await call("create_effect", { preset: "fireworks", name: "Blue Burst" }));
    expect(created.id).toBe("blue_burst");

    const updated = await call("update_emitter", { id: created.id, emitter: 0, patch: { overLifetime: { color: [[0, "#e0f0ff"], [1, "#2040ff"]] } } });
    expect(updated.isError).toBeFalsy();

    const added = parse(await call("add_emitter", { id: created.id, fromPreset: "shockwave", patch: { name: "ring" } }));
    expect(added.emitters).toEqual(["0:burst", "1:ring"]);

    const preview = await call("preview_effect", { id: created.id, frames: 4, cellSize: 128 });
    const img = preview.content.find((c) => c.type === "image");
    expect(img.mimeType).toBe("image/png");
    expect(Buffer.from(img.data, "base64").subarray(1, 4).toString()).toBe("PNG");

    const exp = await call("export_spine", { id: created.id, version: "all" });
    expect(exp.isError).toBeFalsy();
    const results = parse(exp);
    expect(results.map((r: any) => r.version)).toEqual(["3.8", "4.0", "4.1", "4.2", "4.3"]);
    for (const r of results) {
      expect(r.validation.ok).toBe(true);
      expect(existsSync(r.files.json) && existsSync(r.files.atlas) && existsSync(r.files.png)).toBe(true);
    }
  }, 60_000);

  it("returns readable validation errors", async () => {
    const r = await call("create_effect", { effect: { fps: 500 } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("fps");
  });
});
