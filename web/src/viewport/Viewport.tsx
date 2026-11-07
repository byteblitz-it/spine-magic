import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { Spine, SpineTexture, TextureAtlas, AtlasAttachmentLoader, SkeletonJson } from "@esotericsoftware/spine-pixi-v8";
import type { Effect } from "@core/schema";
import type { Simulation, PState } from "@core/simulate";
import type { BakeResult } from "@core/bake";
import { buildPath, emitterOrigin } from "@core/motion";
import type { Emitter } from "@core/schema";
import { playback } from "../playback";
import { pixiTexture, imageToCanvas } from "../textures";

export type ViewMode = "simulation" | "spine";

export interface ViewportProps {
  effect: Effect;
  sim: Simulation;
  bake: BakeResult | null;
  mode: ViewMode;
  selected: number;
  showGrid: boolean;
  onMoveEmitter: (index: number, x: number, y: number, done: boolean) => void;
  /** Drag of a motion-path control point, in path (emitter-local) coordinates. */
  onMovePathPoint: (index: number, point: number, x: number, y: number, done: boolean) => void;
  onStats: (s: { visible: number; fps: number }) => void;
}

const DEG = Math.PI / 180;

/** Path (emitter-local) point → Pixi coordinates (y down). */
function pathToScreen(e: Emitter, x: number, y: number): [number, number] {
  const { rotation, scale, x: tx, y: ty } = e.transform;
  const c = Math.cos(rotation * DEG), s = Math.sin(rotation * DEG);
  return [tx + (x * c - y * s) * scale, -(ty + (x * s + y * c) * scale)];
}

/** World (y up) → path (emitter-local) coordinates. */
function worldToPath(e: Emitter, wx: number, wy: number): [number, number] {
  const { rotation, scale, x: tx, y: ty } = e.transform;
  const dx = (wx - tx) / scale, dy = (wy - ty) / scale;
  const c = Math.cos(-rotation * DEG), s = Math.sin(-rotation * DEG);
  return [dx * c - dy * s, dx * s + dy * c];
}
const BLEND = { normal: "normal", additive: "add", multiply: "multiply", screen: "screen" } as const;

export function Viewport(props: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const api = useRef<{ setBake: (b: BakeResult | null) => void; frame: () => void } | null>(null);

  useEffect(() => {
    let destroyed = false;
    const app = new Application();
    const cleanup: (() => void)[] = [];

    (async () => {
      await app.init({ resizeTo: host.current!, background: "#16181d", antialias: true, preference: "webgl", autoDensity: true, resolution: window.devicePixelRatio });
      if (destroyed) { app.destroy(true); return; }
      host.current!.appendChild(app.canvas);

      const world = new Container();
      const grid = new Graphics();
      const particles = new Container();
      const spineLayer = new Container();
      const handles = new Graphics();
      world.addChild(grid, particles, spineLayer, handles);
      app.stage.addChild(world);

      const cam = { x: 0, y: 40, zoom: 1 };
      const applyCam = () => {
        world.position.set(app.screen.width / 2 + cam.x, app.screen.height / 2 + cam.y);
        world.scale.set(cam.zoom);
        drawGrid();
      };

      const drawGrid = () => {
        grid.clear();
        if (!latest.current.showGrid) return;
        const step = cam.zoom < 0.5 ? 200 : cam.zoom < 2 ? 50 : 10;
        const ext = 4000;
        for (let v = -ext; v <= ext; v += step) {
          grid.moveTo(v, -ext).lineTo(v, ext);
          grid.moveTo(-ext, v).lineTo(ext, v);
        }
        grid.stroke({ width: 1 / cam.zoom, color: 0xffffff, alpha: 0.05 });
        grid.moveTo(-ext, 0).lineTo(ext, 0).stroke({ width: 1 / cam.zoom, color: 0xe05050, alpha: 0.35 });
        grid.moveTo(0, -ext).lineTo(0, ext).stroke({ width: 1 / cam.zoom, color: 0x50d070, alpha: 0.35 });
      };

      // --- simulation sprites (pooled per emitter)
      const pools: { container: Container; sprites: Sprite[] }[] = [];
      const pool = (i: number) => {
        while (pools.length <= i) {
          const c = new Container();
          particles.addChild(c);
          pools.push({ container: c, sprites: [] });
        }
        return pools[i];
      };

      // --- spine preview
      let spine: Spine | null = null;
      let spineTex: Texture | null = null;
      const setBake = (b: BakeResult | null) => {
        spine?.destroy();
        spineTex?.destroy(true);
        spine = null; spineTex = null;
        if (!b) return;
        try {
          const atlas = new TextureAtlas(b.atlas.text);
          spineTex = Texture.from(imageToCanvas(b.atlas.page));
          for (const page of atlas.pages) page.setTexture(SpineTexture.from(spineTex.source));
          const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(b.json);
          spine = new Spine({ skeletonData: data, autoUpdate: false });
          spine.state.setAnimation(0, data.animations[0].name, latest.current.effect.loop);
          spineLayer.addChild(spine);
        } catch (e) {
          console.error("Spine preview failed", e);
        }
      };

      const lerp = (a: PState, b: PState, k: number): PState => ({
        x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, rotation: a.rotation + (b.rotation - a.rotation) * k,
        size: a.size + (b.size - a.size) * k, sizeY: a.sizeY + (b.sizeY - a.sizeY) * k, r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: a.a + (b.a - a.a) * k,
      });

      let fpsAcc = 0, fpsFrames = 0, statT = 0, visibleCount = 0, gridShown = latest.current.showGrid;
      const frame = () => {
        const { sim, effect, mode, selected, showGrid } = latest.current;
        if (showGrid !== gridShown) { gridShown = showGrid; drawGrid(); }
        const length = sim.loop ? sim.frames / sim.fps : (sim.frames - 1) / sim.fps;
        const t = Math.min(playback.time, length);
        particles.visible = mode === "simulation";
        spineLayer.visible = mode === "spine";
        visibleCount = 0;

        if (mode === "simulation") {
          const ff = t * sim.fps;
          const f0 = Math.floor(ff), k = ff - f0;
          sim.emitters.forEach((track, ei) => {
            const p = pool(ei);
            const e = effect.emitters[ei];
            let n = 0;
            if (e?.enabled) {
              const tex = pixiTexture(e.texture);
              const texMax = Math.max(tex.width, tex.height);
              for (const part of track.particles) {
                const len = sim.loop ? Math.min(part.samples.length, sim.frames) : part.samples.length;
                const j = sim.loop ? (((f0 - part.startFrame) % sim.frames) + sim.frames) % sim.frames : f0 - part.startFrame;
                if (j < 0 || j >= len) continue;
                const s = j + 1 < len ? lerp(part.samples[j], part.samples[j + 1], k) : part.samples[j];
                let sp = p.sprites[n];
                if (!sp) { sp = new Sprite(); sp.anchor.set(0.5); p.container.addChild(sp); p.sprites.push(sp); }
                sp.texture = tex;
                sp.visible = true;
                sp.anchor.set(e.pivot[0], e.pivot[1]);
                sp.position.set(s.x, -s.y);
                sp.rotation = -s.rotation * DEG;
                sp.scale.set(s.size / texMax, s.sizeY / texMax);
                sp.tint = ((s.r * 255) << 16) | ((s.g * 255) << 8) | (s.b * 255);
                sp.alpha = s.a;
                sp.blendMode = BLEND[e.blend];
                n++;
              }
            }
            for (let i = n; i < p.sprites.length; i++) p.sprites[i].visible = false;
            visibleCount += n;
          });
          for (let i = sim.emitters.length; i < pools.length; i++) pools[i].sprites.forEach((s) => (s.visible = false));
        } else if (spine) {
          const entry = spine.state.tracks[0];
          if (entry) { entry.loop = effect.loop; entry.trackTime = t; }
          spine.update(0);
          visibleCount = spine.skeleton.slots.filter((s) => s.appliedPose.attachment).length;
        }

        // handles for the selected emitter
        handles.clear();
        const e = effect.emitters[selected];
        if (e) {
          const z = 1 / cam.zoom;
          const { rotation, scale } = e.transform;
          // motion path + control points
          if (e.motion.enabled) {
            const path = buildPath(e.motion).pts.map((p) => pathToScreen(e, p[0], p[1]));
            handles.poly(path.flat(), false).stroke({ width: 1.5 * z, color: 0xffb030, alpha: 0.6 });
            e.motion.points.forEach(([px, py]) => {
              const [hx, hy] = pathToScreen(e, px, py);
              handles.rect(hx - 5 * z, hy - 5 * z, 10 * z, 10 * z).fill({ color: 0xffb030 }).stroke({ width: 1.5 * z, color: 0x000000, alpha: 0.6 });
            });
          }
          const [ox, oy] = emitterOrigin(e, sim.period, t);
          const sx = ox, sy = -oy;
          const sh = e.shape;
          const col = 0x22b8cf;
          if (sh.type === "circle") handles.circle(sx, sy, sh.radius * scale).stroke({ width: 1.5 * z, color: col, alpha: 0.7 });
          if (sh.type === "rectangle" || sh.type === "line") {
            const w = sh.width * scale, h = sh.type === "line" ? 0 : sh.height * scale;
            const c = Math.cos(-rotation * DEG), s = Math.sin(-rotation * DEG);
            const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([px, py]) => [sx + px * c - py * s, sy + px * s + py * c]);
            handles.poly(pts.flat(), true).stroke({ width: 1.5 * z, color: col, alpha: 0.7 });
          }
          if (e.direction.mode === "angle") {
            const a = -(e.direction.angle + rotation) * DEG, L = 60 * z;
            handles.moveTo(sx, sy).lineTo(sx + Math.cos(a) * L, sy + Math.sin(a) * L).stroke({ width: 2 * z, color: 0xffb030 });
            for (const d of [-e.direction.spread / 2, e.direction.spread / 2]) {
              const b = a - d * DEG;
              handles.moveTo(sx, sy).lineTo(sx + Math.cos(b) * L * 0.8, sy + Math.sin(b) * L * 0.8).stroke({ width: 1 * z, color: 0xffb030, alpha: 0.5 });
            }
          }
          handles.circle(sx, sy, 6 * z).fill({ color: col }).stroke({ width: 2 * z, color: 0xffffff });
        }

        statT += app.ticker.deltaMS;
        fpsAcc += app.ticker.FPS; fpsFrames++;
        if (statT > 400) {
          latest.current.onStats({ visible: visibleCount, fps: Math.round(fpsAcc / fpsFrames) });
          statT = 0; fpsAcc = 0; fpsFrames = 0;
        }
      };

      app.ticker.add((tk) => {
        const { sim } = latest.current;
        const length = sim.loop ? sim.frames / sim.fps : (sim.frames - 1) / sim.fps;
        playback.tick(tk.deltaMS / 1000, length, sim.loop);
        frame();
      });

      // --- input: wheel zoom, right/middle drag pan, left drag moves the selected emitter
      const canvas = app.canvas;
      const toWorld = (cx: number, cy: number) => {
        const r = canvas.getBoundingClientRect();
        return { x: (cx - r.left - world.position.x) / cam.zoom, y: -((cy - r.top - world.position.y) / cam.zoom) };
      };
      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        const before = toWorld(ev.clientX, ev.clientY);
        cam.zoom = Math.min(8, Math.max(0.1, cam.zoom * Math.exp(-ev.deltaY * 0.0015)));
        applyCam();
        const after = toWorld(ev.clientX, ev.clientY);
        cam.x += (after.x - before.x) * cam.zoom;
        cam.y -= (after.y - before.y) * cam.zoom;
        applyCam();
      };
      let drag: { kind: "pan" | "emitter" | "point"; sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; point?: number } | null = null;
      const onDown = (ev: PointerEvent) => {
        const { effect, selected, sim } = latest.current;
        const e = effect.emitters[selected];
        if (ev.button === 0 && e) {
          const w = toWorld(ev.clientX, ev.clientY);
          // path points take priority over the emitter handle
          if (e.motion.enabled) {
            const hit = e.motion.points.findIndex(([px, py]) => {
              const [hx, hy] = pathToScreen(e, px, py);
              return Math.hypot(w.x - hx, -w.y - hy) * cam.zoom < 10;
            });
            if (hit >= 0) {
              drag = { kind: "point", point: hit, sx: ev.clientX, sy: ev.clientY, cx: 0, cy: 0, ex: 0, ey: 0 };
              canvas.setPointerCapture(ev.pointerId);
              return;
            }
          }
          const [ox, oy] = emitterOrigin(e, sim.period, Math.min(playback.time, sim.period));
          const near = Math.hypot(w.x - ox, w.y - oy) * cam.zoom < 14;
          if (near || ev.altKey) {
            drag = { kind: "emitter", sx: ev.clientX, sy: ev.clientY, cx: 0, cy: 0, ex: e.transform.x, ey: e.transform.y };
            if (!near) { drag.ex = w.x; drag.ey = w.y; latest.current.onMoveEmitter(selected, Math.round(w.x), Math.round(w.y), false); }
          }
        } else if (ev.button === 1 || ev.button === 2) {
          drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, cx: cam.x, cy: cam.y, ex: 0, ey: 0 };
        }
        if (drag) canvas.setPointerCapture(ev.pointerId);
      };
      const onMove = (ev: PointerEvent) => {
        if (!drag) return;
        const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
        if (drag.kind === "pan") { cam.x = drag.cx + dx; cam.y = drag.cy + dy; applyCam(); }
        else if (drag.kind === "point") {
          const e = latest.current.effect.emitters[latest.current.selected];
          const w = toWorld(ev.clientX, ev.clientY);
          const [px, py] = worldToPath(e, w.x, w.y);
          latest.current.onMovePathPoint(latest.current.selected, drag.point!, Math.round(px), Math.round(py), false);
        }
        else latest.current.onMoveEmitter(latest.current.selected, Math.round(drag.ex + dx / cam.zoom), Math.round(drag.ey - dy / cam.zoom), false);
      };
      const onUp = (ev: PointerEvent) => {
        if (drag?.kind === "emitter") latest.current.onMoveEmitter(latest.current.selected, NaN, NaN, true);
        if (drag?.kind === "point") latest.current.onMovePathPoint(latest.current.selected, drag.point!, NaN, NaN, true);
        drag = null;
        canvas.releasePointerCapture?.(ev.pointerId);
      };
      const noMenu = (ev: Event) => ev.preventDefault();
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("contextmenu", noMenu);
      const ro = new ResizeObserver(() => { app.resize(); applyCam(); });
      ro.observe(host.current!);
      cleanup.push(() => ro.disconnect());

      api.current = {
        setBake,
        frame: () => {
          // fit view to the simulation bounds
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const t of latest.current.sim.emitters) for (const p of t.particles) for (const s of p.samples) {
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
          }
          if (!isFinite(minX)) { cam.x = 0; cam.y = 0; cam.zoom = 1; applyCam(); return; }
          const w = Math.max(maxX - minX, 50) * 1.3, h = Math.max(maxY - minY, 50) * 1.3;
          cam.zoom = Math.min(4, app.screen.width / w, app.screen.height / h);
          cam.x = -((minX + maxX) / 2) * cam.zoom;
          cam.y = ((minY + maxY) / 2) * cam.zoom;
          applyCam();
        },
      };
      applyCam();
      setBake(latest.current.bake);
      (window as any).__spinemagic = { app, cam, applyCam };
    })();

    return () => {
      destroyed = true;
      cleanup.forEach((f) => f());
      api.current = null;
      try { app.destroy(true, { children: true }); } catch { /* not initialised yet */ }
    };
  }, []);

  useEffect(() => { api.current?.setBake(props.bake); }, [props.bake]);

  return (
    <div className="viewport" ref={host}>
      <button className="vp-fit" title="Frame effect (F)" onClick={() => api.current?.frame()}>⤢</button>
    </div>
  );
}
