/**
 * 8x8 DCT-II / DCT-III (separable, precomputed table) and RGB<->YCbCr.
 * Operates on the luma plane of an RGBA image.
 */

type F64 = Float64Array;

const COS: readonly (readonly number[])[] = (() => {
  // COS[u][x] = cos((2x+1) u pi / 16)
  const t: number[][] = [];
  for (let u = 0; u < 8; u++) {
    const row: number[] = [];
    for (let x = 0; x < 8; x++) row.push(Math.cos(((2 * x + 1) * u * Math.PI) / 16));
    t.push(row);
  }
  return t;
})();

const ALPHA: readonly number[] = [
  Math.sqrt(1 / 8),
  ...Array.from({ length: 7 }, () => Math.sqrt(2 / 8)),
];

/** Forward 8x8 DCT-II on an 8x8 block (row-major, 64 floats). */
export function dct8x8(block: F64): F64 {
  const tmp = new Float64Array(64);
  const out = new Float64Array(64);
  // rows
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      const cu = COS[u]!;
      let s = 0;
      for (let x = 0; x < 8; x++) s += block[y * 8 + x]! * cu[x]!;
      tmp[y * 8 + u] = s * ALPHA[u]!;
    }
  }
  // cols (output index is v, so the scale factor is ALPHA[v])
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      const cv = COS[v]!;
      let s = 0;
      for (let y = 0; y < 8; y++) s += tmp[y * 8 + u]! * cv[y]!;
      out[v * 8 + u] = s * ALPHA[v]!;
    }
  }
  return out;
}

/** Inverse 8x8 DCT-III on an 8x8 DCT block (row-major, 64 floats). */
export function idct8x8(coeff: F64): F64 {
  const tmp = new Float64Array(64);
  const out = new Float64Array(64);
  // inverse over rows (u axis)
  for (let v = 0; v < 8; v++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += ALPHA[u]! * coeff[v * 8 + u]! * COS[u]![x]!;
      tmp[v * 8 + x] = s;
    }
  }
  // inverse over cols (v axis)
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += ALPHA[v]! * tmp[v * 8 + x]! * COS[v]![y]!;
      out[y * 8 + x] = s;
    }
  }
  return out;
}

/** Extract the luma (Y) plane from RGBA. */
export function lumaPlane(rgba: Uint8ClampedArray, width: number, height: number): Float64Array {
  const y = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4]!,
      g = rgba[i * 4 + 1]!,
      b = rgba[i * 4 + 2]!;
    y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return y;
}

/** Write luma back into RGBA, preserving chroma (simple Y-scaled approach:
 *  keep R,G,B chroma ratios by adjusting each channel by the luma delta). */
export function applyLuma(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  origLuma: Float64Array,
  newLuma: Float64Array,
): void {
  for (let i = 0; i < width * height; i++) {
    const delta = newLuma[i]! - origLuma[i]!;
    for (let c = 0; c < 3; c++) {
      rgba[i * 4 + c] = clamp8(rgba[i * 4 + c]! + delta);
    }
  }
}

export function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Block variance over an 8x8 luma block. */
export function blockVariance(y: Float64Array, width: number, bx: number, by: number): number {
  let sum = 0;
  let sumSq = 0;
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const v = y[(by + j) * width + (bx + i)]!;
      sum += v;
      sumSq += v * v;
    }
  }
  const mean = sum / 64;
  return sumSq / 64 - mean * mean;
}

/** Bilinear resize of an RGBA image (used by the attack suite and the
 *  alignment search). */
export function resizeRgba(
  img: { width: number; height: number; data: Uint8ClampedArray },
  newW: number,
  newH: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const out = new Uint8ClampedArray(newW * newH * 4);
  for (let y = 0; y < newH; y++) {
    const sy = Math.min((y * (img.height - 1)) / Math.max(newH - 1, 1), img.height - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, img.height - 1);
    const fy = sy - y0;
    for (let x = 0; x < newW; x++) {
      const sx = Math.min((x * (img.width - 1)) / Math.max(newW - 1, 1), img.width - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, img.width - 1);
      const fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const p00 = img.data[(y0 * img.width + x0) * 4 + c]!;
        const p01 = img.data[(y0 * img.width + x1) * 4 + c]!;
        const p10 = img.data[(y1 * img.width + x0) * 4 + c]!;
        const p11 = img.data[(y1 * img.width + x1) * 4 + c]!;
        out[(y * newW + x) * 4 + c] =
          p00 * (1 - fx) * (1 - fy) + p01 * fx * (1 - fy) + p10 * (1 - fx) * fy + p11 * fx * fy;
      }
    }
  }
  return { width: newW, height: newH, data: out };
}

/** PSNR between two RGBA images. */
export function psnr(
  a: { width: number; height: number; data: Uint8ClampedArray },
  b: { width: number; height: number; data: Uint8ClampedArray },
): number {
  let mse = 0;
  const n = a.data.length;
  for (let i = 0; i < n; i++) {
    const d = a.data[i]! - b.data[i]!;
    mse += d * d;
  }
  mse /= n;
  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
}
