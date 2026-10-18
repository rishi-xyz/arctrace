/**
 * Attack suite helpers (spec.md section 5.5). JPEG encode/decode via jpeg-js
 * (dev dependency of the PoC and tests only); the rest are pure array math.
 */
import jpeg from "jpeg-js";
import { resizeRgba } from "./dct.js";
import type { ImageDataLike } from "./config.js";

export function toJpeg(img: ImageDataLike, quality: number): Uint8Array {
  const { data } = jpeg.encode({ data: img.data, width: img.width, height: img.height }, quality);
  return new Uint8Array(data);
}

export function fromJpeg(bytes: Uint8Array): ImageDataLike {
  const { data, width, height } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  return { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

export function jpegAttack(img: ImageDataLike, quality: number): ImageDataLike {
  return fromJpeg(toJpeg(img, quality));
}

export function resizeAttack(img: ImageDataLike, scale: number): ImageDataLike {
  return resizeRgba(img, Math.round(img.width * scale), Math.round(img.height * scale));
}

export function cropAttack(img: ImageDataLike, fraction: number): ImageDataLike {
  const dx = Math.round(img.width * fraction);
  const dy = Math.round(img.height * fraction);
  const w = img.width - 2 * dx;
  const h = img.height - 2 * dy;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y + dy) * img.width + dx) * 4;
    out.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

export function grayscaleAttack(img: ImageDataLike): ImageDataLike {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const g = 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
    out[i] = out[i + 1] = out[i + 2] = g;
    out[i + 3] = img.data[i + 3]!;
  }
  return { width: img.width, height: img.height, data: out };
}

/** Deterministic gaussian-ish noise (sum of uniforms), sigma in 0..255. */
export function noiseAttack(img: ImageDataLike, sigma: number, seed = 1): ImageDataLike {
  const out = new Uint8ClampedArray(img.data);
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = 0; i < out.length; i += 4) {
    const n = ((rand() + rand() + rand() - 1.5) * 2 * sigma) | 0; // approx gaussian
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, out[i + c]! + n));
  }
  return { width: img.width, height: img.height, data: out };
}

/** Screenshot simulation: resample through 1x (identity-ish resize) with a
 *  mild color shift. */
export function screenshotAttack(img: ImageDataLike): ImageDataLike {
  const resampled = resizeRgba(img, img.width, img.height);
  const out = new Uint8ClampedArray(resampled.data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.min(255, out[i]! + 3);
    out[i + 2] = Math.max(0, out[i + 2]! - 3);
  }
  return { width: img.width, height: img.height, data: out };
}
