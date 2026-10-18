/**
 * Tunable watermark parameters (spec.md section 5.2 starting values).
 * Tune with the attack suite; keep them here.
 */
export const WM_CONFIG = {
  /**
   * Candidate C1 DCT coefficient positions (u,v). C2 is the mirror (v,u).
   * All entries have u != v so the differential is never degenerate.
   */
  pairs: [
    [2, 3],
    [1, 4],
    [2, 4],
    [3, 4],
    [3, 1],
    [4, 1],
    [4, 2],
  ] as ReadonlyArray<readonly [number, number]>,
  /** Base differential delta. */
  baseDelta: 8,
  /** Adaptive delta clamp. */
  minDelta: 6,
  maxDelta: 18,
  /** Blocks with variance below this are skipped (flat regions). */
  minVariance: 20,
  /** Blocks whose mean luma is at or beyond these bounds are skipped: they
   *  cannot absorb the luma delta (clamping) but would still vote with their
   *  natural differential at extraction, dragging confidence down. */
  lumaSkipLo: 15,
  lumaSkipHi: 240,
  /** Extraction grid search: offsets and scales. */
  offsets: 8,
  scaleMin: 0.7,
  scaleMax: 1.45,
  scaleStep: 0.01,
  /** Max block-grid translation (in 8x8 blocks) searched at extraction.
   *  8 blocks = 64 px covers a 10%+ center crop on the 512px sample pages. */
  planOffsetMax: 8,
  /** A CRC pass is only accepted as a real decode when the vote confidence
   *  clears this gate; noise candidates occasionally pass CRC16 by luck
   *  (decision D-014). Measured with exhaustive searches: the weakest true
   *  decode (resize 0.8 + JPEG Q75) lands at 0.41, while the strongest
   *  false candidate (unwatermarked image / wrong key, full scale+offset+
   *  plan search) reaches only 0.29. */
  minExtractConfidence: 0.35,
} as const;

export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}
