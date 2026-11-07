import { useEffect, useState } from "react";
import type { Attachment, AttachmentInput, Effect } from "@core/schema";
import type { CharacterInfo } from "@core/character";
import { api } from "../api";
import { NumberField, Select, Toggle } from "../controls/fields";
import { PREVIEW_VERSIONS } from "./runtime";

export interface LoadedCharacter {
  path: string; // characters/<name>/<file>.json
  name: string;
  file: string;
  json: any;
  atlasText: string;
  pages: Map<string, ImageBitmap>;
  info: CharacterInfo;
}

/** Character binding: pick a skeleton, bone, animation and how the effect rides on it. */
export function CharacterPanel({ effect, character, loading, error, previewing, onAttach, onPreview, onBake, onError }: {
  effect: Effect;
  character: LoadedCharacter | null;
  loading: boolean;
  error: string | null;
  previewing: boolean;
  onAttach: (a: AttachmentInput | null) => void;
  onPreview: (on: boolean) => void;
  onBake: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [list, setList] = useState<{ name: string; skeletons: string[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = () => api.listCharacters().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);

  const a = effect.attach;
  const set = (patch: Partial<Attachment>) => a && onAttach({ ...a, ...patch });
  const choose = (path: string, info?: CharacterInfo) => {
    if (!path) { onAttach(null); return; }
    // bone/animation are fixed up by the app once the skeleton has loaded (unknown names → best guess)
    const bones = info?.bones.map((b) => b.name) ?? [];
    const bone = ["sword_tip", "staff_orb", "hand", "weapon", "hand_R", "hand_r", "R_hand"].find((n) => bones.includes(n)) ?? bones[bones.length - 1] ?? "";
    onAttach({ ...(a ?? {}), character: path, bone: a && (!info || bones.includes(a.bone)) ? a.bone : bone, animation: a?.animation ?? info?.animations[0]?.name ?? "" });
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const json = [...files].find((f) => /\.(json|skel|skel\.bytes)$/i.test(f.name));
    if (!json) { onError("include the skeleton .json or .skel (plus its .atlas and .png pages)"); return; }
    const name = json.name.replace(/\.json$|\.skel(\.bytes)?$/i, "").replace(/[^\w.-]/g, "_");
    try {
      for (const f of files) await api.uploadCharacterFile(name, f);
      await refresh();
      choose(`characters/${name}/${json.name}`);
    } catch (e) { onError((e as Error).message); }
  };

  const options = list.flatMap((c) => c.skeletons.map((s) => ({ value: `characters/${c.name}/${s}`, label: `${c.name} / ${s}` })));
  const info = character?.info;
  const depth = (name: string): number => { const b = info?.bones.find((x) => x.name === name); return b?.parent ? 1 + depth(b.parent) : 0; };

  return (
    <section className="character-panel">
      <header className="panel-head"><span>Character</span>
        <label className="btn small" title="Upload the skeleton .json or .skel with its .atlas and .png pages">Upload<input type="file" multiple hidden accept=".json,.skel,.bytes,.atlas,.txt,.png" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} /></label>
      </header>
      <div className="character-body">
        {options.length === 0 && (
          <p className="muted small">No characters yet. Upload a Spine skeleton (.json 3.8–4.3, or .skel 3.8 / 4.2, + .atlas + .png) or{" "}
            <button className="link-btn" onClick={async () => { await api.addSampleCharacters(); await refresh(); }}>add the sample knight &amp; wizard</button>.</p>
        )}
        {options.length > 0 && (
          <select value={a?.character ?? ""} onChange={(e) => choose(e.target.value)}>
            <option value="">— none —</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {loading && <p className="muted small">Loading…</p>}
        {error && <p className="error small">{error}</p>}
        {a && info && (
          <>
            <div className="char-meta">
              <span className="chip">Spine {info.version}</span>
              <span className="muted small">{info.bones.length} bones · {info.slots.length} slots</span>
            </div>
            <label className="field"><span>Animation</span>
              <select value={a.animation} onChange={(e) => set({ animation: e.target.value })}>
                {info.animations.map((x) => <option key={x.name} value={x.name}>{x.name} ({x.duration}s)</option>)}
              </select>
            </label>
            <label className="field"><span>Bone</span>
              <select value={a.bone} onChange={(e) => set({ bone: e.target.value })}>
                {info.bones.filter((b) => !b.name.startsWith("fx_")).map((b) => <option key={b.name} value={b.name}>{"  ".repeat(depth(b.name))}{b.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Mode</span>
              <Select value={a.mode} options={[{ value: "follow", label: "Follow bone (sticks)" }, { value: "trail", label: "Trail (world emitters)" }] as const} onChange={(v) => set({ mode: v })} />
            </label>
            {!effect.loop && <label className="field"><span>Start at</span><NumberField value={a.startTime} step={1 / 30} min={0} suffix="s" onChange={(v) => set({ startTime: v })} /></label>}
            <div className="pair">
              <Toggle label="Inherit rotation" value={a.inheritRotation} onChange={(v) => set({ inheritRotation: v })} />
              <Toggle label="Inherit scale" value={a.inheritScale} onChange={(v) => set({ inheritScale: v })} />
            </div>
            <label className="field"><span>Draw order</span>
              <select value={a.slot ? `${a.place}:${a.slot}` : ""} onChange={(e) => {
                const [place, slot] = e.target.value ? e.target.value.split(/:(.*)/s) : [undefined, undefined];
                set({ slot: slot || undefined, place: (place as "above" | "below") ?? "above" });
              }}>
                <option value="">On top of everything</option>
                {info.slots.filter((s) => !s.name.startsWith("fx_")).flatMap((s) => [
                  <option key={`a${s.name}`} value={`above:${s.name}`}>Above {s.name}</option>,
                  <option key={`b${s.name}`} value={`below:${s.name}`}>Below {s.name}</option>,
                ])}
              </select>
            </label>
            <label className="field" title="Match the character atlas' alpha mode"><span>Alpha</span>
              <select value={String(a.premultiplied)} onChange={(e) => set({ premultiplied: e.target.value === "auto" ? "auto" : e.target.value === "true" })}>
                <option value="auto">Auto ({info.version === "3.8" ? "premultiplied" : "from atlas"})</option>
                <option value="true">Premultiplied</option>
                <option value="false">Straight</option>
              </select>
            </label>
            <div className="char-actions">
              <button className={`btn ${previewing ? "primary" : ""}`} disabled={!PREVIEW_VERSIONS.includes(info.version)} title={PREVIEW_VERSIONS.includes(info.version) ? "Preview the merged character (C)" : `Preview supports Spine ${PREVIEW_VERSIONS.join(" and ")}`} onClick={() => onPreview(!previewing)}>
                {previewing ? "◆ On character" : "◇ Preview on character"}
              </button>
              <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await onBake(); } finally { setBusy(false); } }}>
                {busy ? "Baking…" : "Bake into character"}
              </button>
            </div>
            <p className="muted small">Writes {character!.file.replace(/(_fx)?(\.json|\.skel(\.bytes)?)$/i, "_fx.json")} next to the original (never overwritten).</p>
          </>
        )}
      </div>
    </section>
  );
}
