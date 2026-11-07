import { useEffect, useRef } from "react";
import { Application, Container, Graphics, MeshSimple, Sprite, Texture } from "pixi.js";
import { ribbonTopology, ribbonVertices } from "@core/ribbon";
import { hexToRgb } from "@core/math";
import { Spine, SpineTexture, TextureAtlas, AtlasAttachmentLoader, SkeletonJson } from "@esotericsoftware/spine-pixi-v8";
import { emitterSprites, type Effect } from "@core/schema";
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
  /** Drag of a direction / spread / shape / rotation handle: a partial emitter patch (done = drag ended). */
  onHandle: (index: number, patch: Record<string, unknown>, done: boolean) => void;
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

type HandleKind = "direction" | "spreadA" | "spreadB" | "radius" | "size" | "rotation";
const HANDLE_COLOR: Record<HandleKind, number> = { direction: 0xffb030, spreadA: 0xffb030, spreadB: 0xffb030, radius: 0x22b8cf, size: 0x22b8cf, rotation: 0xc070ff };

/**
 * Draggable handles of an emitter, in world coordinates (y up), with what dragging each one to `w` changes.
 * `o` is the emitter origin at the current time; `z` = 1 / zoom so handles keep their on-screen size.
 */
function emitterHandles(e: Emitter, o: [number, number], z: number) {
  const { rotation, scale } = e.transform;
  const out: { kind: HandleKind; x: number; y: number; patch: (wx: number, wy: number) => Record<string, unknown> }[] = [];
  const at = (deg: number, r: number): [number, number] => [o[0] + Math.cos(deg * DEG) * r, o[1] + Math.sin(deg * DEG) * r];
  const angleTo = (wx: number, wy: number) => Math.atan2(wy - o[1], wx - o[0]) / DEG;
  const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
  const round1 = (v: number) => Math.round(v * 10) / 10;
  if (e.direction.mode === "angle") {
    const dir = e.direction.angle + rotation;
    out.push({ kind: "direction", ...xy(at(dir, 60 * z)), patch: (wx, wy) => ({ direction: { angle: Math.round(wrap(angleTo(wx, wy) - rotation)) } }) });
    for (const [kind, sign] of [["spreadA", 1], ["spreadB", -1]] as const) {
      out.push({
        kind, ...xy(at(dir + (sign * e.direction.spread) / 2, 48 * z)),
        patch: (wx, wy) => ({ direction: { spread: Math.round(Math.min(360, Math.abs(wrap(angleTo(wx, wy) - dir)) * 2)) } }),
      });
    }
  }
  const s = e.shape;
  if (s.type === "circle") {
    out.push({ kind: "radius", ...xy(at(rotation, Math.max(s.radius * scale, 12 * z))), patch: (wx, wy) => ({ shape: { radius: Math.round(Math.hypot(wx - o[0], wy - o[1]) / scale) } }) });
  } else if (s.type === "rectangle" || s.type === "line") {
    const c = Math.cos(rotation * DEG), sn = Math.sin(rotation * DEG);
    const hx = (s.width * scale) / 2, hy = s.type === "line" ? 0 : (s.height * scale) / 2;
    out.push({
      kind: "size", x: o[0] + hx * c - hy * sn, y: o[1] + hx * sn + hy * c,
      patch: (wx, wy) => {
        // into emitter axes: half extents → full size
        const dx = wx - o[0], dy = wy - o[1];
        const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
        return { shape: { width: Math.round(Math.abs(lx) * 2 / scale), ...(s.type === "rectangle" ? { height: Math.round(Math.abs(ly) * 2 / scale) } : {}) } };
      },
    });
  }
  // emitter rotation: a knob on a ring, opposite the direction arrow so they never overlap
  out.push({ kind: "rotation", ...xy(at(rotation + 180, 34 * z)), patch: (wx, wy) => ({ transform: { rotation: round1(wrap(angleTo(wx, wy) - 180)) } }) });
  return out;
}
const xy = (p: [number, number]) => ({ x: p[0], y: p[1] });

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

      // current pointer drag (declared early: the frame loop highlights the dragged handle)
      let drag: { kind: "pan" | "emitter" | "point" | "handle"; sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; point?: number; handle?: HandleKind } | null = null;

      // --- simulation sprites (pooled per emitter)
      const pools: { container: Container; sprites: Sprite[]; ribbon: MeshSimple | null; ribbonKey: string }[] = [];
      const pool = (i: number) => {
        while (pools.length <= i) {
          const c = new Container();
          particles.addChild(c);
          pools.push({ container: c, sprites: [], ribbon: null, ribbonKey: "" });
        }
        return pools[i];
      };
      /** ribbon mesh for an emitter, rebuilt when its texture or resolution changes; hidden when off */
      const drawRibbon = (p: (typeof pools)[number], e: Emitter | undefined, period: number, t: number, loop: boolean) => {
        if (!e?.enabled || !e.ribbon.enabled) { if (p.ribbon) p.ribbon.visible = false; return; }
        const key = `${e.ribbon.texture}/${e.ribbon.segments}`;
        if (!p.ribbon || p.ribbonKey !== key) {
          p.ribbon?.destroy();
          const topo = ribbonTopology(e.ribbon.segments);
          p.ribbon = new MeshSimple({ texture: pixiTexture(e.ribbon.texture), vertices: new Float32Array(topo.uvs.length), uvs: new Float32Array(topo.uvs), indices: new Uint32Array(topo.triangles) });
          p.ribbonKey = key;
          p.container.addChildAt(p.ribbon, 0); // under the particles
        }
        const v = ribbonVertices(e, period, t, loop);
        const out = p.ribbon.vertices as Float32Array;
        for (let k = 0; k < v.length; k += 2) { out[k] = v[k]; out[k + 1] = -v[k + 1]; }
        p.ribbon.vertices = out;
        const [r, g, b] = hexToRgb(e.ribbon.color);
        p.ribbon.tint = ((r * 255) << 16) | ((g * 255) << 8) | (b * 255);
        p.ribbon.alpha = e.ribbon.alpha;
        p.ribbon.blendMode = BLEND[e.blend];
        p.ribbon.visible = true;
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
        size: a.size + (b.size - a.size) * k, sizeY: a.sizeY + (b.sizeY - a.sizeY) * k, r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: a.a + (b.a - a.a) * k, frame: a.frame,
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
            drawRibbon(p, e, sim.period, t, sim.loop);
            let n = 0;
            if (e?.enabled) {
              const texs = emitterSprites(e).map(pixiTexture);
              for (const part of track.particles) {
                const len = sim.loop ? Math.min(part.samples.length, sim.frames) : part.samples.length;
                const j = sim.loop ? (((f0 - part.startFrame) % sim.frames) + sim.frames) % sim.frames : f0 - part.startFrame;
                if (j < 0 || j >= len) continue;
                const s = j + 1 < len ? lerp(part.samples[j], part.samples[j + 1], k) : part.samples[j];
                let sp = p.sprites[n];
                if (!sp) { sp = new Sprite(); sp.anchor.set(0.5); p.container.addChild(sp); p.sprites.push(sp); }
                const tex = texs[part.samples[j].frame] ?? texs[0];
                const texMax = Math.max(tex.width, tex.height);
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
          for (let i = sim.emitters.length; i < pools.length; i++) { pools[i].sprites.forEach((s) => (s.visible = false)); if (pools[i].ribbon) pools[i].ribbon!.visible = false; }
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
          handles.circle(sx, sy, 34 * z).stroke({ width: 1 * z, color: HANDLE_COLOR.rotation, alpha: 0.35 });
          for (const h of emitterHandles(e, [ox, oy], z)) {
            const hot = drag?.kind === "handle" && drag.handle === h.kind;
            handles.circle(h.x, -h.y, (hot ? 6 : 4.5) * z).fill({ color: HANDLE_COLOR[h.kind] }).stroke({ width: 1.5 * z, color: 0x000000, alpha: 0.7 });
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
      const onDown = (ev: PointerEvent) => {
        const { effect, selected, sim } = latest.current;
        const e = effect.emitters[selected];
        if (ev.button === 0 && e) {
          const w = toWorld(ev.clientX, ev.clientY);
          // direction / spread / shape / rotation knobs first: they are small and sit on top
          const origin = emitterOrigin(e, sim.period, Math.min(playback.time, sim.period));
          const knob = emitterHandles(e, origin, 1 / cam.zoom).find((h) => Math.hypot(w.x - h.x, w.y - h.y) * cam.zoom < 8);
          if (knob) {
            drag = { kind: "handle", handle: knob.kind, sx: ev.clientX, sy: ev.clientY, cx: 0, cy: 0, ex: origin[0], ey: origin[1] };
            canvas.setPointerCapture(ev.pointerId);
            return;
          }
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
        else if (drag.kind === "handle") {
          const { effect, selected } = latest.current;
          const e = effect.emitters[selected];
          // the origin is frozen at drag start so a moving emitter doesn't fight the drag
          const h = e && emitterHandles(e, [drag.ex, drag.ey], 1 / cam.zoom).find((k) => k.kind === drag!.handle);
          if (h) { const w = toWorld(ev.clientX, ev.clientY); latest.current.onHandle(selected, h.patch(w.x, w.y), false); }
        }
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
        if (drag?.kind === "handle") latest.current.onHandle(latest.current.selected, {}, true);
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
