import type { Effect } from "@core/schema";

/** Talks to the dev-server API; falls back to localStorage when it isn't there (static hosting). */
export interface ProjectInfo { id: string; name: string; emitters: number }

const LS_KEY = "spinemagic.projects";

let online: boolean | null = null;
export async function isOnline(): Promise<boolean> {
  if (online !== null) return online;
  try { online = (await fetch("/api/info")).ok; } catch { online = false; }
  return online;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/${path}`, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body as T;
}

function lsAll(): Record<string, Effect> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}"); } catch { return {}; }
}
function lsPut(all: Record<string, Effect>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { /* storage full / blocked */ }
}
function slug(name: string, taken: (id: string) => boolean) {
  const base = name.toLowerCase().replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "effect";
  let id = base, n = 2;
  while (taken(id)) id = `${base}_${n++}`;
  return id;
}

export const api = {
  async list(): Promise<ProjectInfo[]> {
    if (await isOnline()) return req("effects");
    return Object.entries(lsAll()).map(([id, e]) => ({ id, name: e.name, emitters: e.emitters.length }));
  },
  async get(id: string): Promise<Effect> {
    if (await isOnline()) return req(`effects/${encodeURIComponent(id)}`);
    const e = lsAll()[id];
    if (!e) throw new Error(`effect ${id} not found`);
    return e;
  },
  async create(effect: Effect): Promise<{ id: string; effect: Effect }> {
    if (await isOnline()) return req("effects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effect }) });
    const all = lsAll();
    const id = slug(effect.name, (i) => i in all);
    all[id] = effect;
    lsPut(all);
    return { id, effect };
  },
  async save(id: string, effect: Effect): Promise<void> {
    if (await isOnline()) { await req(`effects/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(effect) }); return; }
    const all = lsAll();
    all[id] = effect;
    lsPut(all);
  },
  async uploadTexture(name: string, png: Uint8Array): Promise<string> {
    if (!(await isOnline())) throw new Error("custom textures need the local editor server (npm run web)");
    const r = await req<{ ref: string }>(`textures/${encodeURIComponent(name)}.png`, { method: "PUT", body: png as BodyInit });
    return r.ref;
  },
  async fetchTexture(ref: string): Promise<Uint8Array> {
    const name = ref.split("/").pop()!;
    const r = await fetch(`/api/textures/${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`texture ${ref} not found`);
    return new Uint8Array(await r.arrayBuffer());
  },
  async listCharacters(): Promise<{ name: string; skeletons: string[] }[]> {
    if (!(await isOnline())) return [];
    return req("characters");
  },
  async characterText(name: string, file: string): Promise<string> {
    const r = await fetch(`/api/characters/${encodeURIComponent(name)}/${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(`${file} not found in characters/${name}`);
    return r.text();
  },
  async characterBytes(name: string, file: string): Promise<Uint8Array> {
    const r = await fetch(`/api/characters/${encodeURIComponent(name)}/${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(`${file} not found in characters/${name}`);
    return new Uint8Array(await r.arrayBuffer());
  },
  async characterImage(name: string, file: string): Promise<ImageBitmap> {
    const r = await fetch(`/api/characters/${encodeURIComponent(name)}/${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(`atlas page ${file} not found in characters/${name} — upload it with the skeleton`);
    return createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  },
  async uploadCharacterFile(name: string, file: File): Promise<void> {
    if (!(await isOnline())) throw new Error("characters need the local editor server (npm run web)");
    await req(`characters/${encodeURIComponent(name)}/${encodeURIComponent(file.name)}`, { method: "PUT", body: file });
  },
  async addSampleCharacters(): Promise<void> {
    await req("characters/_samples", { method: "POST" });
  },
  /** Bakes the effect into the character on disk (same code path as the MCP attach_effect tool). */
  async attach(body: Record<string, unknown>): Promise<any> {
    return req("attach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  },
  /** Subscribes to on-disk changes (agent edits). Returns an unsubscribe function. */
  subscribe(onChange: (id: string) => void): () => void {
    let es: EventSource | null = null;
    let cancelled = false;
    isOnline().then((ok) => {
      if (!ok || cancelled) return; // unsubscribed before we connected
      es = new EventSource("/api/events");
      es.onmessage = (m) => {
        try { const d = JSON.parse(m.data); if (d.type === "changed") onChange(d.id); } catch { /* ignore */ }
      };
    });
    return () => { cancelled = true; es?.close(); };
  },
};
