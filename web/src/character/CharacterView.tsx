import { useEffect, useRef } from "react";
import type { MergeResult } from "@core/character";
import { playback } from "../playback";
import { makeAtlas, poser, readSkeleton, type SpineRuntime } from "./runtime";

export interface CharacterViewProps {
  rt: SpineRuntime;
  merged: MergeResult;
  /** character atlas pages, by page file name */
  pages: Map<string, ImageBitmap>;
  animation: string;
  duration: number;
  bone: string;
  showBones: boolean;
  onStats: (s: { visible: number; fps: number }) => void;
}

/**
 * Draws the merged character + effect with the character's own Spine runtime (what you see is what gets exported).
 * Wheel zooms, right/middle-drag pans, F frames the skeleton.
 */
export function CharacterView(props: CharacterViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const scene = useRef<{ setMerged: (m: MergeResult) => Promise<void>; fit: () => void } | null>(null);

  useEffect(() => {
    const { rt } = props;
    const cv = canvas.current!;
    const ctx = new rt.webgl.ManagedWebGLRenderingContext(cv, { alpha: false });
    const renderer = new rt.webgl.SceneRenderer(cv, ctx, true);
    // the "#" overlay shows the rig only, not every attachment outline
    Object.assign(renderer.skeletonDebugRenderer, { drawRegionAttachments: false, drawMeshHull: false, drawMeshTriangles: false, drawBoundingBoxes: false, drawPaths: false, drawClipping: false });
    const gl: WebGLRenderingContext = ctx.gl;
    const cam = { x: 0, y: 100, zoom: 1 };
    let rig: { skeleton: any; pose: (a: string, t: number) => void } | null = null;
    let textures: any[] = [];
    let fxBones: string[] = [];
    let raf = 0, last = performance.now(), statT = 0, frames = 0, disposed = false;

    const setMerged = async (m: MergeResult) => {
      const fxPage = await createImageBitmap(new ImageData(new Uint8ClampedArray(m.page.image.data), m.page.image.width, m.page.image.height), { premultiplyAlpha: "none" });
      if (disposed) return;
      const byName = new Map(latest.current.pages);
      byName.set(m.page.name, fxPage);
      const made = new Map<string, any>();
      const texFor = (page: string) => {
        let t = made.get(page);
        if (!t) {
          const img = byName.get(page);
          if (!img) throw new Error(`atlas page "${page}" was not uploaded with the character`);
          t = new rt.webgl.GLTexture(ctx, img);
          made.set(page, t);
        }
        return t;
      };
      const atlas = makeAtlas(rt, m.atlasText, texFor);
      const data = readSkeleton(rt, m.json, atlas);
      textures.forEach((t) => t.dispose());
      textures = [...made.values()];
      rig = poser(rt, data);
      fxBones = data.bones.map((b: any) => b.name).filter((n: string) => n.startsWith("fx_") && !n.endsWith("__anchor"));
    };

    const fit = () => {
      if (!rig) return;
      const { animation } = latest.current;
      rig.pose(animation, 0);
      const off = new rt.core.Vector2(), size = new rt.core.Vector2();
      rig.skeleton.getBounds(off, size, []);
      if (!Number.isFinite(off.x) || size.x <= 0) return;
      cam.x = off.x + size.x / 2; cam.y = off.y + size.y / 2;
      // measure the host, not the canvas: the canvas is only resized on the next frame
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, host.current!.clientWidth * dpr), h = Math.max(1, host.current!.clientHeight * dpr);
      cam.zoom = Math.max(size.x / w, size.y / h) * 1.8;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const p = latest.current;
      playback.tick(dt, p.duration, true);
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(host.current!.clientWidth * dpr), h = Math.round(host.current!.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.086, 0.094, 0.114, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!rig) return;
      rig.pose(p.animation, Math.min(playback.time, p.duration));
      renderer.camera.position.x = cam.x;
      renderer.camera.position.y = cam.y;
      renderer.camera.zoom = cam.zoom;
      renderer.camera.setViewport(w, h);
      renderer.begin();
      renderer.drawSkeleton(rig.skeleton, p.merged.premultiplied);
      // character bones only: particle lanes would bury the rig in debug circles
      if (p.showBones) renderer.drawSkeletonDebug(rig.skeleton, p.merged.premultiplied, fxBones);
      const b = rig.skeleton.findBone(p.bone);
      if (b) {
        const col = new rt.core.Color(0.13, 0.72, 0.81, 1);
        renderer.circle(false, b.worldX, b.worldY, 8 * cam.zoom, col, 24);
        renderer.circle(true, b.worldX, b.worldY, 3 * cam.zoom, col, 12);
      }
      renderer.end();
      statT += dt; frames++;
      if (statT > 0.4) {
        const visible = rig.skeleton.slots.filter((s: any) => s.data.name.startsWith("fx_") && s.getAttachment()).length;
        p.onStats({ visible, fps: Math.round(frames / statT) });
        statT = 0; frames = 0;
      }
    };
    raf = requestAnimationFrame(draw);

    // input
    const onWheel = (ev: WheelEvent) => { ev.preventDefault(); cam.zoom = Math.min(20, Math.max(0.05, cam.zoom * Math.exp(ev.deltaY * 0.0015))); };
    let drag: { x: number; y: number; cx: number; cy: number } | null = null;
    const onDown = (ev: PointerEvent) => { if (ev.button === 1 || ev.button === 2) { drag = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y }; cv.setPointerCapture(ev.pointerId); } };
    const onMove = (ev: PointerEvent) => {
      if (!drag) return;
      const dpr = window.devicePixelRatio || 1;
      cam.x = drag.cx - (ev.clientX - drag.x) * dpr * cam.zoom;
      cam.y = drag.cy + (ev.clientY - drag.y) * dpr * cam.zoom;
    };
    const onUp = () => { drag = null; };
    const noMenu = (e: Event) => e.preventDefault();
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("contextmenu", noMenu);

    scene.current = { setMerged, fit };
    setMerged(latest.current.merged).then(fit).catch((e) => console.error("character preview", e));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      textures.forEach((t) => t.dispose());
      renderer.dispose?.();
      scene.current = null;
    };
  }, [props.rt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scene.current?.setMerged(props.merged).catch((e) => console.error("character preview", e)); }, [props.merged]);

  return (
    <div className="viewport" ref={host}>
      <canvas ref={canvas} className="character-canvas" />
      <button className="vp-fit" title="Frame character (F)" onClick={() => scene.current?.fit()}>⤢</button>
    </div>
  );
}
