import { describe, expect, it } from "vitest";
import {
  buildPayload80,
  crc16Ccitt,
  cropAttack,
  decodePayload80,
  dct8x8,
  embedRaster,
  embedText,
  extractRaster,
  extractText,
  grayscaleAttack,
  idct8x8,
  jpegAttack,
  noiseAttack,
  PAYLOAD_BITS,
  psnr,
  resizeAttack,
  screenshotAttack,
  toJpeg,
  makeSamplePage,
} from "./index.js";

const KEY = new Uint8Array(32).fill(7);
const WM = "0123456789abcdef";

describe("payload (80 bits + CRC16)", () => {
  it("round trips", () => {
    const bits = buildPayload80(WM);
    expect(bits.length).toBe(PAYLOAD_BITS);
    expect(decodePayload80(bits)).toBe(WM);
  });

  it("fails CRC on any single bit flip", () => {
    const bits = buildPayload80(WM);
    let failures = 0;
    for (let i = 0; i < PAYLOAD_BITS; i++) {
      const flipped = Uint8Array.from(bits);
      flipped[i] = flipped[i]! ^ 1;
      if (decodePayload80(flipped) === null) failures++;
    }
    expect(failures).toBe(PAYLOAD_BITS);
  });

  it("crc16-ccitt known vector ('123456789' = 0x29B1)", () => {
    expect(crc16Ccitt(new TextEncoder().encode("123456789"))).toBe(0x29b1);
  });
});

describe("DCT round trip", () => {
  it("idct(dct(x)) == x", () => {
    const block = new Float64Array(64);
    for (let i = 0; i < 64; i++) block[i] = (i * 37) % 256;
    const back = idct8x8(dct8x8(block));
    for (let i = 0; i < 64; i++) expect(back[i]!).toBeCloseTo(block[i]!, 8);
  });
});

describe("raster watermark", () => {
  const sample = makeSamplePage(512, 512, 42);
  const marked = embedRaster(sample, { keyWm: KEY, payload80: buildPayload80(WM) });

  it("is visually close (PSNR >= 38 dB)", () => {
    const p = psnr(sample, marked);
    expect(p).toBeGreaterThanOrEqual(38);
  });

  it("survives identity", () => {
    const r = extractRaster(marked, KEY, { searchScales: false });
    expect(r.ok).toBe(true);
    expect(r.wmCode).toBe(WM);
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it("survives JPEG Q90, Q75, Q60", () => {
    for (const q of [90, 75, 60]) {
      const r = extractRaster(jpegAttack(marked, q), KEY);
      expect(r.ok, `jpeg q${q}`).toBe(true);
      expect(r.wmCode, `jpeg q${q}`).toBe(WM);
    }
  });

  it("survives resize 90%, 80%, 70%", () => {
    for (const s of [0.9, 0.8, 0.7]) {
      const r = extractRaster(resizeAttack(marked, s), KEY);
      expect(r.ok, `resize ${s}`).toBe(true);
      expect(r.wmCode, `resize ${s}`).toBe(WM);
    }
  });

  it("survives crop 5% and 10%", () => {
    for (const c of [0.05, 0.1]) {
      const r = extractRaster(cropAttack(marked, c), KEY, { searchScales: false });
      expect(r.ok, `crop ${c}`).toBe(true);
      expect(r.wmCode, `crop ${c}`).toBe(WM);
    }
  });

  it("survives grayscale", () => {
    const r = extractRaster(grayscaleAttack(marked), KEY);
    expect(r.ok).toBe(true);
    expect(r.wmCode).toBe(WM);
  });

  it("survives gaussian noise sigma <= 3", () => {
    const r = extractRaster(noiseAttack(marked, 3), KEY, { searchScales: false });
    expect(r.ok).toBe(true);
    expect(r.wmCode).toBe(WM);
  });

  it("survives a screenshot simulation", () => {
    const r = extractRaster(screenshotAttack(marked), KEY, { searchScales: false });
    expect(r.ok).toBe(true);
    expect(r.wmCode).toBe(WM);
  });

  it("survives JPEG Q75 + resize 80% (the PoC leak simulation)", () => {
    const leaked = jpegAttack(resizeAttack(marked, 0.8), 75);
    const r = extractRaster(leaked, KEY);
    expect(r.ok).toBe(true);
    expect(r.wmCode).toBe(WM);
  });

  it("fails CRC on an unwatermarked image (false positive guard)", () => {
    const r = extractRaster(makeSamplePage(512, 512, 99), KEY, {
      searchScales: false,
      maxPasses: 64,
    });
    expect(r.ok).toBe(false);
  });

  it("is key-dependent (wrong key finds nothing)", () => {
    const wrong = new Uint8Array(32).fill(8);
    const r = extractRaster(marked, wrong, { searchScales: false, maxPasses: 64 });
    expect(r.ok).toBe(false);
  });

  it("embed is deterministic", () => {
    const again = embedRaster(sample, { keyWm: KEY, payload80: buildPayload80(WM) });
    expect(Buffer.from(again.data)).toEqual(Buffer.from(marked.data));
  });

  it("jpeg encode/decode round trip is lossy but stable", () => {
    const back = jpegAttack(sample, 95);
    expect(back.width).toBe(sample.width);
    expect(psnr(sample, back)).toBeGreaterThan(35);
    expect(toJpeg(sample, 90).length).toBeGreaterThan(0);
  });
});

describe("text watermark (zero-width, fragile)", () => {
  const text = "Operation Firewall 2026 - counter intelligence report - confidential";
  it("round trips", () => {
    const marked = embedText(text, WM, KEY);
    expect(marked.replace(/[\u200b\u200c]/g, "")).toBe(text);
    const r = extractText(marked);
    expect(r.ok).toBe(true);
    expect(r.wmCode).toBe(WM);
  });

  it("returns not ok on plain text", () => {
    expect(extractText(text).ok).toBe(false);
  });
});
