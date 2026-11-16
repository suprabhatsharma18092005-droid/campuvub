import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

import { APP_THEMES, DEFAULT_THEME_ID, getAppTheme } from "@/lib/themes";

type RgbaBitmap = {
  width: number;
  height: number;
  data: Uint8Array;
};

let cachedLogoMask: RgbaBitmap | null | undefined;
const iconCache = new Map<string, Buffer>();

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePngRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    const srcStart = y * stride;
    raw.set(rgba.subarray(srcStart, srcStart + stride), rowStart + 1);
  }

  const compressed = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    PNG_SIG,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(buf: Buffer): RgbaBitmap | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buf.length) break;
    if (type === "IHDR" && length >= 13) {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8] ?? 0;
      colorType = buf[dataStart + 9] ?? 0;
    } else if (type === "IDAT") {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height || bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    return null;
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  if (inflated.length < (stride + 1) * height) return null;

  const pixels = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const currRow = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const rowOff = y * (stride + 1);
    const filter = inflated[rowOff] ?? 0;
    for (let i = 0; i < stride; i += 1) {
      const x = inflated[rowOff + 1 + i] ?? 0;
      const a = i >= bpp ? currRow[i - bpp]! : 0;
      const b = prevRow[i]!;
      const c = i >= bpp ? prevRow[i - bpp]! : 0;
      let val = x;
      if (filter === 1) val = (x + a) & 0xff;
      else if (filter === 2) val = (x + b) & 0xff;
      else if (filter === 3) val = (x + ((a + b) >>> 1)) & 0xff;
      else if (filter === 4) val = (x + paethPredictor(a, b, c)) & 0xff;
      currRow[i] = val;
    }

    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 4;
      const src = x * bpp;
      pixels[dst] = currRow[src]!;
      pixels[dst + 1] = currRow[src + 1]!;
      pixels[dst + 2] = currRow[src + 2]!;
      pixels[dst + 3] = bpp === 4 ? currRow[src + 3]! : 255;
    }
    prevRow.set(currRow);
  }

  return { width, height, data: pixels };
}

function loadCampuLogoMask(): RgbaBitmap | null {
  if (cachedLogoMask !== undefined) return cachedLogoMask;
  const candidates = [
    resolve(process.cwd(), "public/assets/aistudio/campu_icon_transparent_9aabb4d1.png"),
    resolve(process.cwd(), ".output/public/assets/aistudio/campu_icon_transparent_9aabb4d1.png"),
  ];
  for (const filePath of candidates) {
    try {
      const raw = readFileSync(filePath);
      const decoded = decodePngRgba(raw);
      if (decoded) {
        cachedLogoMask = decoded;
        return decoded;
      }
    } catch {
      // Try next candidate
    }
  }
  cachedLogoMask = null;
  return null;
}

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean.padEnd(6, "0");
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function sampleLogoAlpha(logo: RgbaBitmap, u: number, v: number): number {
  if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
  const fx = u * (logo.width - 1);
  const fy = v * (logo.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(logo.width - 1, x0 + 1);
  const y1 = Math.min(logo.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const a00 = logo.data[(y0 * logo.width + x0) * 4 + 3]! / 255;
  const a10 = logo.data[(y0 * logo.width + x1) * 4 + 3]! / 255;
  const a01 = logo.data[(y1 * logo.width + x0) * 4 + 3]! / 255;
  const a11 = logo.data[(y1 * logo.width + x1) * 4 + 3]! / 255;

  const top = a00 + (a10 - a00) * tx;
  const bot = a01 + (a11 - a01) * tx;
  return top + (bot - top) * ty;
}

/** Fallback stylized 'C' alpha if source image isn't present in runtime bundle. */
function fallbackCampuMarkAlpha(u: number, v: number): number {
  const cx = u - 0.56;
  const cy = v - 0.5;
  const dist = Math.hypot(cx, cy);
  const angle = Math.atan2(cy, cx);
  if (dist >= 0.22 && dist <= 0.42 && Math.abs(angle) > 0.55) {
    return 1;
  }
  // Speed lines on left
  if (u >= 0.08 && u <= 0.32 && (Math.abs(v - 0.36) < 0.045 || Math.abs(v - 0.5) < 0.045 || Math.abs(v - 0.64) < 0.045)) {
    return 1;
  }
  return 0;
}

function roundedSquareCoverage(x: number, y: number, size: number, radius: number): number {
  const half = size / 2;
  const px = Math.abs(x + 0.5 - half) - (half - radius);
  const py = Math.abs(y + 0.5 - half) - (half - radius);
  const outsideDist = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - radius;
  if (outsideDist <= -0.75) return 1;
  if (outsideDist >= 0.75) return 0;
  return 0.5 - outsideDist / 1.5;
}

export function normalizeThemeId(id?: string | null): string {
  return APP_THEMES.some((t) => t.id === id) ? id! : DEFAULT_THEME_ID;
}

export function generateThemedPwaIconPng(
  themeId: string | null | undefined,
  size: 192 | 512,
  purpose: "any" | "maskable" = "any",
): Buffer {
  const normalizedTheme = normalizeThemeId(themeId);
  const cacheKey = `${normalizedTheme}:${size}:${purpose}`;
  const hit = iconCache.get(cacheKey);
  if (hit) return hit;

  const theme = getAppTheme(normalizedTheme);
  const cTop = parseHexColor(theme.swatches[0]);
  const cBottom = parseHexColor(theme.swatches[2]);
  const logo = loadCampuLogoMask();

  const rgba = new Uint8Array(size * size * 4);
  const radius = purpose === "maskable" ? 0 : size * 0.22;

  // Maskable icons stay inside the center ~62% safe zone; "any" fills ~74%.
  const logoWidthRatio = purpose === "maskable" ? 0.56 : 0.72;
  const aspect = logo ? logo.height / logo.width : 245 / 347;
  const targetLogoW = size * logoWidthRatio;
  const targetLogoH = targetLogoW * aspect;
  const startX = (size - targetLogoW) / 2;
  const startY = (size - targetLogoH) / 2;

  for (let y = 0; y < size; y += 1) {
    const gy = y / (size - 1);
    for (let x = 0; x < size; x += 1) {
      const maskCov =
        purpose === "maskable" ? 1 : roundedSquareCoverage(x, y, size, radius);
      if (maskCov <= 0) continue;

      const gx = x / (size - 1);
      const t = Math.min(1, Math.max(0, 0.35 * gx + 0.65 * gy));
      const highlight = Math.max(0, 1 - (gx + gy) * 0.75) * 18;

      const bgR = Math.min(255, Math.round(cTop[0] + (cBottom[0] - cTop[0]) * t + highlight));
      const bgG = Math.min(255, Math.round(cTop[1] + (cBottom[1] - cTop[1]) * t + highlight));
      const bgB = Math.min(255, Math.round(cTop[2] + (cBottom[2] - cTop[2]) * t + highlight));

      const u = (x + 0.5 - startX) / targetLogoW;
      const v = (y + 0.5 - startY) / targetLogoH;
      let logoAlpha = 0;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        logoAlpha = logo ? sampleLogoAlpha(logo, u, v) : fallbackCampuMarkAlpha(u, v);
      }

      // Soft subtle drop shadow beneath the white Campu mark
      let shadowAlpha = 0;
      const su = (x + 0.5 - startX) / targetLogoW;
      const sv = (y + 0.5 - startY - size * 0.015) / targetLogoH;
      if (su >= 0 && su <= 1 && sv >= 0 && sv <= 1) {
        shadowAlpha = (logo ? sampleLogoAlpha(logo, su, sv) : fallbackCampuMarkAlpha(su, sv)) * 0.22;
      }

      const shadedR = bgR * (1 - shadowAlpha);
      const shadedG = bgG * (1 - shadowAlpha);
      const shadedB = bgB * (1 - shadowAlpha);

      const finalR = Math.round(shadedR + (255 - shadedR) * logoAlpha);
      const finalG = Math.round(shadedG + (255 - shadedG) * logoAlpha);
      const finalB = Math.round(shadedB + (255 - shadedB) * logoAlpha);

      const idx = (y * size + x) * 4;
      rgba[idx] = finalR;
      rgba[idx + 1] = finalG;
      rgba[idx + 2] = finalB;
      rgba[idx + 3] = Math.round(255 * maskCov);
    }
  }

  const png = encodePngRgba(size, size, rgba);
  iconCache.set(cacheKey, png);
  return png;
}
