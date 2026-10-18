import { embedWmCode } from '@arctrace/watermark';

self.onmessage = (event: MessageEvent<{ image: ImageData; wmCode: string; keyWm: Uint8Array }>) => {
  try {
    const marked = embedWmCode(event.data.image, event.data.wmCode, event.data.keyWm);
    // The watermark package returns an ImageDataLike object, not a native
    // ImageData instance. Send its pixels and dimensions for reconstruction on
    // the main thread before calling CanvasRenderingContext2D.putImageData.
    self.postMessage({ ok: true, image: marked }, [marked.data.buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Watermark failed' });
  }
};
