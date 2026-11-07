import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Range } from "@core/schema";

/** Number input whose label can be dragged left/right to scrub the value. */
export function NumberField({ value, onChange, step = 1, min, max, suffix, onCommit }: {
  value: number; onChange: (v: number) => void; onCommit?: () => void; step?: number; min?: number; max?: number; suffix?: string;
}) {
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmt(value)); }, [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (s: string) => {
    const v = Number(s);
    if (Number.isFinite(v)) onChange(clamp(v));
    else setText(fmt(value));
    onCommit?.();
  };
  const scrub = (ev: React.PointerEvent) => {
    const start = ev.clientX, v0 = value;
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => onChange(clamp(round(v0 + Math.round((e.clientX - start) / 3) * step, step)));
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); onCommit?.(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return (
    <div className="num">
      <span className="num-scrub" onPointerDown={scrub} title="Drag to adjust">⇔</span>
      <input
        value={text}
        inputMode="decimal"
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => { focused.current = false; commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const v = clamp(round(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1), step));
            onChange(v); setText(fmt(v));
          }
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </div>
  );
}

/** A Range: one number, or a random [min, max] pair. */
export function RangeField({ value, onChange, step, min, max, suffix }: {
  value: Range; onChange: (v: Range) => void; step?: number; min?: number; max?: number; suffix?: string;
}) {
  const isRange = Array.isArray(value);
  return (
    <div className="range">
      {isRange ? (
        <>
          <NumberField value={value[0]} onChange={(v) => onChange([v, value[1]])} step={step} min={min} max={max} />
          <span className="range-dash">–</span>
          <NumberField value={value[1]} onChange={(v) => onChange([value[0], v])} step={step} min={min} max={max} suffix={suffix} />
        </>
      ) : (
        <NumberField value={value} onChange={onChange} step={step} min={min} max={max} suffix={suffix} />
      )}
      <button
        className={`icon-btn ${isRange ? "on" : ""}`}
        title={isRange ? "Use a single value" : "Random between two values"}
        onClick={() => onChange(isRange ? value[0] : [value, value])}
      >⚄</button>
    </div>
  );
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: readonly (T | { value: T; label: string })[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        return <option key={v} value={v}>{typeof o === "string" ? cap(o) : o.label}</option>;
      })}
    </select>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hex = value.startsWith("#") ? value : `#${value}`;
  return (
    <div className="color">
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
      <input className="color-hex" value={hex} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && onChange(e.target.value)} />
    </div>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="row" title={hint}>
      <span className="row-label">{label}</span>
      <div className="row-control">{children}</div>
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <header><span className="dot" />{title}{right && <span className="section-right">{right}</span>}</header>
      <div className="section-body">{children}</div>
    </section>
  );
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
const round = (v: number, step: number) => { const d = Math.max(0, -Math.floor(Math.log10(step))); return Number(v.toFixed(d)); };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
