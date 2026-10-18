/**
 * L2 raster watermark: differential DCT embedding per spec.md section 5.2.
 *
 * Embedding: every non-flat 8x8 luma block carries one payload bit, chosen by
 * a keyed PRNG over the block's absolute grid coordinates (by*65536 + bx), in
 * the difference of two mid-frequency DCT coefficients C1 and C2 (a (u,v)
 * coefficient and its mirror (v,u)). For bit 1 the difference is forced
 * >= +delta, for bit 0 <= -delta. Every block repeats the same 80-bit
 * payload, so losing border blocks (crop) only costs votes.
 *
 * Extraction: recompute differences, majority-vote per bit, verify the CRC.
 * A search over grid offsets (dx,dy), resample scales, and plan offsets
 * (kx,ky) recovers the alignment. Plan offsets model the unknown block-grid
 * translation introduced by cropping: after a crop, the block that extraction
 * calls (bx,by) was block (bx+kx, by+ky) at embed time, and the keyed plan
 * must be re-derived with the original coordinates. See docs/decisions.md
 * D-013 for why the extraction searches (kx,ky) instead of assuming the
 * grids line up.
 */
import { WM_CONFIG, type ImageDataLike } from "./config.js";
import { applyLuma, dct8x8, idct8x8, lumaPlane, resizeRgba } from "./dct.js";
import { prngU32 } from "./prng.js";
import { buildPayload80, decodePayload80, PAYLOAD_BITS } from "./payload.js";

export interface EmbedOptions {
  keyWm: Uint8Array;
  payload80: Uint8Array; // 80 bits of 0/1
  strength?: number; // multiplier on delta
}

export interface ExtractResult {
  ok: boolean;
  wmCode?: string;
  confidence: number; // fraction of bit-votes agreeing with the final bits
  votes: number[]; // net votes per bit (+ for 1, - for 0)
  alignment: { dx: number; dy: number; scale: number; kx: number; ky: number };
}

/** Block coordinates are packed as by*GRID_STRIDE + bx before they enter the
 *  keyed PRNG, so the plan is a pure function of the absolute grid position. */
const GRID_STRIDE = 65536;

function cloneImg(img: ImageDataLike): ImageDataLike {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

function deltaFor(variance: number, strength: number): number {
  const activity = Math.min(1, variance / 1000);
  const d = WM_CONFIG.baseDelta * (1 + activity) * strength;
  return Math.max(WM_CONFIG.minDelta, Math.min(WM_CONFIG.maxDelta, d));
}

/** Row-major index of DCT coefficient (u,v). */
function coeffIdx(u: number, v: number): number {
  return v * 8 + u;
}

/** Per block: which candidate pair (index into WM_CONFIG.pairs) and which bit. */
function blockPlan(
  keyWm: Uint8Array,
  bx: number,
  by: number,
): { pairIdx: number; bitIdx: number } {
  const idx = by * GRID_STRIDE + bx;
  return {
    pairIdx: prngU32(keyWm, 1, idx) % WM_CONFIG.pairs.length,
    bitIdx: prngU32(keyWm, 2, idx) % PAYLOAD_BITS,
  };
}

/** Embed the 80-bit payload into an RGBA image. Returns a new image. */
export function embedRaster(img: ImageDataLike, opts: EmbedOptions): ImageDataLike {
  const { keyWm, payload80 } = opts;
  if (payload80.length !== PAYLOAD_BITS) throw new Error("payload must be 80 bits");
  const strength = opts.strength ?? 1;
  const out = cloneImg(img);
  const y = lumaPlane(img.data, img.width, img.height);
  const newY = Float64Array.from(y);
  const blocksX = Math.floor(img.width / 8);
  const blocksY = Math.floor(img.height / 8);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const [variance, mean] = blockStats(y, img.width, bx * 8, by * 8);
      if (skipBlock(variance, mean)) continue;

      const { pairIdx, bitIdx } = blockPlan(keyWm, bx, by);
      const [u, v] = WM_CONFIG.pairs[pairIdx]!;
      const i1 = coeffIdx(u, v);
      const i2 = coeffIdx(v, u);
      const bit = payload80[bitIdx]!;
      const delta = deltaFor(variance, strength);

      // gather the block
      const block = new Float64Array(64);
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) block[j * 8 + i] = y[(by * 8 + j) * img.width + (bx * 8 + i)]!;

      const coeff = dct8x8(block);
      const diff = coeff[i1]! - coeff[i2]!;
      const target = bit === 1 ? delta : -delta;
      if ((bit === 1 && diff < target) || (bit === 0 && diff > target)) {
        const shift = Math.ceil((target - diff) / 2);
        coeff[i1] = coeff[i1]! + shift;
        coeff[i2] = coeff[i2]! - shift;
      }
      const rec = idct8x8(coeff);
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) newY[(by * 8 + j) * img.width + (bx * 8 + i)] = rec[j * 8 + i]!;
    }
  }

  applyLuma(out.data, img.width, img.height, y, newY);
  return out;
}

/** Mean and variance of the 8x8 luma block whose top-left pixel is (px,py). */
function blockStats(y: Float64Array, width: number, px: number, py: number): [number, number] {
  let sum = 0;
  let sumSq = 0;
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const v = y[(py + j) * width + (px + i)]!;
      sum += v;
      sumSq += v * v;
    }
  }
  const mean = sum / 64;
  return [sumSq / 64 - mean * mean, mean];
}

/** Blocks the embedder must not touch (and the extractor must not trust):
 *  flat regions, and near-saturated luma where the differential cannot be
 *  expressed without clamping (decision D-015). Embed and extract apply the
 *  identical predicate so the vote sets match. */
function skipBlock(variance: number, mean: number): boolean {
  return (
    variance < WM_CONFIG.minVariance ||
    mean >= WM_CONFIG.lumaSkipHi ||
    mean <= WM_CONFIG.lumaSkipLo
  );
}

function decodeFromVotes(
  votes: number[],
  weights: number[],
): { ok: boolean; confidence: number; wmCode?: string } {
  const bits = new Uint8Array(PAYLOAD_BITS);
  let agree = 0;
  let total = 0;
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    bits[i] = votes[i]! >= 0 ? 1 : 0;
    agree += bits[i] === 1 ? votes[i]! : -votes[i]!;
    total += weights[i]!;
  }
  const confidenceOf = (b: Uint8Array) => {
    let a = 0;
    for (let i = 0; i < PAYLOAD_BITS; i++) a += b[i] === 1 ? votes[i]! : -votes[i]!;
    return total > 0 ? a / total : 0;
  };
  let wmCode = decodePayload80(bits) ?? undefined;
  if (wmCode === undefined) {
    // CRC-aided list decode: under heavy attacks one or two marginal bits
    // can lose their majority even though the watermark is intact. Try
    // flipping small sets of the least-certain bits and let CRC16 arbitrate
    // (decision D-019). The confidence gate still applies afterwards.
    const order = [...Array(PAYLOAD_BITS).keys()].sort(
      (a, b) =>
        Math.abs(votes[a]!) / Math.max(weights[a]!, 1e-9) -
        Math.abs(votes[b]!) / Math.max(weights[b]!, 1e-9),
    );
    const trial = Uint8Array.from(bits);
    for (const flip of flippedSets(order)) {
      trial.set(bits);
      for (const i of flip) trial[i] = trial[i]! ^ 1;
      const code = decodePayload80(trial);
      if (code !== null) {
        wmCode = code;
        bits.set(trial);
        break;
      }
    }
  }
  return { ok: wmCode !== undefined, confidence: confidenceOf(bits), wmCode };
}

/** Flip sets of size 1 and 2 over the 10 least-certain bits (65 trials). */
function flippedSets(order: number[]): number[][] {
  const top = order.slice(0, 10);
  const out: number[][] = [];
  for (const a of top) out.push([a]);
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++) out.push([top[i]!, top[j]!]);
  return out;
}

interface Grid {
  diffs: Float64Array; // per block, one differential per candidate pair
  usable: Uint8Array;
  /** Extraction-side vote scale: blocks with clipped pixels (at 0 or 255)
   *  are exactly the ones where the forced differential was partially
   *  destroyed by clamping during embed, so their sign is the least
   *  reliable (decision D-018). */
  wScale: Float64Array;
  blocksX: number;
  blocksY: number;
}

/**
 * Extract a watermark. The search runs in three phases so cheap, likely
 * candidates are tried before expensive ones (decision D-016):
 *
 *   A: every scale at pixel offset (0,0) and plan offset (0,0)
 *      — identity, JPEG, grayscale, noise, and aligned resizes.
 *   B: scale 1 at every 8x8 pixel offset, plan offset (0,0)
 *      — screenshots and pure translations.
 *   C: scale 1 at every pixel offset with the full plan-offset (kx,ky)
 *      — crops, where the block grid itself shifted.
 *
 * A CRC pass is only reported as a decode when the vote confidence also
 * clears `minExtractConfidence`: noise candidates occasionally pass CRC16.
 */
export function extractRaster(
  img: ImageDataLike,
  keyWm: Uint8Array,
  opts: { searchScales?: boolean; maxPasses?: number } = {},
): ExtractResult {
  const searchScales = opts.searchScales ?? true;
  const K = WM_CONFIG.planOffsetMax;
  const offsets = WM_CONFIG.offsets;
  const gate = WM_CONFIG.minExtractConfidence;

  // Scale 1 always first, then candidate rescales ordered by distance from
  // 1 (mild resizes are far more common than extreme ones).
  const scales: number[] = [1];
  if (searchScales) {
    const lo = Math.round(WM_CONFIG.scaleMin * 100);
    const hi = Math.round(WM_CONFIG.scaleMax * 100);
    for (let c = lo; c <= hi; c++) if (c !== 100) scales.push(c / 100);
    scales.sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1));
  }
  const maxPasses =
    opts.maxPasses ?? scales.length * 9 * offsets * offsets * (K + 1) * (K + 1) * 2;

  let best: ExtractResult = {
    ok: false,
    confidence: 0,
    votes: [],
    alignment: { dx: 0, dy: 0, scale: 1, kx: 0, ky: 0 },
  };

  // Memoize the keyed plan: it is a pure function of (key, bx, by) and the
  // search revisits coordinates across offsets/scales/plan-offsets.
  const planMemo = new Map<number, { pairIdx: number; bitIdx: number }>();
  const plan = (bx: number, by: number) => {
    const idx = by * GRID_STRIDE + bx;
    let p = planMemo.get(idx);
    if (!p) {
      p = blockPlan(keyWm, bx, by);
      planMemo.set(idx, p);
    }
    return p;
  };

  const npairs = WM_CONFIG.pairs.length;
  const votes = new Array<number>(PAYLOAD_BITS).fill(0);
  const weights = new Array<number>(PAYLOAD_BITS).fill(0);
  let passes = 0;

  /** One DCT per usable block; store the differential for every candidate
   *  pair so the plan-offset search stays cheap. */
  const computeGrid = (y: Float64Array, w: number, h: number, dx: number, dy: number): Grid | null => {
    const blocksX = Math.floor((w - dx) / 8);
    const blocksY = Math.floor((h - dy) / 8);
    if (blocksX < 8 || blocksY < 8) return null;
    const grid: Grid = {
      diffs: new Float64Array(blocksX * blocksY * npairs),
      usable: new Uint8Array(blocksX * blocksY),
      wScale: new Float64Array(blocksX * blocksY),
      blocksX,
      blocksY,
    };
    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const px = dx + bx * 8;
        const py = dy + by * 8;
        const [variance, mean] = blockStats(y, w, px, py);
        if (skipBlock(variance, mean)) continue;
        const block = new Float64Array(64);
        let clipped = 0;
        for (let j = 0; j < 8; j++)
          for (let i = 0; i < 8; i++) {
            const p = y[(py + j) * w + (px + i)]!;
            block[j * 8 + i] = p;
            if (p >= 254 || p <= 1) clipped++;
          }
        const coeff = dct8x8(block);
        const b = by * blocksX + bx;
        grid.usable[b] = 1;
        grid.wScale[b] = clipped >= 8 ? 0.25 : 1;
        for (let p = 0; p < npairs; p++) {
          const [u, v] = WM_CONFIG.pairs[p]!;
          grid.diffs[b * npairs + p] = coeff[coeffIdx(u, v)]! - coeff[coeffIdx(v, u)]!;
        }
      }
    }
    return grid;
  };

  /** Vote the grid at plan offset (kx,ky). Returns an accepted decode, or
   *  null to keep searching; "cap" means the pass budget is exhausted. */
  const voteGrid = (
    grid: Grid,
    scale: number,
    dx: number,
    dy: number,
    kx: number,
    ky: number,
  ): ExtractResult | null | "cap" => {
    if (passes++ > maxPasses) return "cap";
    votes.fill(0);
    weights.fill(0);
    for (let by = 0; by < grid.blocksY; by++) {
      for (let bx = 0; bx < grid.blocksX; bx++) {
        const b = by * grid.blocksX + bx;
        if (!grid.usable[b]) continue;
        const { pairIdx, bitIdx } = plan(bx + kx, by + ky);
        const d = grid.diffs[b * npairs + pairIdx]!;
        const w = Math.min(Math.abs(d), WM_CONFIG.maxDelta * 3) * grid.wScale[b]!;
        votes[bitIdx] = votes[bitIdx]! + (d > 0 ? w : -w);
        weights[bitIdx] = weights[bitIdx]! + w;
      }
    }
    const { ok, confidence, wmCode } = decodeFromVotes(votes, weights);
    const alignment = { dx, dy, scale, kx, ky };
    if (confidence > best.confidence)
      best = { ok: false, confidence, votes: [...votes], alignment };
    if (ok && confidence >= gate)
      return { ok: true, wmCode, confidence, votes: [...votes], alignment };
    return null;
  };

  // --- Phase A: every scale at (0,0)/(0,0) ----------------------------------
  // Only scale 1 is reused by later phases, so only it is cached.
  let s1: { w: number; h: number; y: Float64Array } | null = null;
  const scaledAt = (scale: number, wTarget?: number, hTarget?: number) => {
    if (scale !== 1) {
      const ww = wTarget ?? Math.round(img.width * scale);
      const wh = hTarget ?? Math.round(img.height * scale);
      const s = resizeRgba(img, Math.max(64, ww), Math.max(64, wh));
      return { w: s.width, h: s.height, y: lumaPlane(s.data, s.width, s.height) };
    }
    s1 ??= { w: img.width, h: img.height, y: lumaPlane(img.data, img.width, img.height) };
    return s1;
  };
  for (const scale of scales) {
    if (scale === 1) {
      const { w, h, y } = scaledAt(1);
      const grid = computeGrid(y, w, h, 0, 0);
      if (grid) {
        const r = voteGrid(grid, scale, 0, 0, 0, 0);
        if (r === "cap") return best;
        if (r) return r;
      }
      continue;
    }
    // Two-decimal scales cannot always restore the exact attacked size
    // (410 x 1.25 -> 513, one pixel off), and a 1 px size error halves the
    // vote confidence, so also try the adjacent widths AND heights
    // (decision D-017).
    const nW = Math.round(img.width * scale);
    const nH = Math.round(img.height * scale);
    for (const wTarget of [nW - 1, nW, nW + 1]) {
      for (const hTarget of [nH - 1, nH, nH + 1]) {
        const { w, h, y } = scaledAt(scale, wTarget, hTarget);
        const grid = computeGrid(y, w, h, 0, 0);
        if (grid) {
          const r = voteGrid(grid, scale, 0, 0, 0, 0);
          if (r === "cap") return best;
          if (r) return r;
        }
      }
    }
  }

  // --- Phase B: scale 1 at every pixel offset, plan (0,0) -------------------
  {
    const { w, h, y } = scaledAt(1);
    for (let dy = 0; dy < offsets; dy++) {
      for (let dx = 0; dx < offsets; dx++) {
        if (dx === 0 && dy === 0) continue; // phase A already did this
        const grid = computeGrid(y, w, h, dx, dy);
        if (!grid) continue;
        const r = voteGrid(grid, 1, dx, dy, 0, 0);
        if (r === "cap") return best;
        if (r) return r;
      }
    }
  }

  // --- Phase C: scale 1, full plan-offset range (crop translation) ----------
  {
    const { w, h, y } = scaledAt(1);
    for (let dy = 0; dy < offsets; dy++) {
      for (let dx = 0; dx < offsets; dx++) {
        const grid = computeGrid(y, w, h, dx, dy);
        if (!grid) continue;
        for (let ky = 0; ky <= K; ky++) {
          for (let kx = 0; kx <= K; kx++) {
            if (kx === 0 && ky === 0) continue; // phase A/B already did this
            const r = voteGrid(grid, 1, dx, dy, kx, ky);
            if (r === "cap") return best;
            if (r) return r;
          }
        }
      }
    }
  }

  // Nothing cleared the gate: fail closed with the strongest candidate seen.
  return best;
}

/** Convenience: embed a wmCode hex directly. */
export function embedWmCode(
  img: ImageDataLike,
  wmCodeHex: string,
  keyWm: Uint8Array,
): ImageDataLike {
  return embedRaster(img, { keyWm, payload80: buildPayload80(wmCodeHex) });
}
