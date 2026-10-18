import { PNG } from "pngjs";
import type { ImageDataLike } from "@arctrace/watermark";

/**
 * Encode/decode helpers between ImageDataLike (RGBA) and PNG bytes.
 *
 * pngjs' sync API is typed against the full PNG class rather than the minimal
 * input it actually reads, so the cast is isolated here instead of scattering
 * through the PoC CLI.
 */
export function pngBytes(img: ImageDataLike): Uint8Array {
  const input = {
    width: img.width,
    height: img.height,
    data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length),
  } as unknown as PNG;
  const png = PNG.sync.write(input);
  return new Uint8Array(png);
}

export function pngToImage(bytes: Uint8Array): ImageDataLike {
  const png = PNG.sync.read(Buffer.from(bytes));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
  };
}
