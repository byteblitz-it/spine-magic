import { unzlibSync, zlibSync } from "fflate";

/** Straight-alpha RGBA8 image. */
export interface Image {
  width: number;
  height: number;
  data: Uint8Array; // width * height * 4
}

export function createImage(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function encodePng(img: Image): Uint8Array {
  const { width, height, data } = img;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Decodes 8-bit, non-interlaced PNGs (grey, grey+alpha, RGB, RGBA, palette). */
export function decodePng(buf: Uint8Array): Image {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== 0x89504e47) throw new Error("not a PNG file");
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos < buf.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      const b = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = b.getUint32(0); height = b.getUint32(4);
      depth = body[8]; ctype = body[9]; interlace = body[12];
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (bit depth ${depth}, interlace ${interlace}); use 8-bit non-interlaced`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype as 0 | 2 | 3 | 4 | 6];
  if (!channels) throw new Error(`unsupported PNG colour type ${ctype}`);
  const raw = unzlibSync(concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  const img = createImage(width, height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4, s = i * channels;
    switch (ctype) {
      case 0: img.data.set([px[s], px[s], px[s], 255], o); break;
      case 4: img.data.set([px[s], px[s], px[s], px[s + 1]], o); break;
      case 2: img.data.set([px[s], px[s + 1], px[s + 2], 255], o); break;
      case 6: img.data.set(px.subarray(s, s + 4), o); break;
      case 3: {
        const p = px[s] * 3;
        img.data.set([palette![p], palette![p + 1], palette![p + 2], trns && px[s] < trns.length ? trns[px[s]] : 255], o);
        break;
      }
    }
  }
  return img;
}
