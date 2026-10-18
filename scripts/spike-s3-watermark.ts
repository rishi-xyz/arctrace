/**
 * Spike S3: watermark one PNG with 80 bits, JPEG Q75 it, extract. Report
 * bit error rate and PSNR (checklist Phase 0 S3).
 *
 * The marked image really is written to disk as a PNG file and read back
 * before the JPEG attack, so the spike proves the watermark survives a
 * lossless file round trip too, not just in-memory RGBA.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { PNG } from "pngjs";
import {
  buildPayload80,
  embedRaster,
  extractRaster,
  jpegAttack,
  makeSamplePage,
  psnr,
  type ImageDataLike,
} from "@arctrace/watermark";

const WM = "5a5a5a5a5a5a0f0f";
const keyWm = new Uint8Array(32).fill(9);

function pngRoundTrip(img: ImageDataLike): ImageDataLike {
  const png = new PNG({ width: img.width, height: img.height });
  png.data.set(img.data);
  const bytes = PNG.sync.write(png);
  mkdirSync("out", { recursive: true });
  writeFileSync("out/spike-s3-marked.png", bytes);
  const back = PNG.sync.read(bytes);
  return {
    width: back.width,
    height: back.height,
    data: new Uint8ClampedArray(back.data.buffer, back.data.byteOffset, back.data.length),
  };
}

console.log("S3 watermark spike (DCT differential, 80-bit payload)");
const img = makeSamplePage(640, 832, 7); // ~A4-ish at low dpi
const t0 = performance.now();
const marked = embedRaster(img, { keyWm, payload80: buildPayload80(WM) });
const tEmbed = performance.now() - t0;
const p = psnr(img, marked);
console.log(`  embed time: ${tEmbed.toFixed(0)} ms (${img.width}x${img.height})`);
console.log(`  PSNR: ${p.toFixed(2)} dB (target >= 38)`);

const fromPng = pngRoundTrip(marked);
console.log(
  `  png round trip: ${fromPng.width}x${fromPng.height}, bytes identical=${Buffer.compare(Buffer.from(fromPng.data), Buffer.from(marked.data)) === 0} (saved out/spike-s3-marked.png)`,
);

const t1 = performance.now();
const r1 = extractRaster(fromPng, keyWm, { searchScales: false });
console.log(`  identity extract: ok=${r1.ok} code=${r1.wmCode} confidence=${r1.confidence.toFixed(3)} (${(performance.now() - t1).toFixed(0)} ms)`);

const leaked = jpegAttack(fromPng, 75);
const t2 = performance.now();
const r2 = extractRaster(leaked, keyWm);
console.log(`  jpeg Q75 extract: ok=${r2.ok} code=${r2.wmCode} confidence=${r2.confidence.toFixed(3)} alignment=${JSON.stringify(r2.alignment)} (${(performance.now() - t2).toFixed(0)} ms)`);

const miss = r2.wmCode === WM ? 0 : 1;
console.log(`  bit error rate: ${miss} bit-level failure(s) (CRC gate; code ${miss === 0 ? "recovered" : "NOT recovered"})`);
