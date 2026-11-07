import { useState } from "react";
import type { Affector, AffectorType, Emitter } from "@core/schema";
import { listBuiltinTextures } from "@core/textures";
import { ColorField, NumberField, RangeField, Row, Section, Select, Toggle } from "../controls/fields";
import { CurveEditor, GradientEditor } from "../controls/CurveEditor";
import { importTexture, textureThumb } from "../textures";

type Patch = (patch: Record<string, unknown>, coalesce?: boolean) => void;
const TABS = ["Emitter", "Initial", "Lifetime", "Affectors"] as const;

export function Inspector({ emitter, onPatch, onCommit, onError }: { emitter: Emitter; onPatch: Patch; onCommit: () => void; onError: (m: string) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Emitter");
  const e = emitter;
  // live edits (drags) coalesce into one undo step; onCommit closes it
  const live = (patch: Record<string, unknown>) => onPatch(patch, true);
  const pts = e.motion.points;

  return (
    <aside className="inspector">
      <nav className="tabs">
        {TABS.map((t) => <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}
      </nav>
      <div className="inspector-body">
        {tab === "Emitter" && (
          <>
            <Section title="General">
              <Row label="Name"><input value={e.name} onChange={(ev) => live({ name: ev.target.value })} onBlur={onCommit} /></Row>
              <Row label="Emission"><Select value={e.emission.type} options={["continuous", "burst"] as const} onChange={(v) => onPatch({ emission: { type: v } })} /></Row>
              {e.emission.type === "continuous" ? (
                <>
                  <Row label="Rate" hint="Particles per second"><NumberField value={e.emission.rate} min={0} max={500} step={1} suffix="/s" onChange={(v) => live({ emission: { rate: v } })} onCommit={onCommit} /></Row>
                  <Toggle label="Rate over time (curve)" value={!!e.emission.rateOverTime} onChange={(on) => onPatch({ emission: { rateOverTime: on ? [[0, 1], [0.5, 0.2], [1, 1]] : null } })} />
                  {e.emission.rateOverTime && <CurveEditor value={e.emission.rateOverTime} max={2} onChange={(c) => live({ emission: { rateOverTime: c } })} onCommit={onCommit} />}
                </>
              ) : (
                <Bursts bursts={e.emission.bursts} onChange={(b) => onPatch({ emission: { bursts: b } })} />
              )}
              <Row label="Rate / distance" hint="Extra particles per 100 px the emitter travels (enable Motion path)">
                <NumberField value={e.emission.rateOverDistance} min={0} step={1} suffix="/100px" onChange={(v) => live({ emission: { rateOverDistance: v } })} onCommit={onCommit} />
              </Row>
              <Row label="Particle limit" hint="Max simultaneous particles = Spine bones/slots"><NumberField value={e.emission.limit} min={1} max={2000} onChange={(v) => live({ emission: { limit: Math.round(v) } })} onCommit={onCommit} /></Row>
              <Row label="Space" hint="Local: particles travel with the emitter bone. World: left behind (trails)."><Select value={e.simulationSpace} options={["local", "world"] as const} onChange={(v) => onPatch({ simulationSpace: v })} /></Row>
            </Section>
            <Section title="Rendering">
              <Row label="Blend"><Select value={e.blend} options={["normal", "additive", "multiply", "screen"] as const} onChange={(v) => onPatch({ blend: v })} /></Row>
              <TexturePicker value={e.texture} onChange={(t) => onPatch({ texture: t })} onError={onError} />
              <Toggle label="Colorize sprite" value={e.colorize} onChange={(v) => onPatch({ colorize: v })} />
              <Row label="Sprite origin" hint="Rotation and scale happen around this point">
                <PivotGrid value={e.pivot} onChange={(p) => onPatch({ pivot: p })} />
              </Row>
            </Section>
            <Section title="Shape">
              <Row label="Type"><Select value={e.shape.type} options={["point", "circle", "rectangle", "line"] as const} onChange={(v) => onPatch({ shape: { type: v } })} /></Row>
              {e.shape.type === "circle" && <Row label="Radius"><NumberField value={e.shape.radius} min={0} onChange={(v) => live({ shape: { radius: v } })} onCommit={onCommit} /></Row>}
              {(e.shape.type === "rectangle" || e.shape.type === "line") && <Row label="Width"><NumberField value={e.shape.width} min={0} onChange={(v) => live({ shape: { width: v } })} onCommit={onCommit} /></Row>}
              {e.shape.type === "rectangle" && <Row label="Height"><NumberField value={e.shape.height} min={0} onChange={(v) => live({ shape: { height: v } })} onCommit={onCommit} /></Row>}
              {(e.shape.type === "circle" || e.shape.type === "rectangle") && <Toggle label="Edge only" value={e.shape.edgeOnly} onChange={(v) => onPatch({ shape: { edgeOnly: v } })} />}
            </Section>
            <Section title="Direction">
              <Row label="Mode"><Select value={e.direction.mode} options={[{ value: "angle", label: "Angle" }, { value: "outward", label: "Outward from shape" }] as const} onChange={(v) => onPatch({ direction: { mode: v } })} /></Row>
              {e.direction.mode === "angle" && <Row label="Angle" hint="0 = right, 90 = up"><NumberField value={e.direction.angle} step={1} suffix="°" onChange={(v) => live({ direction: { angle: v } })} onCommit={onCommit} /></Row>}
              <Row label="Spread"><NumberField value={e.direction.spread} min={0} max={360} suffix="°" onChange={(v) => live({ direction: { spread: v } })} onCommit={onCommit} /></Row>
              <Row label="Distribution" hint="Uniform fans particles evenly across the spread"><Select value={e.direction.distribution} options={["random", "uniform"] as const} onChange={(v) => onPatch({ direction: { distribution: v } })} /></Row>
            </Section>
            <Section title="Transform">
              <Row label="Position">
                <div className="pair">
                  <NumberField value={e.transform.x} onChange={(v) => live({ transform: { x: v } })} onCommit={onCommit} />
                  <NumberField value={e.transform.y} onChange={(v) => live({ transform: { y: v } })} onCommit={onCommit} />
                </div>
              </Row>
              <Row label="Rotation"><NumberField value={e.transform.rotation} suffix="°" onChange={(v) => live({ transform: { rotation: v } })} onCommit={onCommit} /></Row>
              <Row label="Scale"><NumberField value={e.transform.scale} step={0.05} min={0.01} onChange={(v) => live({ transform: { scale: v } })} onCommit={onCommit} /></Row>
              <Row label="Inherit velocity" hint="Fraction of the moving emitter's velocity given to new particles"><NumberField value={e.transform.inheritVelocity} step={0.05} onChange={(v) => live({ transform: { inheritVelocity: v } })} onCommit={onCommit} /></Row>
            </Section>
            <Section title="Motion path" right={<Toggle label="" value={e.motion.enabled} onChange={(v) => onPatch({ motion: { enabled: v } })} />}>
              {!e.motion.enabled ? <p className="muted">Off. Turn on to move the emitter along a path (comets, orbits, trails).</p> : (
                <>
                  <div className="pair">
                    <Toggle label="Closed" value={e.motion.closed} onChange={(v) => onPatch({ motion: { closed: v } })} />
                    <Toggle label="Smooth" value={e.motion.smooth} onChange={(v) => onPatch({ motion: { smooth: v } })} />
                  </div>
                  <Row label="Playback"><Select value={e.motion.mode} options={[{ value: "loop", label: "Loop" }, { value: "pingpong", label: "Ping-pong" }, { value: "once", label: "Once" }] as const} onChange={(v) => onPatch({ motion: { mode: v } })} /></Row>
                  <Row label="Laps" hint="Laps per effect duration — whole numbers keep loops seamless"><NumberField value={e.motion.loops} step={1} min={0.1} onChange={(v) => live({ motion: { loops: v } })} onCommit={onCommit} /></Row>
                  <div className="points">
                    {pts.map((p, i) => (
                      <div className="point" key={i}>
                        <span className="muted">{i + 1}</span>
                        <NumberField value={p[0]} onChange={(v) => live({ motion: { points: pts.map((q, k) => (k === i ? [v, q[1]] : q)) } })} onCommit={onCommit} />
                        <NumberField value={p[1]} onChange={(v) => live({ motion: { points: pts.map((q, k) => (k === i ? [q[0], v] : q)) } })} onCommit={onCommit} />
                        <button className="icon-btn" title="Remove point" disabled={pts.length <= 2} onClick={() => onPatch({ motion: { points: pts.filter((_, k) => k !== i) } })}>✕</button>
                      </div>
                    ))}
                    <button className="link-btn" onClick={() => {
                      const a = pts[pts.length - 1], b = e.motion.closed ? pts[0] : [a[0] + 60, a[1]];
                      onPatch({ motion: { points: [...pts, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2 + 30)]] } });
                    }}>+ Add point</button>
                    <p className="muted small">Drag the orange points in the viewport.</p>
                  </div>
                </>
              )}
            </Section>
          </>
        )}

        {tab === "Initial" && (
          <Section title="At birth">
            <Row label="Lifetime"><RangeField value={e.initial.lifetime} step={0.05} min={0.01} suffix="s" onChange={(v) => onPatch({ initial: { lifetime: v } })} /></Row>
            <Row label="Speed"><RangeField value={e.initial.speed} step={5} suffix="px/s" onChange={(v) => onPatch({ initial: { speed: v } })} /></Row>
            <Row label="Size"><RangeField value={e.initial.size} step={1} min={0} suffix="px" onChange={(v) => onPatch({ initial: { size: v } })} /></Row>
            <Row label="Rotation"><RangeField value={e.initial.rotation} step={5} suffix="°" onChange={(v) => onPatch({ initial: { rotation: v } })} /></Row>
            <Row label="Spin"><RangeField value={e.initial.angularVelocity} step={10} suffix="°/s" onChange={(v) => onPatch({ initial: { angularVelocity: v } })} /></Row>
            <Row label="Weight" hint="Scales gravity (when 'use weight' is on) and resists wind"><RangeField value={e.initial.weight} step={0.1} min={0.01} onChange={(v) => onPatch({ initial: { weight: v } })} /></Row>
            <Row label="Colour"><ColorField value={e.initial.color} onChange={(v) => live({ initial: { color: v } })} /></Row>
            <Row label="Alpha"><RangeField value={e.initial.alpha} step={0.05} min={0} max={1} onChange={(v) => onPatch({ initial: { alpha: v } })} /></Row>
          </Section>
        )}

        {tab === "Lifetime" && (
          <>
            <Section title="Size over life" right={<Toggle label="Separate axes" value={!!e.overLifetime.sizeY} onChange={(on) => onPatch({ overLifetime: { sizeY: on ? e.overLifetime.size : null } })} />}>
              {e.overLifetime.sizeY && <span className="muted small">Width</span>}
              <CurveEditor value={e.overLifetime.size} max={2} onChange={(c) => live({ overLifetime: { size: c } })} onCommit={onCommit} />
              {e.overLifetime.sizeY && (
                <>
                  <span className="muted small">Height</span>
                  <CurveEditor value={e.overLifetime.sizeY} max={2} onChange={(c) => live({ overLifetime: { sizeY: c } })} onCommit={onCommit} />
                </>
              )}
            </Section>
            <Section title="Alpha over life"><CurveEditor value={e.overLifetime.alpha} max={1} onChange={(c) => live({ overLifetime: { alpha: c } })} onCommit={onCommit} /></Section>
            <Section title="Speed over life"><CurveEditor value={e.overLifetime.speed} max={2} onChange={(c) => live({ overLifetime: { speed: c } })} onCommit={onCommit} /></Section>
            <Section title="Spin over life"><CurveEditor value={e.overLifetime.spin} max={2} onChange={(c) => live({ overLifetime: { spin: c } })} onCommit={onCommit} /></Section>
            <Section
              title="Colour over life"
              right={<Toggle label="" value={!!e.overLifetime.color} onChange={(on) => onPatch({ overLifetime: { color: on ? [[0, "#ffffff"], [1, "#ff8020"]] : null } })} />}
            >
              {e.overLifetime.color ? <GradientEditor value={e.overLifetime.color} onChange={(g) => live({ overLifetime: { color: g } })} onCommit={onCommit} /> : <p className="muted">Off: particles keep the initial colour.</p>}
            </Section>
            <Section title="Orientation">
              <Toggle label="Align to velocity" value={e.overLifetime.alignToVelocity} onChange={(v) => onPatch({ overLifetime: { alignToVelocity: v } })} />
            </Section>
          </>
        )}

        {tab === "Affectors" && <Affectors list={e.affectors} onChange={(a, c) => onPatch({ affectors: a }, c)} onCommit={onCommit} />}
      </div>
    </aside>
  );
}

function PivotGrid({ value, onChange }: { value: [number, number]; onChange: (p: [number, number]) => void }) {
  const steps = [0, 0.5, 1];
  return (
    <div className="pivot">
      <div className="pivot-grid">
        {steps.map((y) => steps.map((x) => (
          <button key={`${x}-${y}`} className={`pivot-dot ${value[0] === x && value[1] === y ? "sel" : ""}`} title={`${x}, ${y}`} onClick={() => onChange([x, y])} />
        )))}
      </div>
      <div className="pivot-vals">
        <NumberField value={value[0]} step={0.05} min={0} max={1} onChange={(v) => onChange([v, value[1]])} />
        <NumberField value={value[1]} step={0.05} min={0} max={1} onChange={(v) => onChange([value[0], v])} />
      </div>
    </div>
  );
}

function Bursts({ bursts, onChange }: { bursts: { time: number; count: number }[]; onChange: (b: { time: number; count: number }[]) => void }) {
  return (
    <div className="bursts">
      {bursts.map((b, i) => (
        <div className="burst" key={i}>
          <span className="muted">at</span>
          <NumberField value={b.time} step={0.05} min={0} suffix="s" onChange={(v) => onChange(bursts.map((x, k) => (k === i ? { ...x, time: v } : x)))} />
          <NumberField value={b.count} step={1} min={1} suffix="×" onChange={(v) => onChange(bursts.map((x, k) => (k === i ? { ...x, count: Math.max(1, Math.round(v)) } : x)))} />
          <button className="icon-btn" title="Remove burst" disabled={bursts.length === 1} onClick={() => onChange(bursts.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <button className="link-btn" onClick={() => onChange([...bursts, { time: (bursts.at(-1)?.time ?? 0) + 0.5, count: 10 }])}>+ Add burst</button>
    </div>
  );
}

function TexturePicker({ value, onChange, onError }: { value: string; onChange: (t: string) => void; onError: (m: string) => void }) {
  const builtins = listBuiltinTextures();
  const custom = !builtins.some((b) => b.name === value);
  return (
    <div className="textures">
      {builtins.map((t) => (
        <button key={t.name} className={`tex ${t.name === value ? "sel" : ""}`} title={`${t.name} — ${t.description}`} onClick={() => onChange(t.name)}>
          <img src={textureThumb(t.name) || undefined} alt={t.name} />
        </button>
      ))}
      {custom && (
        <button className="tex sel" title={value}><img src={textureThumb(value) || undefined} alt={value} /></button>
      )}
      <label className="tex upload" title="Upload PNG / JPG / WebP">
        +
        <input type="file" accept="image/*" hidden onChange={async (ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = "";
          if (!f) return;
          try { onChange(await importTexture(f)); } catch (e) { onError((e as Error).message); }
        }} />
      </label>
    </div>
  );
}

const AFFECTORS: Record<AffectorType, { label: string; icon: string; make: () => Affector }> = {
  gravity: { label: "Gravity", icon: "⬇", make: () => ({ type: "gravity", enabled: true, x: 0, y: -981, useWeight: false }) },
  drag: { label: "Drag", icon: "◔", make: () => ({ type: "drag", enabled: true, amount: 1, mode: "linear", x: 1, y: 1 }) },
  wind: { label: "Wind", icon: "≋", make: () => ({ type: "wind", enabled: true, angle: 0, strength: [25, 50], turbulence: 0, frequency: 0.05 }) },
  turbulence: { label: "Noise field", icon: "☁", make: () => ({ type: "turbulence", enabled: true, strength: 100, frequency: 0.01, speed: 1 }) },
  velocityStretch: { label: "Velocity stretch", icon: "⇔", make: () => ({ type: "velocityStretch", enabled: true, amount: 0.5, max: 4, minSpeed: 50, volume: 0.5, align: true }) },
  vortex: { label: "Vortex", icon: "↻", make: () => ({ type: "vortex", enabled: true, x: 0, y: 0, strength: 180 }) },
  attractor: { label: "Attractor", icon: "◎", make: () => ({ type: "attractor", enabled: true, x: 0, y: 0, strength: 300, radius: 10 }) },
};

type Field = { key: string; label: string; step: number; min?: number; max?: number; suffix?: string };
const FIELDS: Record<AffectorType, Field[]> = {
  gravity: [],
  drag: [{ key: "amount", label: "Coefficient", step: 0.1, min: 0 }, { key: "x", label: "X axis ×", step: 0.1, min: 0 }, { key: "y", label: "Y axis ×", step: 0.1, min: 0 }],
  wind: [{ key: "angle", label: "Direction", step: 5, suffix: "°" }, { key: "turbulence", label: "Gustiness", step: 0.1, min: 0 }, { key: "frequency", label: "Gust rate", step: 0.01, min: 0.001 }],
  turbulence: [{ key: "strength", label: "Strength", step: 10 }, { key: "frequency", label: "Scale", step: 0.002, min: 0.0001 }, { key: "speed", label: "Scroll speed", step: 0.1 }],
  velocityStretch: [{ key: "amount", label: "Amount", step: 0.1, min: 0 }, { key: "max", label: "Max", step: 0.1, min: 1, suffix: "×" }, { key: "minSpeed", label: "Min speed", step: 5, min: 0, suffix: "px/s" }, { key: "volume", label: "Keep volume", step: 0.05, min: 0, max: 1 }],
  vortex: [{ key: "x", label: "Centre X", step: 5 }, { key: "y", label: "Centre Y", step: 5 }, { key: "strength", label: "Strength", step: 10 }],
  attractor: [{ key: "x", label: "Centre X", step: 5 }, { key: "y", label: "Centre Y", step: 5 }, { key: "strength", label: "Strength", step: 10 }, { key: "radius", label: "Radius", step: 1, min: 1 }],
};

const GRAVITY_PRESETS = { Earth: -981, Floaty: -150, Heavy: -2000, Rise: 300 };
const NOISE_PRESETS: Record<string, { strength: number; frequency: number; speed: number }> = {
  Smoke: { strength: 60, frequency: 0.008, speed: 0.4 },
  Fire: { strength: 120, frequency: 0.03, speed: 2 },
  "Water flow": { strength: 80, frequency: 0.005, speed: 0.8 },
  "Wind gusts": { strength: 200, frequency: 0.003, speed: 1.5 },
  Electric: { strength: 600, frequency: 0.06, speed: 6 },
};

function Affectors({ list, onChange, onCommit }: { list: Affector[]; onChange: (a: Affector[], coalesce?: boolean) => void; onCommit: () => void }) {
  const set = (i: number, patch: Partial<Affector>, coalesce = false) => onChange(list.map((x, k) => (k === i ? ({ ...x, ...patch } as Affector) : x)), coalesce);
  const move = (i: number, d: -1 | 1) => { const next = [...list]; const [a] = next.splice(i, 1); next.splice(i + d, 0, a); onChange(next); };
  return (
    <>
      {list.length === 0 && <p className="muted pad">No affectors. Particles move in straight lines.</p>}
      {list.map((a, i) => {
        const meta = AFFECTORS[a.type];
        const values = a as unknown as Record<string, number>;
        return (
          <section key={i} className={`section affector ${a.enabled ? "" : "off"}`}>
            <header>
              <span className="aff-icon">{meta.icon}</span>{meta.label}
              <span className="section-right">
                <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="icon-btn" title="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
                <input type="checkbox" title="Enabled" checked={a.enabled} onChange={(ev) => set(i, { enabled: ev.target.checked })} />
                <button className="icon-btn" title="Remove" onClick={() => onChange(list.filter((_, k) => k !== i))}>✕</button>
              </span>
            </header>
            <div className="section-body">
              {a.type === "gravity" && (() => {
                const strength = Math.round(Math.hypot(a.x, a.y));
                const dir = Math.round(((Math.atan2(a.y, a.x) * 180) / Math.PI + 360) % 360);
                const polar = (d: number, s: number) => ({ x: Math.round(Math.cos((d * Math.PI) / 180) * s * 100) / 100, y: Math.round(Math.sin((d * Math.PI) / 180) * s * 100) / 100 });
                return (
                  <>
                    <div className="chips">{Object.entries(GRAVITY_PRESETS).map(([n, y]) => <button key={n} className="chip" onClick={() => set(i, { x: 0, y })}>{n}</button>)}</div>
                    <Row label="Direction" hint="270 = down"><NumberField value={dir} step={5} suffix="°" onChange={(v) => set(i, polar(v, strength), true)} onCommit={onCommit} /></Row>
                    <Row label="Strength"><NumberField value={strength} step={10} min={0} suffix="px/s²" onChange={(v) => set(i, polar(dir, v), true)} onCommit={onCommit} /></Row>
                    <Toggle label="Use particle weight" value={a.useWeight} onChange={(v) => set(i, { useWeight: v })} />
                  </>
                );
              })()}
              {a.type === "drag" && <Row label="Type"><Select value={a.mode} options={["linear", "quadratic"] as const} onChange={(v) => set(i, { mode: v })} /></Row>}
              {a.type === "turbulence" && <div className="chips">{Object.entries(NOISE_PRESETS).map(([n, p]) => <button key={n} className="chip" onClick={() => set(i, p)}>{n}</button>)}</div>}
              {a.type === "wind" && <Row label="Strength"><RangeField value={a.strength} step={5} suffix="px/s²" onChange={(v) => set(i, { strength: v })} /></Row>}
              {FIELDS[a.type].map((f) => (
                <Row key={f.key} label={f.label}>
                  <NumberField value={values[f.key]} step={f.step} min={f.min} max={f.max} suffix={f.suffix} onChange={(v) => set(i, { [f.key]: v } as Partial<Affector>, true)} onCommit={onCommit} />
                </Row>
              ))}
              {a.type === "velocityStretch" && <Toggle label="Align to motion" value={a.align} onChange={(v) => set(i, { align: v })} />}
            </div>
          </section>
        );
      })}
      <div className="add-affector">
        {(Object.keys(AFFECTORS) as AffectorType[]).map((t) => (
          <button key={t} className="chip" onClick={() => onChange([...list, AFFECTORS[t].make()])}>+ {AFFECTORS[t].label}</button>
        ))}
      </div>
    </>
  );
}
