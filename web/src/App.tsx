import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseEffect, SPINE_VERSIONS, type Effect, type SpineVersion } from "@core/schema";
import { simulate } from "@core/simulate";
import { bake, type BakeResult } from "@core/bake";
import { deepMerge } from "@core/merge";
import { PRESETS } from "@core/presets";
import { Viewport, type ViewMode } from "./viewport/Viewport";
import { Layers } from "./panels/Layers";
import { Inspector } from "./panels/Inspector";
import { Timeline } from "./panels/Timeline";
import { api, isOnline, type ProjectInfo } from "./api";
import { ensureTextures, resolveTexture } from "./textures";
import { exportZip } from "./exporter";
import { playback } from "./playback";
import { formatZodError } from "./errors";
import { inspectCharacter, mergeEffect, type MergeResult } from "@core/character";
import type { AttachmentInput } from "@core/schema";
import { CharacterPanel, type LoadedCharacter } from "./character/CharacterPanel";
import { CharacterView } from "./character/CharacterView";
import { boneSampler, loadRuntime, PREVIEW_VERSIONS, type SpineRuntime } from "./character/runtime";

/** Page image names in an atlas (first line of each blank-line separated block). */
function atlasPages(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.trim().split("\n")[0]?.trim() ?? "").filter((l) => /\.(png|jpe?g|webp)$/i.test(l));
}

async function loadCharacter(path: string): Promise<LoadedCharacter> {
  const m = /^characters\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m) throw new Error(`bad character path ${path}`);
  const [, name, file] = m;
  const json = JSON.parse(await api.characterText(name, file));
  const base = file.replace(/\.json$/i, "");
  let atlasText = "";
  for (const cand of [`${base}.atlas`, `${base}.atlas.txt`, `${base.replace(/_fx$/, "")}.atlas`, `${base.replace(/_fx$/, "")}.atlas.txt`]) {
    try { atlasText = await api.characterText(name, cand); break; } catch { /* try next */ }
  }
  if (!atlasText) throw new Error(`no .atlas found next to ${file} — upload it with the skeleton`);
  const pages = new Map<string, ImageBitmap>();
  for (const p of atlasPages(atlasText)) pages.set(p, await api.characterImage(name, p));
  return { path, name, file, json, atlasText, pages, info: inspectCharacter(json) };
}

const LAST_KEY = "spinemagic.last";

export function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [effect, setEffectState] = useState<Effect>(() => parseEffect(PRESETS["magic-sparkles"].effect));
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<ViewMode>("simulation");
  const [showGrid, setShowGrid] = useState(true);
  const [stats, setStats] = useState({ visible: 0, fps: 0 });
  const [toast, setToast] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [online, setOnline] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [texturesReady, setTexturesReady] = useState(0);

  // ---------- history (undo/redo); rapid edits within 1s merge into one step
  const effectRef = useRef(effect);
  effectRef.current = effect;
  const hist = useRef({ past: [] as Effect[], future: [] as Effect[], merging: false, at: 0 });
  const setEffect = useCallback((next: Effect, opts: { coalesce?: boolean; history?: boolean } = {}) => {
    const h = hist.current;
    const now = performance.now();
    if (opts.history !== false) {
      if (!(opts.coalesce && h.merging && now - h.at < 1000)) {
        h.past.push(effectRef.current);
        if (h.past.length > 200) h.past.shift();
      }
      h.future = [];
      h.merging = !!opts.coalesce;
      h.at = now;
    }
    effectRef.current = next;
    setEffectState(next);
    setSaveState("dirty");
  }, []);
  const commit = useCallback(() => { hist.current.merging = false; }, []);
  const undo = useCallback(() => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(effectRef.current);
    h.merging = false;
    effectRef.current = prev; setEffectState(prev); setSaveState("dirty");
  }, []);
  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(effectRef.current);
    h.merging = false;
    effectRef.current = next; setEffectState(next); setSaveState("dirty");
  }, []);

  const notify = useCallback((text: string, kind: "info" | "error" = "info") => {
    setToast({ text, kind });
    window.clearTimeout((notify as any)._t);
    (notify as any)._t = window.setTimeout(() => setToast(null), Math.min(10000, (kind === "error" ? 6000 : 3000) + text.length * 25));
  }, []);

  /** Validated update. `fn` gets a draft copy and returns the next document. */
  const update = useCallback((fn: (draft: Effect) => unknown, coalesce = false) => {
    try {
      setEffect(parseEffect(fn(structuredClone(effectRef.current))), { coalesce });
    } catch (e) {
      notify(formatZodError(e), "error");
    }
  }, [setEffect, notify]);

  const patchEmitter = useCallback((patch: Record<string, unknown>, coalesce?: boolean) => {
    update((d) => { d.emitters[selectedRef.current] = deepMerge(d.emitters[selectedRef.current], patch); return d; }, coalesce);
  }, [update]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // ---------- projects
  const refreshList = useCallback(async () => setProjects(await api.list()), []);
  const open = useCallback(async (pid: string) => {
    const e = await api.get(pid);
    await ensureTextures(e);
    hist.current = { past: [], future: [], merging: false, at: 0 };
    setId(pid); effectRef.current = e; setEffectState(e); setSelected(0); setSaveState("saved");
    playback.set({ time: 0, playing: true });
    try { localStorage.setItem(LAST_KEY, pid); } catch { /* ignore */ }
    setTexturesReady((n) => n + 1);
  }, []);
  const createFrom = useCallback(async (preset: string) => {
    const base = parseEffect(PRESETS[preset]?.effect ?? {});
    const { id: nid } = await api.create(base);
    await refreshList();
    await open(nid);
  }, [open, refreshList]);

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return; // StrictMode runs effects twice in dev
    booted.current = true;
    (async () => {
      setOnline(await isOnline());
      const list = await api.list();
      setProjects(list);
      let last: string | null = null;
      try { last = localStorage.getItem(LAST_KEY); } catch { /* ignore */ }
      const pick = list.find((p) => p.id === last)?.id ?? list[0]?.id;
      if (pick) await open(pick);
      else await createFrom("magic-sparkles");
    })().catch((e) => notify(String(e), "error"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // autosave
  useEffect(() => {
    if (!id || saveState !== "dirty") return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      try { await api.save(id, effectRef.current); setSaveState("saved"); refreshList(); }
      catch (e) { setSaveState("error"); notify(`Save failed: ${(e as Error).message}`, "error"); }
    }, 400);
    return () => clearTimeout(t);
  }, [effect, id, saveState, refreshList, notify]);

  // live sync: an agent (MCP) or another tool edited the file on disk
  useEffect(() => api.subscribe(async (changed) => {
    if (changed !== idRef.current) { refreshList(); return; }
    try {
      const e = await api.get(changed);
      if (JSON.stringify(e) === JSON.stringify(effectRef.current)) return;
      await ensureTextures(e);
      setEffect(e);
      setSaveState("saved");
      setTexturesReady((n) => n + 1);
      notify("Updated from disk (agent edit) — Ctrl+Z to undo");
    } catch { /* file mid-write */ }
  }), [refreshList, setEffect, notify]);
  const idRef = useRef(id);
  idRef.current = id;

  // ---------- derived: simulation (immediate) and bake (debounced, for Spine preview + stats)
  const sim = useMemo(() => simulate(effect), [effect]);
  const [baked, setBaked] = useState<BakeResult | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      try { setBaked(bake(effect, { version: "4.3", resolveTexture, name: "preview" })); }
      catch (e) { setBaked(null); notify(`Bake failed: ${(e as Error).message}`, "error"); }
    }, mode === "spine" ? 60 : 300);
    return () => clearTimeout(t);
  }, [effect, mode, texturesReady, notify]);

  useEffect(() => { if (selected >= effect.emitters.length) setSelected(effect.emitters.length - 1); }, [effect, selected]);

  // ---------- character binding: load skeleton, runtime, live merge (what "Bake into character" will write)
  const [character, setCharacter] = useState<LoadedCharacter | null>(null);
  const [charLoading, setCharLoading] = useState(false);
  const [charError, setCharError] = useState<string | null>(null);
  const [onCharacter, setOnCharacter] = useState(false);
  const [rt, setRt] = useState<SpineRuntime | null>(null);
  const [merged, setMerged] = useState<MergeResult | null>(null);
  const charPath = effect.attach?.character;
  useEffect(() => {
    if (!charPath) { setCharacter(null); setOnCharacter(false); return; }
    let cancelled = false;
    setCharLoading(true); setCharError(null);
    loadCharacter(charPath).then((c) => {
      if (cancelled) return;
      setCharacter(c);
      // keep the binding valid for this skeleton
      const a = effectRef.current.attach;
      const bones = c.info.bones.map((b) => b.name), anims = c.info.animations.map((x) => x.name);
      if (a && (!bones.includes(a.bone) || !anims.includes(a.animation))) {
        const bone = ["hand", "weapon", "hand_R", "hand_r"].find((n) => bones.includes(n)) ?? bones[bones.length - 1];
        setEffect(parseEffect({ ...effectRef.current, attach: { ...a, bone: bones.includes(a.bone) ? a.bone : bone, animation: anims.includes(a.animation) ? a.animation : anims[0] } }), { history: false });
      }
    }).catch((e) => { if (!cancelled) { setCharacter(null); setCharError((e as Error).message); } })
      .finally(() => { if (!cancelled) setCharLoading(false); });
    return () => { cancelled = true; };
  }, [charPath, setEffect]);
  useEffect(() => {
    setRt(null);
    if (!character || !PREVIEW_VERSIONS.includes(character.info.version)) return;
    loadRuntime(character.info.version).then(setRt).catch((e) => setCharError((e as Error).message));
  }, [character]);
  const sampler = useMemo(() => (rt && character ? boneSampler(rt, character.json, character.atlasText) : undefined), [rt, character]);
  useEffect(() => {
    if (!onCharacter || !character || !effect.attach) return;
    const t = setTimeout(() => {
      try {
        setMerged(mergeEffect({ character: character.json, characterAtlas: character.atlasText, effect, attach: effect.attach!, resolveTexture, sampleBone: sampler }));
        setCharError(null);
      } catch (e) { setMerged(null); setCharError((e as Error).message); }
    }, 120);
    return () => clearTimeout(t);
  }, [onCharacter, character, effect, sampler, texturesReady]);
  const clipLength = character && effect.attach ? Math.max(0.05, merged ? inspectCharacter(merged.json).animations.find((a) => a.name === effect.attach!.animation)?.duration ?? 1 : character.info.animations.find((a) => a.name === effect.attach!.animation)?.duration ?? 1) : 0;
  const showCharacter = onCharacter && !!rt && !!merged && !!character && !!effect.attach;

  const setAttach = (a: AttachmentInput | null) => update((d) => ({ ...d, attach: a ?? undefined }));
  const bakeIntoCharacter = async () => {
    if (!id || !effect.attach?.character) return;
    try {
      await api.save(id, effectRef.current);
      const r = await api.attach({ id, ...effect.attach });
      const ok = r.validation?.ok;
      notify(ok
        ? `Baked into ${r.files.json.split(/[\\/]/).slice(-2).join("/")} — Spine ${r.version}, ${r.stats.addedBones} bones added (${r.stats.totalBones} total), validated in the ${r.validation.runtime}${r.warnings.length ? `\n${r.warnings.join("\n")}` : ""}`
        : `Baked, but validation failed:\n${(r.validation?.errors ?? []).join("\n")}`, ok ? "info" : "error");
    } catch (e) { notify(`Bake failed: ${(e as Error).message}`, "error"); }
  };

  // ---------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (typing) return;
      const len = sim.loop ? sim.frames / sim.fps : (sim.frames - 1) / sim.fps;
      if (e.key === " ") { e.preventDefault(); playback.set({ playing: !playback.playing }); }
      if (e.key === ",") playback.set({ playing: false, time: Math.max(0, playback.time - 1 / sim.fps) });
      if (e.key === ".") playback.set({ playing: false, time: Math.min(len, playback.time + 1 / sim.fps) });
      if (e.key === "Home") playback.set({ time: 0 });
      if (e.key === "End") playback.set({ time: len });
      if (e.key.toLowerCase() === "f") document.querySelector<HTMLButtonElement>(".vp-fit")?.click();
      if (e.key.toLowerCase() === "p") setMode((m) => (m === "spine" ? "simulation" : "spine"));
      if (e.key.toLowerCase() === "c" && charPath) setOnCharacter((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, sim, charPath]);

  const emitter = effect.emitters[Math.min(selected, effect.emitters.length - 1)];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo" />SpineMagic</div>
        <div className="project">
          <select value={id ?? ""} onChange={(e) => open(e.target.value)} title="Open effect">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
          </select>
          <select value="" onChange={(e) => e.target.value && createFrom(e.target.value)} title="New effect from preset">
            <option value="">+ New…</option>
            {Object.keys(PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input className="name" value={effect.name} onChange={(e) => update((d) => ({ ...d, name: e.target.value || "effect" }), true)} onBlur={commit} title="Effect name (export file name)" />
          <span className={`save ${saveState}`}>{online ? { saved: "Saved", saving: "Saving…", dirty: "Unsaved", error: "Save failed" }[saveState] : "Browser storage"}</span>
        </div>
        <div className="topbar-right">
          <button className="icon-btn" title="Undo (Ctrl+Z)" onClick={undo}>↶</button>
          <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" onClick={redo}>↷</button>
          <button className={`icon-btn ${showGrid ? "on" : ""}`} title="Grid" onClick={() => setShowGrid((g) => !g)}>#</button>
          <span className={`agent ${online ? "on" : ""}`} title={online ? "Live: edits made by an agent through the SpineMagic MCP server appear here" : "Offline: run `npm run web` for agent sync"}>● {online ? "Agent sync" : "Offline"}</span>
          <div className="export-wrap">
            <button className="btn primary" onClick={() => setExportOpen((o) => !o)}>⇩ Export</button>
            {exportOpen && <ExportPanel effect={effect} baked={baked} onClose={() => setExportOpen(false)} notify={notify} />}
          </div>
        </div>
      </header>

      <div className="left-col">
      <Layers
        effect={effect}
        selected={selected}
        onSelect={setSelected}
        onToggle={(i) => update((d) => { d.emitters[i].enabled = !d.emitters[i].enabled; return d; })}
        onAdd={(preset) => update((d) => {
          const base = preset ? structuredClone(PRESETS[preset].effect.emitters?.[0] ?? {}) : { name: `emitter ${d.emitters.length + 1}` };
          d.emitters.push(base as Effect["emitters"][number]);
          setSelected(d.emitters.length - 1);
          return d;
        })}
        onRemove={(i) => update((d) => { d.emitters.splice(i, 1); return d; })}
        onDuplicate={(i) => update((d) => { d.emitters.splice(i + 1, 0, { ...structuredClone(d.emitters[i]), name: `${d.emitters[i].name} copy` }); setSelected(i + 1); return d; })}
        onMove={(i, dir) => update((d) => { const [e] = d.emitters.splice(i, 1); d.emitters.splice(i + dir, 0, e); setSelected(i + dir); return d; })}
      />
      <CharacterPanel
        effect={effect}
        character={character}
        loading={charLoading}
        error={charError}
        previewing={onCharacter}
        onAttach={setAttach}
        onPreview={(on) => { setOnCharacter(on); playback.set({ time: 0, playing: true }); }}
        onBake={bakeIntoCharacter}
        onError={(m) => notify(m, "error")}
      />
      </div>

      <main className="stage">
        {showCharacter ? (
          <CharacterView
            rt={rt!}
            merged={merged!}
            pages={character!.pages}
            animation={effect.attach!.animation}
            duration={clipLength}
            bone={effect.attach!.bone}
            showBones={showGrid}
            onStats={setStats}
          />
        ) : (
        <Viewport
          effect={effect}
          sim={sim}
          bake={mode === "spine" ? baked : null}
          mode={mode}
          selected={selected}
          showGrid={showGrid}
          onStats={setStats}
          onMoveEmitter={(i, x, y, done) => {
            if (done) { commit(); return; }
            update((d) => { d.emitters[i].transform.x = x; d.emitters[i].transform.y = y; return d; }, true);
          }}
          onMovePathPoint={(i, p, x, y, done) => {
            if (done) { commit(); return; }
            update((d) => { d.emitters[i].motion.points[p] = [x, y]; return d; }, true);
          }}
        />
        )}
        <div className="vp-hint">{showCharacter
          ? `On character: ${effect.attach!.animation} · bone ${effect.attach!.bone} · # toggles bones · right-drag to pan · wheel to zoom · C to leave`
          : "Drag the blue handle (or Alt+click) to move the emitter · right-drag to pan · wheel to zoom · F to frame · P to toggle Spine preview"}</div>
        <Timeline
          effect={effect}
          sim={sim}
          mode={mode}
          clip={showCharacter ? { length: clipLength, label: `${effect.attach!.animation} (character)` } : undefined}
          onMode={(m) => { setOnCharacter(false); setMode(m); }}
          onEffect={(p) => update((d) => ({ ...d, ...p }), true)}
          stats={{ ...stats, lanes: baked?.stats.lanes, keys: baked?.stats.keys }}
        />
      </main>

      {emitter && <Inspector key={selected} emitter={emitter} onPatch={patchEmitter} onCommit={commit} onError={(m) => notify(m, "error")} />}

      {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
    </div>
  );
}

function ExportPanel({ effect, baked, onClose, notify }: { effect: Effect; baked: BakeResult | null; onClose: () => void; notify: (t: string, k?: "info" | "error") => void }) {
  const [versions, setVersions] = useState<SpineVersion[]>(["4.2"]);
  const [tolerance, setTolerance] = useState(0.5);
  const toggle = (v: SpineVersion) => setVersions((vs) => (vs.includes(v) ? vs.filter((x) => x !== v) : [...vs, v].sort()));
  return (
    <div className="popover" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <h3>Export to Spine</h3>
      <div className="versions">
        {SPINE_VERSIONS.map((v) => (
          <label key={v} className={`chip ${versions.includes(v) ? "on" : ""}`}>
            <input type="checkbox" hidden checked={versions.includes(v)} onChange={() => toggle(v)} />{v}
          </label>
        ))}
      </div>
      <label className="row">
        <span className="row-label" title="Higher = fewer keys, lighter file; 0 = every frame">Key reduction</span>
        <input type="range" min={0} max={3} step={0.1} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
        <span className="muted">{tolerance.toFixed(1)}</span>
      </label>
      {baked && (
        <p className="muted small">
          {baked.stats.lanes} bones/slots · {baked.stats.particles} particles · {baked.stats.durationSeconds}s
          {baked.stats.droppedParticles > 0 && <b className="warn"> · {baked.stats.droppedParticles} dropped by particle limit</b>}
        </p>
      )}
      <button
        className="btn primary wide"
        disabled={versions.length === 0}
        onClick={() => {
          try {
            const r = exportZip(effect, versions, tolerance);
            notify(`Exported ${versions.join(", ")} · ${r.stats.keys.toLocaleString()} keys · ${(r.bytes / 1024).toFixed(0)} KB`);
            onClose();
          } catch (e) { notify(`Export failed: ${(e as Error).message}`, "error"); }
        }}
      >Download .zip</button>
      <p className="muted small">JSON + atlas + PNG per version. In Spine: Import Data → the .json.</p>
    </div>
  );
}
