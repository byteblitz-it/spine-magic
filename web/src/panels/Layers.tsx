import { useState } from "react";
import type { Effect } from "@core/schema";
import { PRESETS } from "@core/presets";
import { textureThumb } from "../textures";

export function Layers({ effect, selected, onSelect, onToggle, onAdd, onRemove, onDuplicate, onMove }: {
  effect: Effect;
  selected: number;
  onSelect: (i: number) => void;
  onToggle: (i: number) => void;
  onAdd: (preset?: string) => void;
  onRemove: (i: number) => void;
  onDuplicate: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <aside className="layers">
      <header className="panel-head">
        <span>Layers</span>
        <button className="btn small" onClick={() => setAdding((a) => !a)}>+ Add</button>
      </header>
      {adding && (
        <div className="add-menu">
          <button onClick={() => { onAdd(); setAdding(false); }}>Empty emitter</button>
          {Object.entries(PRESETS).map(([id, p]) => (
            <button key={id} title={p.description} onClick={() => { onAdd(id); setAdding(false); }}>From “{id}”</button>
          ))}
        </div>
      )}
      <ol className="layer-list">
        {effect.emitters.map((e, i) => (
          <li key={i} className={`layer ${i === selected ? "sel" : ""} ${e.enabled ? "" : "off"}`} onClick={() => onSelect(i)}>
            <img className="layer-thumb" src={textureThumb(e.texture) || undefined} alt="" />
            <div className="layer-text">
              <span className="layer-name">{e.name}</span>
              <span className="layer-sub">{e.emission.type} · {e.blend}</span>
            </div>
            <div className="layer-actions" onClick={(ev) => ev.stopPropagation()}>
              <button className="icon-btn" title={e.enabled ? "Hide" : "Show"} onClick={() => onToggle(i)}>{e.enabled ? "◉" : "○"}</button>
              <button className="icon-btn" title="Move up (draws behind)" disabled={i === 0} onClick={() => onMove(i, -1)}>↑</button>
              <button className="icon-btn" title="Move down (draws on top)" disabled={i === effect.emitters.length - 1} onClick={() => onMove(i, 1)}>↓</button>
              <button className="icon-btn" title="Duplicate" onClick={() => onDuplicate(i)}>⧉</button>
              <button className="icon-btn" title="Delete" disabled={effect.emitters.length === 1} onClick={() => onRemove(i)}>✕</button>
            </div>
          </li>
        ))}
      </ol>
      <p className="muted pad small">Later layers draw on top.</p>
    </aside>
  );
}
