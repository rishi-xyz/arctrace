/**
 * Deterministic synthetic "document page" generator: text-like strokes,
 * chart-like bars and light noise. Gives the embedder plenty of textured
 * (high-variance) blocks, like a real scanned page. Used by the tests and the
 * PoC demo so the repo needs no binary fixtures.
 */
import type { ImageDataLike } from "./config.js";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function makeSamplePage(width = 512, height = 512, seed = 42): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  const rnd = lcg(seed);

  // background: near-white paper with faint noise
  for (let i = 0; i < width * height; i++) {
    const base = 245 + Math.round(rnd() * 6);
    data[i * 4] = base;
    data[i * 4 + 1] = base;
    data[i * 4 + 2] = base;
    data[i * 4 + 3] = 255;
  }

  const set = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
  };

  // "paragraph" of text-like strokes
  let y = 30;
  while (y < Math.floor(height * 0.55)) {
    let x = 30;
    const lineH = 7;
    while (x < width - 40) {
      const wordLen = 12 + Math.floor(rnd() * 40);
      for (let k = 0; k < wordLen && x + k < width - 32; k++) {
        // pseudo glyph: vertical strokes
        if (rnd() > 0.35) {
          for (let dy = 0; dy < lineH; dy++) set(x + k, y + dy, 30);
          if (rnd() > 0.6) for (let dy = 0; dy < lineH - 3; dy++) set(x + k + 1, y + dy, 60);
        }
      }
      x += wordLen + 6;
    }
    y += lineH + 6;
  }

  // "chart" region: bars with hatching
  const chartTop = Math.floor(height * 0.62);
  const chartBottom = height - 30;
  for (let b = 0; b < 8; b++) {
    const barX = 40 + b * 55;
    const barH = 40 + Math.floor(rnd() * (chartBottom - chartTop - 60));
    for (let yy = chartBottom - barH; yy < chartBottom; yy++) {
      for (let xx = barX; xx < barX + 34; xx++) {
        const hatch = (xx + yy) % 3 === 0 ? 90 : 150;
        set(xx, yy, hatch);
      }
    }
    // axis ticks
    for (let xx = barX; xx < barX + 34; xx++) set(xx, chartBottom, 0);
  }

  return { width, height, data };
}
