#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  PRESETS, SPINE_VERSIONS, bakeSimulation, encodePng, exportSpine, listBuiltinTextures, parseEffect,
  renderPreview, simulate, validateExport, nodeTextureResolver, Emitter, type Effect, type SpineVersion,
  inspectCharacterFile, attachToCharacter, detachFromCharacter,
} from "../node/index.js";
import { EFFECT_REFERENCE } from "../core/reference.js";
import { EffectStore, deepMerge, formatError } from "./store.js";

const HOME = resolve(process.env.SPINEMAGIC_HOME ?? process.cwd());
const store = new EffectStore(join(HOME, "projects"));
const OUT = join(HOME, "out");
const textures = nodeTextureResolver(HOME);

const server = new McpServer({ name: "spinemagic", version: "0.1.0" }, {
  instructions:
    "SpineMagic builds particle effects and bakes them to Spine 3.8–4.3 skeletons. Call get_effect_reference once, " +
    "start from a preset with create_effect, LOOK at preview_effect images while iterating with update_effect/update_emitter, " +
    "then export_spine. To put an effect on a character, inspect_character then attach_effect (merges it under a bone). " +
    "Never hand-write Spine JSON.",
});

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const text = (t: string) => ({ content: [{ type: "text", text: t }] as Content[] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const fail = (e: unknown) => ({ content: [{ type: "text", text: formatError(e) }] as Content[], isError: true });

/** Wraps a handler so validation and runtime errors come back as readable tool errors. */
function safe<A>(fn: (args: A) => Promise<{ content: Content[]; isError?: boolean }> | { content: Content[]; isError?: boolean }) {
  return async (args: A) => {
    try { return await fn(args); } catch (e) { return fail(e); }
  };
}

const EmitterRef = z.union([z.number().int().min(0), z.string()]).describe("emitter index or name");
const Patch = z.record(z.string(), z.any());

function emitterIndex(effect: Effect, ref: number | string): number {
  const i = typeof ref === "number" ? ref : effect.emitters.findIndex((e) => e.name === ref);
  if (i < 0 || i >= effect.emitters.length) throw new Error(`emitter ${JSON.stringify(ref)} not found; emitters: ${effect.emitters.map((e, k) => `${k}:${e.name}`).join(", ")}`);
  return i;
}

function summary(id: string, effect: Effect) {
  const sim = simulate(effect);
  const { stats } = bakeSimulation(effect, sim, { version: "4.2", resolveTexture: textures });
  return { id, name: effect.name, duration: effect.duration, loop: effect.loop, fps: effect.fps, emitters: effect.emitters.map((e, i) => `${i}:${e.name}`), cost: { lanes: stats.lanes, keys: stats.keys, dropped: stats.droppedParticles } };
}

server.registerResource("effect-reference", "spinemagic://reference", { title: "Effect reference", mimeType: "text/markdown" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: EFFECT_REFERENCE }] }));

server.registerTool("get_effect_reference", {
  title: "Effect parameter reference",
  description: "Every effect/emitter field with defaults, affectors, recipes and the recommended workflow. Read this first.",
  annotations: { readOnlyHint: true },
}, async () => text(EFFECT_REFERENCE));

server.registerTool("list_presets", {
  title: "List presets",
  description: "Starting points for common effects. Pick the closest to the brief and adjust.",
  annotations: { readOnlyHint: true },
}, async () => json(Object.entries(PRESETS).map(([id, p]) => ({ id, description: p.description }))));

server.registerTool("list_textures", {
  title: "List textures",
  description: "Builtin particle textures. An emitter's texture can also be a path to an 8-bit PNG (relative to the SpineMagic home).",
  annotations: { readOnlyHint: true },
}, async () => json({ builtin: listBuiltinTextures(), home: HOME }));

server.registerTool("list_effects", {
  title: "List effects",
  description: "Effects saved in this workspace.",
  annotations: { readOnlyHint: true },
}, async () => json(store.list()));

server.registerTool("create_effect", {
  title: "Create effect",
  description: "Create and save a new effect from a preset and/or a (partial) effect document. Returns its id.",
  inputSchema: {
    name: z.string().optional().describe("effect name; also used for the id and export file names"),
    preset: z.string().optional().describe("preset id from list_presets"),
    effect: Patch.optional().describe("partial effect document, deep-merged over the preset (arrays replace)"),
  },
}, safe(async ({ name, preset, effect }) => {
  let base: unknown = {};
  if (preset) {
    const p = PRESETS[preset];
    if (!p) throw new Error(`unknown preset "${preset}"; available: ${Object.keys(PRESETS).join(", ")}`);
    base = structuredClone(p.effect);
  }
  let doc = deepMerge(base, effect ?? {}) as Record<string, unknown>;
  if (name) doc = { ...doc, name };
  const parsed = parseEffect(doc);
  const id = store.uniqueId(parsed.name);
  return json(summary(id, store.save(id, parsed)));
}));

server.registerTool("get_effect", {
  title: "Get effect",
  description: "Full effect document with all defaults filled in.",
  inputSchema: { id: z.string() },
  annotations: { readOnlyHint: true },
}, safe(async ({ id }) => json(store.get(id))));

server.registerTool("update_effect", {
  title: "Update effect",
  description: "Deep-merge a patch into the effect (objects merge, arrays replace, null resets a field to its default). Use update_emitter for one emitter.",
  inputSchema: { id: z.string(), patch: Patch },
}, safe(async ({ id, patch }) => {
  const next = deepMerge(store.get(id), patch);
  return json(summary(id, store.save(id, next)));
}));

server.registerTool("update_emitter", {
  title: "Update emitter",
  description: "Deep-merge a patch into one emitter, e.g. {initial:{speed:[200,300]}, affectors:[{type:'gravity'}]}.",
  inputSchema: { id: z.string(), emitter: EmitterRef, patch: Patch },
}, safe(async ({ id, emitter, patch }) => {
  const effect = store.get(id);
  const i = emitterIndex(effect, emitter);
  effect.emitters[i] = deepMerge(effect.emitters[i], patch);
  return json(summary(id, store.save(id, effect)));
}));

server.registerTool("add_emitter", {
  title: "Add emitter",
  description: "Append an emitter (drawn on top). Optionally copy the first emitter of a preset, then apply a patch.",
  inputSchema: { id: z.string(), fromPreset: z.string().optional(), patch: Patch.optional() },
}, safe(async ({ id, fromPreset, patch }) => {
  const effect = store.get(id);
  let base: unknown = {};
  if (fromPreset) {
    const p = PRESETS[fromPreset];
    if (!p) throw new Error(`unknown preset "${fromPreset}"`);
    base = structuredClone(p.effect.emitters?.[0] ?? {});
  }
  effect.emitters.push(Emitter.parse(deepMerge(base, patch ?? {})));
  return json(summary(id, store.save(id, effect)));
}));

server.registerTool("remove_emitter", {
  title: "Remove emitter",
  description: "Remove an emitter (an effect keeps at least one).",
  inputSchema: { id: z.string(), emitter: EmitterRef },
}, safe(async ({ id, emitter }) => {
  const effect = store.get(id);
  if (effect.emitters.length === 1) throw new Error("an effect needs at least one emitter; disable it instead ({enabled:false})");
  effect.emitters.splice(emitterIndex(effect, emitter), 1);
  return json(summary(id, store.save(id, effect)));
}));

server.registerTool("preview_effect", {
  title: "Preview effect",
  description: "Render frames sampled across the animation as a PNG contact sheet (left→right, top→bottom; green cross = origin). Inspect it to judge the look before exporting.",
  inputSchema: {
    id: z.string(),
    frames: z.number().int().min(1).max(24).optional().describe("frames to sample (default 8)"),
    cellSize: z.number().int().min(64).max(512).optional().describe("pixels per frame cell (default 256)"),
    savePath: z.string().optional().describe("also write the PNG to this path"),
  },
  annotations: { readOnlyHint: true },
}, safe(async ({ id, frames, cellSize, savePath }) => {
  const effect = store.get(id);
  const sim = simulate(effect);
  const prev = renderPreview(effect, sim, { frames, cellSize, resolveTexture: textures });
  const png = encodePng(prev.image);
  if (savePath) {
    const p = resolve(HOME, savePath);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, png);
  }
  const info = { ...summary(id, effect), frameTimes: prev.times, viewBounds: prev.bounds, saved: savePath ? resolve(HOME, savePath) : undefined };
  return { content: [{ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" }, { type: "text", text: JSON.stringify(info, null, 2) }] as Content[] };
}));

server.registerTool("export_spine", {
  title: "Export to Spine",
  description: "Bake to Spine JSON + .atlas + .png and validate (real spine-core runtime for 4.x, structural check for 3.8). Import the JSON in Spine via Import Data, or load it in any Spine runtime.",
  inputSchema: {
    id: z.string(),
    version: z.enum([...SPINE_VERSIONS, "all"]).default("4.2"),
    outDir: z.string().optional().describe("default: out/<id>/<version>"),
    tolerance: z.number().min(0).max(10).optional().describe("key reduction tolerance (default 0.5; 0 = every frame)"),
    validate: z.boolean().default(true),
  },
}, safe(async ({ id, version, outDir, tolerance, validate }) => {
  const effect = store.get(id);
  const versions: SpineVersion[] = version === "all" ? [...SPINE_VERSIONS] : [version];
  const results = [];
  for (const v of versions) {
    const dir = outDir ? resolve(HOME, versions.length > 1 ? join(outDir, v) : outDir) : join(OUT, id, v);
    const r = exportSpine(effect, dir, v, { tolerance, textureDir: HOME });
    const validation = validate ? await validateExport(r.files.json, r.files.atlas, v) : undefined;
    results.push({ version: v, files: r.files, stats: r.stats, validation });
  }
  const bad = results.some((r) => r.validation && !r.validation.ok);
  return { ...json(results), isError: bad || undefined };
}));

server.registerTool("validate_export", {
  title: "Validate Spine export",
  description: "Load an existing skeleton JSON + atlas in the Spine runtime for its version and play the whole animation.",
  inputSchema: { jsonPath: z.string(), atlasPath: z.string(), version: z.enum(SPINE_VERSIONS) },
  annotations: { readOnlyHint: true },
}, safe(async ({ jsonPath, atlasPath, version }) => json(await validateExport(resolve(HOME, jsonPath), resolve(HOME, atlasPath), version))));

server.registerTool("inspect_character", {
  title: "Inspect character skeleton",
  description: "Read a character's Spine skeleton JSON (3.8–4.3): version, bone hierarchy, slots in draw order, skins, animations with durations, and effects already merged. Use before attach_effect to pick the bone, animation and draw-order slot.",
  inputSchema: { character: z.string().describe("path to the character's skeleton .json (relative to the SpineMagic home)") },
  annotations: { readOnlyHint: true },
}, safe(async ({ character }) => json(inspectCharacterFile(resolve(HOME, character)))));

server.registerTool("attach_effect", {
  title: "Attach effect to a character bone",
  description:
    "Bake an effect INTO a character skeleton so it sticks to a bone and plays inside one of the character's animations — " +
    "the result opens in the Spine editor with the effect riding on the character. Writes <character>_fx.json/.atlas + fx_<effect>.png " +
    "next to the character (the original files are untouched), validates in the real Spine runtime for the character's version, and checks the " +
    "effect anchor follows the bone. mode follow: everything moves rigidly with the bone. mode trail: world-space emitters emit from the bone's " +
    "animated path and leave trails (sampled from the animation). Re-attaching the same effect replaces the previous copy; attach to the _fx file " +
    "to stack several effects.",
  inputSchema: {
    id: z.string().describe("effect id"),
    character: z.string().describe("character skeleton .json path (relative to the SpineMagic home)"),
    atlas: z.string().optional().describe("character .atlas path; default: same name as the json"),
    bone: z.string().describe("character bone the effect sticks to (inspect_character lists them)"),
    animation: z.string().describe("character animation that receives the effect"),
    mode: z.enum(["follow", "trail"]).default("follow"),
    startTime: z.number().min(0).optional().describe("one-shot effects: start time in the animation (s)"),
    inheritRotation: z.boolean().optional().describe("default true; false keeps the effect upright while the bone rotates"),
    inheritScale: z.boolean().optional().describe("default true"),
    slot: z.string().optional().describe("draw-order anchor slot; default: on top of everything"),
    place: z.enum(["above", "below"]).optional().describe("relative to slot; default above"),
    matchLoop: z.boolean().optional().describe("default true: looping effects take the animation's length"),
    premultiplied: z.union([z.boolean(), z.literal("auto")]).optional().describe("match the character atlas' alpha mode; auto reads 4.x pma flag, assumes premultiplied for 3.8"),
    out: z.string().optional().describe("output .json path (relative to the character's folder); default <character>_fx.json"),
    tolerance: z.number().min(0).max(10).optional(),
  },
}, safe(async ({ id, character, atlas, out, tolerance, ...attach }) => {
  const effect = store.get(id);
  const jsonPath = resolve(HOME, character);
  const r = await attachToCharacter({ effect, jsonPath, atlasPath: atlas ? resolve(HOME, atlas) : undefined, attach, out, tolerance, textureDir: HOME });
  // remember the binding so the editor and later calls can re-attach
  store.save(id, { ...effect, attach: { ...attach, character } });
  return { ...json(r), isError: !r.validation.ok || undefined };
}));

server.registerTool("detach_effect", {
  title: "Remove an effect from a character",
  description: "Remove a previously attached effect (all fx_<effect>__ bones, slots, attachments, keys and its atlas page) from a merged character file.",
  inputSchema: {
    character: z.string().describe("merged character .json (usually <character>_fx.json)"),
    effect: z.string().describe("effect name as attached (inspect_character lists them)"),
    atlas: z.string().optional(),
  },
}, safe(async ({ character, effect, atlas }) => {
  const r = await detachFromCharacter({ jsonPath: resolve(HOME, character), atlasPath: atlas ? resolve(HOME, atlas) : undefined, effectName: effect });
  return { ...json(r), isError: !r.validation.ok || undefined };
}));

await server.connect(new StdioServerTransport());
