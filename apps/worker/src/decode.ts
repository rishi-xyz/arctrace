/**
 * Leak-file decoding for the trace worker (spec §5 "trace").
 *
 * png  → pngjs raster (RGBA)
 * jpeg → jpeg-js raster
 * pdf  → pdfjs-dist + @napi-rs/canvas page raster; falls back to the text
 *        layer when a native canvas is unavailable
 * txt  → text; zero-width watermark bits are extracted directly (key-free)
 *
 * Every path is best-effort with explicit errors — the trace result records
 * what was attempted, and an extraction failure is an honest negative, not a
 * worker crash.
 */
import { PNG } from "pngjs";
import { fromJpeg, extractText, type ImageDataLike } from "@arctrace/watermark";

export type DecodedLeak =
  | { kind: "raster"; images: ImageDataLike[]; text: string | null }
  | { kind: "text"; images: null; text: string };

export async function decodeLeak(fileKind: string, bytes: Uint8Array): Promise<DecodedLeak> {
  switch (fileKind) {
    case "png": {
      const png = PNG.sync.read(Buffer.from(bytes));
      return {
        kind: "raster",
        images: [{ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }],
        text: null,
      };
    }
    case "jpeg": {
      return { kind: "raster", images: [fromJpeg(bytes)], text: null };
    }
    case "pdf": {
      const { images, text } = await renderPdf(bytes);
      return { kind: "raster", images, text };
    }
    case "txt": {
      return { kind: "text", images: null, text: new TextDecoder().decode(bytes) };
    }
    default:
      throw new Error(`Unsupported file kind: ${fileKind}`);
  }
}

/** Key-free zero-width extraction — usable even without a raster decode. */
export function extractFromText(text: string): { wmCode?: string; ok: boolean } {
  return extractText(text);
}

async function renderPdf(
  bytes: Uint8Array,
): Promise<{ images: ImageDataLike[]; text: string | null }> {
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (err) {
    throw new Error(`pdf.js unavailable (no PDF rasterization): ${(err as Error).message}`);
  }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const images: ImageDataLike[] = [];
  const textParts: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const { createCanvas } = await import("@napi-rs/canvas");
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");
        // pdf.js render params: the Node canvas context is duck-compatible.
        await page.render({
          canvas: canvas as never,
          canvasContext: ctx as never,
          viewport,
        } as unknown as Parameters<typeof page.render>[0]).promise;
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        images.push({ width: img.width, height: img.height, data: img.data });
      } catch (err) {
        console.warn(`[worker] pdf page ${p} raster failed: ${(err as Error).message}`);
      }
      try {
        const tc = await page.getTextContent();
        textParts.push(tc.items.map((i) => ("str" in i ? i.str : "")).join(""));
      } catch {
        /* text layer optional */
      }
      page.cleanup();
    }
  } finally {
    doc.cleanup();
  }
  return { images, text: textParts.length > 0 ? textParts.join("\n") : null };
}
