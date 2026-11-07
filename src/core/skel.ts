// Binary .skel → Spine JSON, so characters exported as binary can be inspected and merged.
// Ported from the official spine-ts SkeletonBinary readers (3.8 and 4.2); instead of runtime objects it emits the
// equivalent JSON document, which the official SkeletonJson reader loads to the same skeleton.
// Browser-safe (no Node APIs).
//
// License: this file is a derivative work of the Spine Runtimes (Copyright (c) 2013-2021, Esoteric Software LLC)
// and is distributed under the Spine Runtimes License Agreement (https://esotericsoftware.com/spine-runtimes-license),
// not the MIT License of the rest of SpineMagic. Each user must obtain their own Spine Editor license.

export class BinaryInput {
  strings: string[] = [];
  index = 0;
  private view: DataView;
  constructor(data: Uint8Array) { this.view = new DataView(data.buffer, data.byteOffset, data.byteLength); }
  get remaining() { return this.view.byteLength - this.index; }
  readByte() { return this.view.getInt8(this.index++); }
  readUnsignedByte() { return this.view.getUint8(this.index++); }
  readInt32() { const v = this.view.getInt32(this.index); this.index += 4; return v; }
  readFloat() { const v = this.view.getFloat32(this.index); this.index += 4; return v; }
  readBoolean() { return this.readByte() !== 0; }
  readInt(optimizePositive: boolean) {
    let b = this.readByte();
    let result = b & 0x7f;
    if (b & 0x80) {
      b = this.readByte(); result |= (b & 0x7f) << 7;
      if (b & 0x80) {
        b = this.readByte(); result |= (b & 0x7f) << 14;
        if (b & 0x80) {
          b = this.readByte(); result |= (b & 0x7f) << 21;
          if (b & 0x80) { b = this.readByte(); result |= (b & 0x7f) << 28; }
        }
      }
    }
    return optimizePositive ? result : (result >>> 1) ^ -(result & 1);
  }
  readStringRef(): string | null { const i = this.readInt(true); return i === 0 ? null : this.strings[i - 1]; }
  readString(): string | null {
    let byteCount = this.readInt(true);
    if (byteCount === 0) return null;
    if (byteCount === 1) return "";
    byteCount--;
    let chars = "";
    for (let i = 0; i < byteCount;) {
      const b = this.readUnsignedByte();
      switch (b >> 4) {
        case 12: case 13: chars += String.fromCharCode(((b & 0x1f) << 6) | (this.readByte() & 0x3f)); i += 2; break;
        case 14: chars += String.fromCharCode(((b & 0x0f) << 12) | ((this.readByte() & 0x3f) << 6) | (this.readByte() & 0x3f)); i += 3; break;
        default: chars += String.fromCharCode(b); i++;
      }
    }
    return chars;
  }
}

/** Reads the editor version stored in a .skel without parsing the rest. */
export function skelVersion(bytes: Uint8Array): string {
  const looks = (s: string | null) => !!s && /^\d+\.\d+(\.\d+)?/.test(s);
  // 4.x: two int32 hash words, then the version string
  try { const a = new BinaryInput(bytes); a.readInt32(); a.readInt32(); const v = a.readString(); if (looks(v)) return v!; } catch { /* fall through */ }
  // 3.8: hash string, then the version string
  try { const b = new BinaryInput(bytes); b.readString(); const v = b.readString(); if (looks(v)) return v!; } catch { /* fall through */ }
  throw new Error("not a Spine binary skeleton (.skel): no version string found");
}

/** Converts a binary skeleton to the JSON document Spine would have exported. Supports 3.8 and 4.2. */
export function skelToJson(bytes: Uint8Array): any {
  const version = skelVersion(bytes);
  const mm = version.split(".").slice(0, 2).join(".");
  if (mm === "4.2") return read42(bytes);
  if (mm === "3.8") return read38(bytes);
  throw new Error(`binary .skel ${version} is not supported yet (3.8 and 4.2 are) — export JSON from Spine instead`);
}

// ---------------------------------------------------------------------------------------------------------------
// shared helpers

const hex8 = (rgba8888: number) => (rgba8888 >>> 0).toString(16).padStart(8, "0");
const hex6 = (rgb888: number) => (rgb888 >>> 0 & 0xffffff).toString(16).padStart(6, "0");
const byteHex = (...v: number[]) => v.map((b) => b.toString(16).padStart(2, "0")).join("");
const BLEND = ["normal", "additive", "multiply", "screen"];
const INHERIT = ["normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"];
const POSITION = ["fixed", "percent"];
const SPACING = ["length", "fixed", "percent", "proportional"];
const ROTATE = ["tangent", "chain", "chainScale"];
const SEQUENCE_MODE = ["hold", "once", "loop", "pingpong", "onceReverse", "loopReverse", "pingpongReverse"];

function floats(input: BinaryInput, n: number): number[] { const a = new Array<number>(n); for (let i = 0; i < n; i++) a[i] = input.readFloat(); return a; }
function shorts(input: BinaryInput, n: number): number[] { const a = new Array<number>(n); for (let i = 0; i < n; i++) a[i] = input.readInt(true); return a; }

/** JSON vertex list: plain [x, y, ...] or weighted [boneCount, bone, x, y, w, ...]. */
function readVertices(input: BinaryInput, vertexCount: number, weighted: boolean): { vertices: number[]; weighted: boolean } {
  if (!weighted) return { vertices: floats(input, vertexCount << 1), weighted: false };
  const out: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const boneCount = input.readInt(true);
    out.push(boneCount);
    for (let k = 0; k < boneCount; k++) out.push(input.readInt(true), input.readFloat(), input.readFloat(), input.readFloat());
  }
  return { vertices: out, weighted: true };
}

/** Puts a key's curve: "stepped", or 4 numbers per value appended to `curve`. */
type Key = Record<string, any>;
function bezier(input: BinaryInput, key: Key) { (key.curve ??= []).push(input.readFloat(), input.readFloat(), input.readFloat(), input.readFloat()); }

// ---------------------------------------------------------------------------------------------------------------
// 4.2

function read42(bytes: Uint8Array): any {
  const input = new BinaryInput(bytes);
  const low = input.readInt32(), high = input.readInt32();
  const skeleton: Key = {};
  if (low !== 0 || high !== 0) skeleton.hash = (high >>> 0).toString(16) + (low >>> 0).toString(16);
  skeleton.spine = input.readString();
  skeleton.x = input.readFloat(); skeleton.y = input.readFloat(); skeleton.width = input.readFloat(); skeleton.height = input.readFloat();
  skeleton.referenceScale = input.readFloat();
  const nonessential = input.readBoolean();
  if (nonessential) { skeleton.fps = input.readFloat(); skeleton.images = input.readString() ?? ""; skeleton.audio = input.readString() ?? ""; }

  for (let i = 0, n = input.readInt(true); i < n; i++) input.strings.push(input.readString()!);

  const bones: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const b: Key = { name: input.readString() };
    if (i > 0) b.parent = bones[input.readInt(true)].name;
    b.rotation = input.readFloat(); b.x = input.readFloat(); b.y = input.readFloat();
    b.scaleX = input.readFloat(); b.scaleY = input.readFloat(); b.shearX = input.readFloat(); b.shearY = input.readFloat();
    b.length = input.readFloat();
    b.inherit = INHERIT[input.readByte()];
    b.skin = input.readBoolean();
    if (nonessential) {
      b.color = hex8(input.readInt32());
      const icon = input.readString(); if (icon) b.icon = icon;
      b.visible = input.readBoolean();
    }
    bones.push(b);
  }

  const slots: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const s: Key = { name: input.readString(), bone: bones[input.readInt(true)].name, color: hex8(input.readInt32()) };
    const dark = input.readInt32();
    if (dark !== -1) s.dark = hex6(dark);
    const att = input.readStringRef(); if (att) s.attachment = att;
    s.blend = BLEND[input.readInt(true)];
    if (nonessential) s.visible = input.readBoolean();
    slots.push(s);
  }

  const ik: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const c: Key = { name: input.readString(), order: input.readInt(true) };
    c.bones = shorts(input, input.readInt(true)).map((k) => bones[k].name);
    c.target = bones[input.readInt(true)].name;
    const f = input.readByte();
    c.skin = (f & 1) !== 0; c.bendPositive = (f & 2) !== 0; c.compress = (f & 4) !== 0; c.stretch = (f & 8) !== 0; c.uniform = (f & 16) !== 0;
    c.mix = (f & 32) !== 0 ? ((f & 64) !== 0 ? input.readFloat() : 1) : 0;
    if (f & 128) c.softness = input.readFloat();
    ik.push(c);
  }

  const transform: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const c: Key = { name: input.readString(), order: input.readInt(true) };
    c.bones = shorts(input, input.readInt(true)).map((k) => bones[k].name);
    c.target = bones[input.readInt(true)].name;
    let f = input.readByte();
    c.skin = (f & 1) !== 0; c.local = (f & 2) !== 0; c.relative = (f & 4) !== 0;
    c.rotation = f & 8 ? input.readFloat() : 0;
    c.x = f & 16 ? input.readFloat() : 0;
    c.y = f & 32 ? input.readFloat() : 0;
    c.scaleX = f & 64 ? input.readFloat() : 0;
    c.scaleY = f & 128 ? input.readFloat() : 0;
    f = input.readByte();
    c.shearY = f & 1 ? input.readFloat() : 0;
    c.mixRotate = f & 2 ? input.readFloat() : 0;
    c.mixX = f & 4 ? input.readFloat() : 0;
    c.mixY = f & 8 ? input.readFloat() : 0;
    c.mixScaleX = f & 16 ? input.readFloat() : 0;
    c.mixScaleY = f & 32 ? input.readFloat() : 0;
    c.mixShearY = f & 64 ? input.readFloat() : 0;
    transform.push(c);
  }

  const path: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const c: Key = { name: input.readString(), order: input.readInt(true), skin: input.readBoolean() };
    c.bones = shorts(input, input.readInt(true)).map((k) => bones[k].name);
    c.target = slots[input.readInt(true)].name;
    const f = input.readByte();
    c.positionMode = POSITION[f & 1]; c.spacingMode = SPACING[(f >> 1) & 3]; c.rotateMode = ROTATE[(f >> 3) & 3];
    c.rotation = f & 128 ? input.readFloat() : 0;
    c.position = input.readFloat(); c.spacing = input.readFloat();
    c.mixRotate = input.readFloat(); c.mixX = input.readFloat(); c.mixY = input.readFloat();
    path.push(c);
  }

  const physics: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const c: Key = { name: input.readString(), order: input.readInt(true), bone: bones[input.readInt(true)].name };
    let f = input.readByte();
    c.skin = (f & 1) !== 0;
    c.x = f & 2 ? input.readFloat() : 0;
    c.y = f & 4 ? input.readFloat() : 0;
    c.rotate = f & 8 ? input.readFloat() : 0;
    c.scaleX = f & 16 ? input.readFloat() : 0;
    c.shearX = f & 32 ? input.readFloat() : 0;
    c.limit = f & 64 ? input.readFloat() : 5000;
    c.fps = input.readUnsignedByte();
    c.inertia = input.readFloat(); c.strength = input.readFloat(); c.damping = input.readFloat();
    c.mass = 1 / (f & 128 ? input.readFloat() : 1);
    c.wind = input.readFloat(); c.gravity = input.readFloat();
    f = input.readByte();
    c.inertiaGlobal = (f & 1) !== 0; c.strengthGlobal = (f & 2) !== 0; c.dampingGlobal = (f & 4) !== 0; c.massGlobal = (f & 8) !== 0;
    c.windGlobal = (f & 16) !== 0; c.gravityGlobal = (f & 32) !== 0; c.mixGlobal = (f & 64) !== 0;
    c.mix = f & 128 ? input.readFloat() : 1;
    physics.push(c);
  }

  // skins; vertex info is kept per (skin, slot, attachment) for deform timelines
  const skins: Key[] = [];
  const vertexInfo = new Map<string, { weighted: boolean; vertices: number[] }>();
  const readSkin42 = (isDefault: boolean): Key | null => {
    let slotCount: number;
    const skin: Key = {};
    if (isDefault) {
      slotCount = input.readInt(true);
      if (slotCount === 0) return null;
      skin.name = "default";
    } else {
      skin.name = input.readString();
      if (nonessential) skin.color = hex8(input.readInt32());
      const sb = shorts(input, input.readInt(true)).map((k) => bones[k].name); if (sb.length) skin.bones = sb;
      const si = shorts(input, input.readInt(true)).map((k) => ik[k].name); if (si.length) skin.ik = si;
      const st = shorts(input, input.readInt(true)).map((k) => transform[k].name); if (st.length) skin.transform = st;
      const sp = shorts(input, input.readInt(true)).map((k) => path[k].name); if (sp.length) skin.path = sp;
      const sh = shorts(input, input.readInt(true)).map((k) => physics[k].name); if (sh.length) skin.physics = sh;
      slotCount = input.readInt(true);
    }
    const attachments: Key = {};
    const skinIndex = skins.length;
    for (let i = 0; i < slotCount; i++) {
      const slotIndex = input.readInt(true);
      const slotName = slots[slotIndex].name;
      const map: Key = (attachments[slotName] ??= {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const key = input.readStringRef()!;
        const a = readAttachment42(input, key, nonessential, slots);
        map[key] = a.json;
        if (a.vertices) vertexInfo.set(`${skinIndex}/${slotIndex}/${key}`, a.vertices);
      }
    }
    skin.attachments = attachments;
    return skin;
  };
  const def = readSkin42(true);
  if (def) skins.push(def);
  for (let i = 0, n = input.readInt(true); i < n; i++) skins.push(readSkin42(false)!);
  // linked meshes name their parent's skin by index; skins later in the file aren't known while reading
  for (const s of skins) for (const slot of Object.values<Key>(s.attachments)) for (const a of Object.values<Key>(slot)) {
    if (a.type === "linkedmesh" && typeof a.skin === "number") a.skin = skins[a.skin].name;
  }
  // a linked mesh's deform keys use its parent's vertices
  for (const [si, s] of skins.entries()) for (const [slotName, slot] of Object.entries<Key>(s.attachments)) for (const [key, a] of Object.entries<Key>(slot)) {
    if (a.type !== "linkedmesh") continue;
    const slotIndex = slots.findIndex((x) => x.name === slotName);
    const parentSkin = skins.findIndex((x) => x.name === (a.skin ?? "default"));
    const v = vertexInfo.get(`${parentSkin}/${slotIndex}/${a.parent}`);
    if (v) vertexInfo.set(`${si}/${slotIndex}/${key}`, v);
  }

  const events: Key = {};
  const eventList: { name: string; audio: string | null }[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const name = input.readString()!;
    const e: Key = { int: input.readInt(false), float: input.readFloat(), string: input.readString() ?? "" };
    const audio = input.readString();
    if (audio) { e.audio = audio; e.volume = input.readFloat(); e.balance = input.readFloat(); }
    events[name] = e;
    eventList.push({ name, audio });
  }

  const animations: Key = {};
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const name = input.readString()!;
    animations[name] = readAnimation42(input, { bones, slots, ik, transform, path, physics, skins, vertexInfo, eventList });
  }

  const json: Key = { skeleton, bones, slots };
  if (ik.length) json.ik = ik;
  if (transform.length) json.transform = transform;
  if (path.length) json.path = path;
  if (physics.length) json.physics = physics;
  json.skins = skins;
  if (eventList.length) json.events = events;
  json.animations = animations;
  return json;
}

function readSequence(input: BinaryInput): Key {
  return { count: input.readInt(true), start: input.readInt(true), digits: input.readInt(true), setup: input.readInt(true) };
}

function readAttachment42(input: BinaryInput, key: string, nonessential: boolean, slots: Key[]):{ json: Key; vertices?: { weighted: boolean; vertices: number[] } } {
  const f = input.readByte();
  const name = f & 8 ? input.readStringRef()! : key;
  const a: Key = {};
  if (name !== key) a.name = name;
  switch (f & 0b111) {
    case 0: { // region
      a.type = "region";
      if (f & 16) a.path = input.readStringRef();
      if (f & 32) a.color = hex8(input.readInt32());
      if (f & 64) a.sequence = readSequence(input);
      a.rotation = f & 128 ? input.readFloat() : 0;
      a.x = input.readFloat(); a.y = input.readFloat(); a.scaleX = input.readFloat(); a.scaleY = input.readFloat();
      a.width = input.readFloat(); a.height = input.readFloat();
      return { json: a };
    }
    case 1: { // bounding box
      a.type = "boundingbox";
      const count = input.readInt(true);
      const v = readVertices(input, count, (f & 16) !== 0);
      a.vertexCount = count; a.vertices = v.vertices;
      if (nonessential) a.color = hex8(input.readInt32());
      return { json: a, vertices: v };
    }
    case 2: { // mesh
      a.type = "mesh";
      if (f & 16) a.path = input.readStringRef();
      if (f & 32) a.color = hex8(input.readInt32());
      if (f & 64) a.sequence = readSequence(input);
      a.hull = input.readInt(true);
      const count = input.readInt(true);
      const v = readVertices(input, count, (f & 128) !== 0);
      a.vertices = v.vertices;
      a.uvs = floats(input, count << 1);
      a.triangles = shorts(input, ((count << 1) - a.hull - 2) * 3);
      if (nonessential) { a.edges = shorts(input, input.readInt(true)); a.width = input.readFloat(); a.height = input.readFloat(); }
      return { json: a, vertices: v };
    }
    case 3: { // linked mesh
      a.type = "linkedmesh";
      if (f & 16) a.path = input.readStringRef();
      if (f & 32) a.color = hex8(input.readInt32());
      if (f & 64) a.sequence = readSequence(input);
      a.timelines = (f & 128) !== 0;
      a.skin = input.readInt(true); // resolved to a name once all skins are read
      a.parent = input.readStringRef();
      if (nonessential) { a.width = input.readFloat(); a.height = input.readFloat(); }
      return { json: a };
    }
    case 4: { // path
      a.type = "path";
      a.closed = (f & 16) !== 0; a.constantSpeed = (f & 32) !== 0;
      const count = input.readInt(true);
      const v = readVertices(input, count, (f & 64) !== 0);
      a.vertexCount = count; a.vertices = v.vertices;
      a.lengths = floats(input, (count << 1) / 6);
      if (nonessential) a.color = hex8(input.readInt32());
      return { json: a, vertices: v };
    }
    case 5: { // point
      a.type = "point";
      a.rotation = input.readFloat(); a.x = input.readFloat(); a.y = input.readFloat();
      if (nonessential) a.color = hex8(input.readInt32());
      return { json: a };
    }
    case 6: { // clipping
      a.type = "clipping";
      a.end = slots[input.readInt(true)].name;
      const count = input.readInt(true);
      const v = readVertices(input, count, (f & 16) !== 0);
      a.vertexCount = count; a.vertices = v.vertices;
      if (nonessential) a.color = hex8(input.readInt32());
      return { json: a, vertices: v };
    }
  }
  throw new Error(`unknown attachment type ${f & 0b111} for "${key}"`);
}

interface Ctx42 {
  bones: Key[]; slots: Key[]; ik: Key[]; transform: Key[]; path: Key[]; physics: Key[]; skins: Key[];
  vertexInfo: Map<string, { weighted: boolean; vertices: number[] }>;
  eventList: { name: string; audio: string | null }[];
}

const CURVE_STEPPED = 1, CURVE_BEZIER = 2;

/** Reads `frameCount` keys (each with `values` curve channels) and the curve after every key but the last. */
function readCurveKeys(input: BinaryInput, frameCount: number, read: () => Key, values: number): Key[] {
  const keys: Key[] = [];
  let key = read();
  for (let frame = 0; ; frame++) {
    keys.push(key);
    if (frame === frameCount - 1) break;
    const next = read();
    const c = input.readByte();
    if (c === CURVE_STEPPED) key.curve = "stepped";
    else if (c === CURVE_BEZIER) for (let v = 0; v < values; v++) bezier(input, key);
    key = next;
  }
  return keys;
}

function readAnimation42(input: BinaryInput, ctx: Ctx42): Key {
  input.readInt(true); // timeline count
  const anim: Key = {};
  const u = () => input.readUnsignedByte();

  const slotsTl: Key = {};
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const slot = ctx.slots[input.readInt(true)].name;
    const tl: Key = (slotsTl[slot] = {});
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const type = input.readByte(), frameCount = input.readInt(true);
      switch (type) {
        case 0: { // attachment
          const keys: Key[] = [];
          for (let f = 0; f < frameCount; f++) keys.push({ time: input.readFloat(), name: input.readStringRef() });
          tl.attachment = keys; break;
        }
        case 1: input.readInt(true); tl.rgba = readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), color: byteHex(u(), u(), u(), u()) }), 4); break;
        case 2: input.readInt(true); tl.rgb = readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), color: byteHex(u(), u(), u()) }), 3); break;
        case 3: input.readInt(true); tl.rgba2 = readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), light: byteHex(u(), u(), u(), u()), dark: byteHex(u(), u(), u()) }), 7); break;
        case 4: input.readInt(true); tl.rgb2 = readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), light: byteHex(u(), u(), u()), dark: byteHex(u(), u(), u()) }), 6); break;
        case 5: input.readInt(true); tl.alpha = readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), value: u() / 255 }), 1); break;
        default: throw new Error(`unknown slot timeline type ${type}`);
      }
    }
  }
  if (Object.keys(slotsTl).length) anim.slots = slotsTl;

  const BONE = ["rotate", "translate", "translatex", "translatey", "scale", "scalex", "scaley", "shear", "shearx", "sheary"];
  const bonesTl: Key = {};
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const bone = ctx.bones[input.readInt(true)].name;
    const tl: Key = (bonesTl[bone] = {});
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const type = input.readByte(), frameCount = input.readInt(true);
      if (type === 10) {
        const keys: Key[] = [];
        for (let f = 0; f < frameCount; f++) keys.push({ time: input.readFloat(), inherit: INHERIT[input.readByte()] });
        tl.inherit = keys; continue;
      }
      input.readInt(true); // bezier count
      const name = BONE[type];
      if (!name) throw new Error(`unknown bone timeline type ${type}`);
      const two = type === 1 || type === 4 || type === 7;
      tl[name] = two
        ? readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), x: input.readFloat(), y: input.readFloat() }), 2)
        : readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), value: input.readFloat() }), 1);
    }
  }
  if (Object.keys(bonesTl).length) anim.bones = bonesTl;

  const ikTl: Key = {};
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const name = ctx.ik[input.readInt(true)].name, frameCount = input.readInt(true);
    input.readInt(true);
    const keys: Key[] = [];
    let flags = input.readByte();
    const read = (fl: number): Key => {
      const k: Key = { time: input.readFloat() };
      k.mix = fl & 1 ? (fl & 2 ? input.readFloat() : 1) : 0;
      k.softness = fl & 4 ? input.readFloat() : 0;
      k.bendPositive = (fl & 8) !== 0; k.compress = (fl & 16) !== 0; k.stretch = (fl & 32) !== 0;
      return k;
    };
    let key = read(flags);
    for (let frame = 0; ; frame++) {
      keys.push(key);
      if (frame === frameCount - 1) break;
      flags = input.readByte();
      const next = read(flags);
      if (flags & 64) key.curve = "stepped";
      else if (flags & 128) { bezier(input, key); bezier(input, key); }
      key = next;
    }
    ikTl[name] = keys;
  }
  if (Object.keys(ikTl).length) anim.ik = ikTl;

  const tcTl: Key = {};
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const name = ctx.transform[input.readInt(true)].name, frameCount = input.readInt(true);
    input.readInt(true);
    tcTl[name] = readCurveKeys(input, frameCount, () => ({
      time: input.readFloat(), mixRotate: input.readFloat(), mixX: input.readFloat(), mixY: input.readFloat(),
      mixScaleX: input.readFloat(), mixScaleY: input.readFloat(), mixShearY: input.readFloat(),
    }), 6);
  }
  if (Object.keys(tcTl).length) anim.transform = tcTl;

  const pathTl: Key = {};
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const name = ctx.path[input.readInt(true)].name;
    const tl: Key = (pathTl[name] = {});
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const type = input.readByte(), frameCount = input.readInt(true);
      input.readInt(true);
      if (type === 0) tl.position = readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), value: input.readFloat() }), 1);
      else if (type === 1) tl.spacing = readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), value: input.readFloat() }), 1);
      else if (type === 2) tl.mix = readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), mixRotate: input.readFloat(), mixX: input.readFloat(), mixY: input.readFloat() }), 3);
      else throw new Error(`unknown path timeline type ${type}`);
    }
  }
  if (Object.keys(pathTl).length) anim.path = pathTl;

  const PHYS: Record<number, string> = { 0: "inertia", 1: "strength", 2: "damping", 4: "mass", 5: "wind", 6: "gravity", 7: "mix", 8: "reset" };
  const physTl: Key = {};
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const index = input.readInt(true) - 1;
    const name = index === -1 ? "" : ctx.physics[index].name;
    const tl: Key = (physTl[name] = {});
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const type = input.readByte(), frameCount = input.readInt(true);
      const key = PHYS[type];
      if (!key) throw new Error(`unknown physics timeline type ${type}`);
      if (type === 8) { const keys: Key[] = []; for (let f = 0; f < frameCount; f++) keys.push({ time: input.readFloat() }); tl.reset = keys; continue; }
      input.readInt(true);
      tl[key] = readCurveKeys(input, frameCount, () => ({ time: input.readFloat(), value: input.readFloat() }), 1);
    }
  }
  if (Object.keys(physTl).length) anim.physics = physTl;

  const attTl: Key = {};
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const skinIndex = input.readInt(true);
    const skinMap: Key = (attTl[ctx.skins[skinIndex].name] ??= {});
    for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
      const slotIndex = input.readInt(true);
      const slotMap: Key = (skinMap[ctx.slots[slotIndex].name] ??= {});
      for (let iii = 0, nnn = input.readInt(true); iii < nnn; iii++) {
        const attName = input.readStringRef()!;
        const tl: Key = (slotMap[attName] ??= {});
        const type = input.readByte(), frameCount = input.readInt(true);
        if (type === 0) {
          const info = ctx.vertexInfo.get(`${skinIndex}/${slotIndex}/${attName}`);
          if (!info) throw new Error(`deform key for unknown attachment ${attName}`);
          input.readInt(true);
          // unlike the other timelines, the time comes before the curve and the vertices after it
          const keys: Key[] = [];
          let time = input.readFloat();
          for (let frame = 0; ; frame++) {
            const k: Key = { time };
            const end = input.readInt(true);
            if (end !== 0) { k.offset = input.readInt(true); k.vertices = floats(input, end); }
            keys.push(k);
            if (frame === frameCount - 1) break;
            time = input.readFloat();
            const c = input.readByte();
            if (c === CURVE_STEPPED) k.curve = "stepped";
            else if (c === CURVE_BEZIER) bezier(input, k);
          }
          tl.deform = keys;
        } else if (type === 1) {
          const keys: Key[] = [];
          for (let f = 0; f < frameCount; f++) {
            const time = input.readFloat(), modeAndIndex = input.readInt32();
            keys.push({ time, mode: SEQUENCE_MODE[modeAndIndex & 0xf], index: modeAndIndex >> 4, delay: input.readFloat() });
          }
          tl.sequence = keys;
        } else throw new Error(`unknown attachment timeline type ${type}`);
      }
    }
  }
  if (Object.keys(attTl).length) anim.attachments = attTl;

  const drawOrderCount = input.readInt(true);
  if (drawOrderCount > 0) anim.drawOrder = readDrawOrder(input, drawOrderCount, ctx.slots);

  const eventCount = input.readInt(true);
  if (eventCount > 0) {
    const keys: Key[] = [];
    for (let i = 0; i < eventCount; i++) {
      const time = input.readFloat();
      const ev = ctx.eventList[input.readInt(true)];
      const k: Key = { time, name: ev.name, int: input.readInt(false), float: input.readFloat() };
      const s = input.readString(); if (s !== null) k.string = s;
      if (ev.audio) { k.volume = input.readFloat(); k.balance = input.readFloat(); }
      keys.push(k);
    }
    anim.events = keys;
  }
  return anim;
}

function readDrawOrder(input: BinaryInput, count: number, slots: Key[]): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < count; i++) {
    const k: Key = { time: input.readFloat() };
    const offsets: Key[] = [];
    for (let ii = 0, n = input.readInt(true); ii < n; ii++) offsets.push({ slot: slots[input.readInt(true)].name, offset: input.readInt(true) });
    if (offsets.length) k.offsets = offsets;
    keys.push(k);
  }
  return keys;
}

// ---------------------------------------------------------------------------------------------------------------
// 3.8: same idea, older layout (string hash, booleans instead of flag bytes, int16 triangles, one curve per key)

function read38(bytes: Uint8Array): any {
  const input = new BinaryInput(bytes);
  const short = () => { const v = (input.readUnsignedByte() << 8) | input.readUnsignedByte(); return v & 0x8000 ? v - 0x10000 : v; };
  const shortArray = () => { const n = input.readInt(true); const a = new Array<number>(n); for (let i = 0; i < n; i++) a[i] = short(); return a; };
  const vertices38 = (count: number) => readVertices(input, count, input.readBoolean());

  const skeleton: Key = {};
  const hash = input.readString(); if (hash) skeleton.hash = hash;
  skeleton.spine = input.readString();
  skeleton.x = input.readFloat(); skeleton.y = input.readFloat(); skeleton.width = input.readFloat(); skeleton.height = input.readFloat();
  const nonessential = input.readBoolean();
  if (nonessential) { skeleton.fps = input.readFloat(); skeleton.images = input.readString() ?? ""; skeleton.audio = input.readString() ?? ""; }
  for (let i = 0, n = input.readInt(true); i < n; i++) input.strings.push(input.readString()!);

  const bones: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const b: Key = { name: input.readString() };
    if (i > 0) b.parent = bones[input.readInt(true)].name;
    b.rotation = input.readFloat(); b.x = input.readFloat(); b.y = input.readFloat();
    b.scaleX = input.readFloat(); b.scaleY = input.readFloat(); b.shearX = input.readFloat(); b.shearY = input.readFloat();
    b.length = input.readFloat();
    b.transform = INHERIT[input.readInt(true)];
    b.skin = input.readBoolean();
    if (nonessential) b.color = hex8(input.readInt32());
    bones.push(b);
  }

  const slots: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const s: Key = { name: input.readString(), bone: bones[input.readInt(true)].name, color: hex8(input.readInt32()) };
    const dark = input.readInt32();
    if (dark !== -1) s.dark = hex6(dark);
    const att = input.readStringRef(); if (att) s.attachment = att;
    s.blend = BLEND[input.readInt(true)];
    slots.push(s);
  }

  const ik: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const c: Key = { name: input.readString(), order: input.readInt(true), skin: input.readBoolean() };
    c.bones = shorts(input, input.readInt(true)).map((k) => bones[k].name);
    c.target = bones[input.readInt(true)].name;
    c.mix = input.readFloat(); c.softness = input.readFloat();
    c.bendPositive = input.readByte() > 0;
    c.compress = input.readBoolean(); c.stretch = input.readBoolean(); c.uniform = input.readBoolean();
    ik.push(c);
  }

  const transform: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const c: Key = { name: input.readString(), order: input.readInt(true), skin: input.readBoolean() };
    c.bones = shorts(input, input.readInt(true)).map((k) => bones[k].name);
    c.target = bones[input.readInt(true)].name;
    c.local = input.readBoolean(); c.relative = input.readBoolean();
    c.rotation = input.readFloat(); c.x = input.readFloat(); c.y = input.readFloat();
    c.scaleX = input.readFloat(); c.scaleY = input.readFloat(); c.shearY = input.readFloat();
    c.rotateMix = input.readFloat(); c.translateMix = input.readFloat(); c.scaleMix = input.readFloat(); c.shearMix = input.readFloat();
    transform.push(c);
  }

  const path: Key[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const c: Key = { name: input.readString(), order: input.readInt(true), skin: input.readBoolean() };
    c.bones = shorts(input, input.readInt(true)).map((k) => bones[k].name);
    c.target = slots[input.readInt(true)].name;
    c.positionMode = POSITION[input.readInt(true)]; c.spacingMode = SPACING[input.readInt(true)]; c.rotateMode = ROTATE[input.readInt(true)];
    c.rotation = input.readFloat(); c.position = input.readFloat(); c.spacing = input.readFloat();
    c.rotateMix = input.readFloat(); c.translateMix = input.readFloat();
    path.push(c);
  }

  const skins: Key[] = [];
  const vertexInfo = new Map<string, { weighted: boolean; vertices: number[] }>();
  const readSkin = (isDefault: boolean): Key | null => {
    const skin: Key = {};
    let slotCount: number;
    if (isDefault) {
      slotCount = input.readInt(true);
      if (slotCount === 0) return null;
      skin.name = "default";
    } else {
      skin.name = input.readStringRef();
      const sb = shorts(input, input.readInt(true)).map((k) => bones[k].name); if (sb.length) skin.bones = sb;
      const si = shorts(input, input.readInt(true)).map((k) => ik[k].name); if (si.length) skin.ik = si;
      const st = shorts(input, input.readInt(true)).map((k) => transform[k].name); if (st.length) skin.transform = st;
      const sp = shorts(input, input.readInt(true)).map((k) => path[k].name); if (sp.length) skin.path = sp;
      slotCount = input.readInt(true);
    }
    const skinIndex = skins.length;
    const attachments: Key = {};
    for (let i = 0; i < slotCount; i++) {
      const slotIndex = input.readInt(true);
      const map: Key = (attachments[slots[slotIndex].name] ??= {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const key = input.readStringRef()!;
        const name = input.readStringRef();
        const a: Key = {};
        if (name && name !== key) a.name = name;
        const type = input.readByte();
        switch (type) {
          case 0: { // region
            const p = input.readStringRef(); if (p) a.path = p;
            a.rotation = input.readFloat(); a.x = input.readFloat(); a.y = input.readFloat();
            a.scaleX = input.readFloat(); a.scaleY = input.readFloat(); a.width = input.readFloat(); a.height = input.readFloat();
            a.color = hex8(input.readInt32());
            break;
          }
          case 1: { // bounding box
            a.type = "boundingbox";
            a.vertexCount = input.readInt(true);
            const v = vertices38(a.vertexCount); a.vertices = v.vertices; vertexInfo.set(`${skinIndex}/${slotIndex}/${key}`, v);
            if (nonessential) a.color = hex8(input.readInt32());
            break;
          }
          case 2: { // mesh
            a.type = "mesh";
            const p = input.readStringRef(); if (p) a.path = p;
            a.color = hex8(input.readInt32());
            const count = input.readInt(true);
            a.uvs = floats(input, count << 1);
            a.triangles = shortArray();
            const v = vertices38(count); a.vertices = v.vertices; vertexInfo.set(`${skinIndex}/${slotIndex}/${key}`, v);
            a.hull = input.readInt(true);
            if (nonessential) { a.edges = shortArray(); a.width = input.readFloat(); a.height = input.readFloat(); }
            break;
          }
          case 3: { // linked mesh
            a.type = "linkedmesh";
            const p = input.readStringRef(); if (p) a.path = p;
            a.color = hex8(input.readInt32());
            const sk = input.readStringRef(); if (sk) a.skin = sk;
            a.parent = input.readStringRef();
            a.deform = input.readBoolean();
            if (nonessential) { a.width = input.readFloat(); a.height = input.readFloat(); }
            break;
          }
          case 4: { // path
            a.type = "path";
            a.closed = input.readBoolean(); a.constantSpeed = input.readBoolean();
            a.vertexCount = input.readInt(true);
            const v = vertices38(a.vertexCount); a.vertices = v.vertices; vertexInfo.set(`${skinIndex}/${slotIndex}/${key}`, v);
            a.lengths = floats(input, a.vertexCount / 3);
            if (nonessential) a.color = hex8(input.readInt32());
            break;
          }
          case 5: { // point
            a.type = "point";
            a.rotation = input.readFloat(); a.x = input.readFloat(); a.y = input.readFloat();
            if (nonessential) a.color = hex8(input.readInt32());
            break;
          }
          case 6: { // clipping
            a.type = "clipping";
            a.end = slots[input.readInt(true)].name;
            a.vertexCount = input.readInt(true);
            const v = vertices38(a.vertexCount); a.vertices = v.vertices; vertexInfo.set(`${skinIndex}/${slotIndex}/${key}`, v);
            if (nonessential) a.color = hex8(input.readInt32());
            break;
          }
          default: throw new Error(`unknown attachment type ${type} for "${key}"`);
        }
        map[key] = a;
      }
    }
    skin.attachments = attachments;
    return skin;
  };
  const def = readSkin(true);
  if (def) skins.push(def);
  for (let i = 0, n = input.readInt(true); i < n; i++) skins.push(readSkin(false)!);

  const events: Key = {};
  const eventList: { name: string; audio: string | null }[] = [];
  for (let i = 0, n = input.readInt(true); i < n; i++) {
    const name = input.readStringRef()!;
    const e: Key = { int: input.readInt(false), float: input.readFloat(), string: input.readString() ?? "" };
    const audio = input.readString();
    if (audio !== null) { e.audio = audio; e.volume = input.readFloat(); e.balance = input.readFloat(); }
    events[name] = e;
    eventList.push({ name, audio });
  }

  // 3.8 keys carry their own curve: "stepped" or curve/c2/c3/c4
  const curve = (k: Key) => {
    const c = input.readByte();
    if (c === CURVE_STEPPED) k.curve = "stepped";
    else if (c === CURVE_BEZIER) { k.curve = input.readFloat(); k.c2 = input.readFloat(); k.c3 = input.readFloat(); k.c4 = input.readFloat(); }
  };
  const keys = (frameCount: number, read: () => Key): Key[] => {
    const out: Key[] = [];
    for (let f = 0; f < frameCount; f++) { const k = read(); if (f < frameCount - 1) curve(k); out.push(k); }
    return out;
  };

  const animations: Key = {};
  for (let ai = 0, an = input.readInt(true); ai < an; ai++) {
    const animName = input.readString()!;
    const anim: Key = {};

    const slotsTl: Key = {};
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const tl: Key = (slotsTl[slots[input.readInt(true)].name] = {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const type = input.readByte(), frameCount = input.readInt(true);
        if (type === 0) { const k: Key[] = []; for (let f = 0; f < frameCount; f++) k.push({ time: input.readFloat(), name: input.readStringRef() }); tl.attachment = k; }
        else if (type === 1) tl.color = keys(frameCount, () => ({ time: input.readFloat(), color: hex8(input.readInt32()) }));
        else if (type === 2) tl.twoColor = keys(frameCount, () => ({ time: input.readFloat(), light: hex8(input.readInt32()), dark: hex6(input.readInt32()) }));
        else throw new Error(`unknown slot timeline type ${type}`);
      }
    }
    if (Object.keys(slotsTl).length) anim.slots = slotsTl;

    const bonesTl: Key = {};
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const tl: Key = (bonesTl[bones[input.readInt(true)].name] = {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const type = input.readByte(), frameCount = input.readInt(true);
        if (type === 0) tl.rotate = keys(frameCount, () => ({ time: input.readFloat(), angle: input.readFloat() }));
        else if (type <= 3) tl[["", "translate", "scale", "shear"][type]] = keys(frameCount, () => ({ time: input.readFloat(), x: input.readFloat(), y: input.readFloat() }));
        else throw new Error(`unknown bone timeline type ${type}`);
      }
    }
    if (Object.keys(bonesTl).length) anim.bones = bonesTl;

    const ikTl: Key = {};
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const name = ik[input.readInt(true)].name, frameCount = input.readInt(true);
      ikTl[name] = keys(frameCount, () => ({
        time: input.readFloat(), mix: input.readFloat(), softness: input.readFloat(),
        bendPositive: input.readByte() > 0, compress: input.readBoolean(), stretch: input.readBoolean(),
      }));
    }
    if (Object.keys(ikTl).length) anim.ik = ikTl;

    const tcTl: Key = {};
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const name = transform[input.readInt(true)].name, frameCount = input.readInt(true);
      tcTl[name] = keys(frameCount, () => ({ time: input.readFloat(), rotateMix: input.readFloat(), translateMix: input.readFloat(), scaleMix: input.readFloat(), shearMix: input.readFloat() }));
    }
    if (Object.keys(tcTl).length) anim.transform = tcTl;

    const pathTl: Key = {};
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const tl: Key = (pathTl[path[input.readInt(true)].name] = {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const type = input.readByte(), frameCount = input.readInt(true);
        if (type === 0) tl.position = keys(frameCount, () => ({ time: input.readFloat(), position: input.readFloat() }));
        else if (type === 1) tl.spacing = keys(frameCount, () => ({ time: input.readFloat(), spacing: input.readFloat() }));
        else if (type === 2) tl.mix = keys(frameCount, () => ({ time: input.readFloat(), rotateMix: input.readFloat(), translateMix: input.readFloat() }));
        else throw new Error(`unknown path timeline type ${type}`);
      }
    }
    if (Object.keys(pathTl).length) anim.path = pathTl;

    const deformTl: Key = {};
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const skinIndex = input.readInt(true);
      const skinMap: Key = (deformTl[skins[skinIndex].name] ??= {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const slotIndex = input.readInt(true);
        const slotMap: Key = (skinMap[slots[slotIndex].name] ??= {});
        for (let iii = 0, nnn = input.readInt(true); iii < nnn; iii++) {
          const attName = input.readStringRef()!;
          slotMap[attName] = keys(input.readInt(true), () => {
            const k: Key = { time: input.readFloat() };
            const end = input.readInt(true);
            if (end !== 0) { k.offset = input.readInt(true); k.vertices = floats(input, end); }
            return k;
          });
        }
      }
    }
    if (Object.keys(deformTl).length) anim.deform = deformTl;

    const drawOrderCount = input.readInt(true);
    if (drawOrderCount > 0) anim.drawOrder = readDrawOrder(input, drawOrderCount, slots);

    const eventCount = input.readInt(true);
    if (eventCount > 0) {
      const ev: Key[] = [];
      for (let i = 0; i < eventCount; i++) {
        const time = input.readFloat();
        const e = eventList[input.readInt(true)];
        const k: Key = { time, name: e.name, int: input.readInt(false), float: input.readFloat() };
        if (input.readBoolean()) k.string = input.readString() ?? "";
        if (e.audio !== null) { k.volume = input.readFloat(); k.balance = input.readFloat(); }
        ev.push(k);
      }
      anim.events = ev;
    }
    animations[animName] = anim;
  }

  const json: Key = { skeleton, bones, slots };
  if (ik.length) json.ik = ik;
  if (transform.length) json.transform = transform;
  if (path.length) json.path = path;
  json.skins = skins;
  if (eventList.length) json.events = events;
  json.animations = animations;
  return json;
}
