import type { Effect } from "@core/schema";
import type { Simulation } from "@core/simulate";
import { usePlayback, playback } from "../playback";
import { NumberField, Toggle, Select } from "../controls/fields";
import type { ViewMode } from "../viewport/Viewport";

export function Timeline({ effect, sim, mode, clip, onMode, onEffect, stats }: {
  effect: Effect;
  sim: Simulation;
  mode: ViewMode;
  /** character preview: the timeline follows the character animation instead of the effect */
  clip?: { length: number; label: string };
  onMode: (m: ViewMode) => void;
  onEffect: (patch: Partial<Effect>) => void;
  stats: { visible: number; fps: number; lanes?: number; keys?: number };
}) {
  const pb = usePlayback();
  const length = clip ? clip.length : sim.loop ? sim.frames / sim.fps : (sim.frames - 1) / sim.fps;
  const totalFrames = clip ? Math.max(1, Math.round(clip.length * sim.fps)) + 1 : sim.frames;
  const frame = Math.min(totalFrames - 1, Math.floor(pb.time * sim.fps + 1e-6));
  const seek = (t: number) => playback.set({ time: Math.max(0, Math.min(length, t)) });
  const step = (d: number) => playback.set({ playing: false, time: Math.max(0, Math.min(length, (frame + d) / sim.fps)) });

  return (
    <footer className="timeline">
      <div className="transport">
        {clip ? (
          <button className="btn primary" onClick={() => onMode(mode)} title="Back to the effect on its own (C)">◆ {clip.label}</button>
        ) : (
          <button className={`btn ${mode === "spine" ? "primary" : ""}`} onClick={() => onMode(mode === "spine" ? "simulation" : "spine")} title="Toggle between the live simulation and the baked Spine skeleton (spine-pixi 4.3 runtime)">
            {mode === "spine" ? "◆ Spine preview" : "◇ Simulation"}
          </button>
        )}
        <div className="transport-buttons">
          <button className="icon-btn" title="First frame (Home)" onClick={() => seek(0)}>⏮</button>
          <button className="icon-btn" title="Previous frame (,)" onClick={() => step(-1)}>‹</button>
          <button className="icon-btn play" title="Play / pause (Space)" onClick={() => playback.set({ playing: !pb.playing, time: !pb.playing && pb.time >= length ? 0 : pb.time })}>{pb.playing ? "❚❚" : "▶"}</button>
          <button className="icon-btn" title="Next frame (.)" onClick={() => step(1)}>›</button>
          <button className="icon-btn" title="Last frame (End)" onClick={() => seek(length)}>⏭</button>
        </div>
        <span className="time">{pb.time.toFixed(2)}s · f{frame}/{totalFrames - 1}</span>
        <div className="transport-right">
          <Select value={String(pb.speed) as "1"} options={[{ value: "0.25", label: "¼×" }, { value: "0.5", label: "½×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }] as never} onChange={(v) => playback.set({ speed: Number(v) })} />
          <label className="inline">Duration <NumberField value={effect.duration} step={0.1} min={0.1} max={20} suffix="s" onChange={(v) => onEffect({ duration: v })} /></label>
          <label className="inline">FPS <Select value={String(effect.fps) as "30"} options={["15", "24", "30", "60"] as never} onChange={(v) => onEffect({ fps: Number(v) })} /></label>
          <Toggle label="Loop" value={effect.loop} onChange={(v) => onEffect({ loop: v })} />
          <label className="inline" title="Random seed — same seed, same result">Seed <NumberField value={effect.seed} step={1} onChange={(v) => onEffect({ seed: Math.round(v) })} /></label>
          <button className="icon-btn" title="New random seed" onClick={() => onEffect({ seed: Math.floor(Math.random() * 2 ** 31) })}>⚄</button>
        </div>
      </div>
      <div className="scrub">
        <input type="range" min={0} max={length} step={1 / sim.fps} value={Math.min(pb.time, length)} onChange={(e) => playback.set({ playing: false, time: Number(e.target.value) })} />
        <div className="ticks">
          {Array.from({ length: Math.floor(length) + 1 }, (_, s) => <span key={s} style={{ left: `${(s / length) * 100}%` }}>{s}s</span>)}
        </div>
      </div>
      <div className="stats">
        <span>{stats.visible} particles</span>
        <span>{stats.fps} fps</span>
        {stats.lanes !== undefined && <span title="Spine bones/slots in the export">{stats.lanes} bones</span>}
        {stats.keys !== undefined && <span title="Keyframes in the export">{stats.keys.toLocaleString()} keys</span>}
      </div>
    </footer>
  );
}
