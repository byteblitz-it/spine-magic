import { useRef, useState } from "react";
import type { Curve, Gradient } from "@core/schema";
import { evalGradient } from "@core/math";

const W = 260, H = 90, PAD = 8;

/**
 * Piecewise-linear curve over particle life. Drag points, double-click to add, right-click to remove.
 * `max` sets the visible value range [0, max].
 */
export function CurveEditor({ value, onChange, max = 1, onCommit }: { value: Curve; onChange: (c: Curve) => void; onCommit?: () => void; max?: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const top = Math.max(max, ...value.map((p) => p[1]));
  const px = (t: number) => PAD + t * (W - 2 * PAD);
  const py = (v: number) => H - PAD - (v / top) * (H - 2 * PAD);
  const toVal = (ev: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    const t = ((ev.clientX - r.left) / r.width * W - PAD) / (W - 2 * PAD);
    const v = ((H - PAD) - (ev.clientY - r.top) / r.height * H) / (H - 2 * PAD) * top;
    return [clamp(t, 0, 1), Math.max(0, Math.round(v * 100) / 100)];
  };
  const sorted = (c: Curve) => [...c].sort((a, b) => a[0] - b[0]) as Curve;

  const drag = (i: number) => (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    setActive(i);
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    let cur = value;
    const move = (e: PointerEvent) => {
      const [t, v] = toVal(e);
      const next = cur.map((p, k) => (k === i ? [i === 0 ? 0 : i === cur.length - 1 ? 1 : clamp(t, cur[i - 1][0], cur[i + 1][0]), v] : p)) as Curve;
      cur = next;
      onChange(next);
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); onCommit?.(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const line = value.map((p) => `${px(p[0])},${py(p[1])}`).join(" ");
  return (
    <div className="curve">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        onDoubleClick={(e) => { onChange(sorted([...value, toVal(e)])); onCommit?.(); }}
      >
        <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} className="curve-bg" />
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={px(g)} x2={px(g)} y1={PAD} y2={H - PAD} className="curve-grid" />)}
        <line x1={PAD} x2={W - PAD} y1={py(1)} y2={py(1)} className="curve-one" />
        <polyline points={`${px(0)},${py(value[0][1])} ${line} ${px(1)},${py(value[value.length - 1][1])}`} className="curve-line" />
        {value.map((p, i) => (
          <circle
            key={i}
            cx={px(p[0])}
            cy={py(p[1])}
            r={active === i ? 6 : 5}
            className="curve-pt"
            onPointerDown={drag(i)}
            onContextMenu={(e) => { e.preventDefault(); if (value.length > 1) { onChange(value.filter((_, k) => k !== i) as Curve); onCommit?.(); } }}
          />
        ))}
      </svg>
      <div className="curve-meta">
        <span>birth</span>
        <span>{active !== null && value[active] ? `t ${value[active][0].toFixed(2)} · ${value[active][1]}` : "double-click add · right-click remove"}</span>
        <span>death</span>
      </div>
    </div>
  );
}

/** Colour stops over particle life. Click the bar to add a stop; drag stops; right-click removes. */
export function GradientEditor({ value, onChange, onCommit }: { value: Gradient; onChange: (g: Gradient) => void; onCommit?: () => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(0);
  const css = `linear-gradient(90deg, ${value.map(([t, c]) => `${norm(c)} ${t * 100}%`).join(", ")})`;
  const tAt = (x: number) => { const r = bar.current!.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1); };

  const add = (ev: React.MouseEvent) => {
    const t = Math.round(tAt(ev.clientX) * 100) / 100;
    const [r, g, b] = evalGradient(value, t);
    const hex = "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
    const next = [...value, [t, hex]].sort((a, b) => (a[0] as number) - (b[0] as number)) as Gradient;
    onChange(next);
    setSel(next.findIndex((s) => s[0] === t));
    onCommit?.();
  };
  const drag = (i: number) => (ev: React.PointerEvent) => {
    ev.stopPropagation();
    setSel(i);
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => onChange(value.map((s, k) => (k === i ? [Math.round(tAt(e.clientX) * 100) / 100, s[1]] : s)) as Gradient);
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); onCommit?.(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const cur = value[Math.min(sel, value.length - 1)];
  return (
    <div className="gradient">
      <div className="gradient-bar" ref={bar} style={{ background: css }} onClick={add} title="Click to add a colour stop">
        {value.map(([t, c], i) => (
          <span
            key={i}
            className={`gradient-stop ${i === sel ? "sel" : ""}`}
            style={{ left: `${t * 100}%`, background: norm(c) }}
            onPointerDown={drag(i)}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); if (value.length > 1) { onChange(value.filter((_, k) => k !== i) as Gradient); setSel(0); onCommit?.(); } }}
          />
        ))}
      </div>
      {cur && (
        <div className="gradient-edit">
          <input type="color" value={norm(cur[1])} onChange={(e) => { onChange(value.map((s, k) => (k === sel ? [s[0], e.target.value] : s)) as Gradient); }} onBlur={onCommit} />
          <span>at {Math.round(cur[0] * 100)}% of life</span>
        </div>
      )}
    </div>
  );
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const norm = (c: string) => (c.startsWith("#") ? c : `#${c}`);
