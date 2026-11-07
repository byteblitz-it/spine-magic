import { useEffect, useState } from "react";

/** Playback clock shared by the viewport (writes every frame) and the timeline (reads, throttled). */
type Listener = () => void;

export const playback = {
  time: 0,
  playing: true,
  speed: 1,
  listeners: new Set<Listener>(),
  set(patch: Partial<{ time: number; playing: boolean; speed: number }>) {
    Object.assign(this, patch);
    this.listeners.forEach((l) => l());
  },
  tick(dt: number, length: number, loop: boolean) {
    if (!this.playing || length <= 0) return;
    let t = this.time + dt * this.speed;
    if (t >= length) t = loop ? t % length : (this.playing = false, length);
    this.time = t;
    this.listeners.forEach((l) => l());
  },
};

/** React view of the clock, updated at most once per animation frame. */
export function usePlayback() {
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0;
    const l = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; force((n) => n + 1); }); };
    playback.listeners.add(l);
    return () => { playback.listeners.delete(l); cancelAnimationFrame(raf); };
  }, []);
  return playback;
}
