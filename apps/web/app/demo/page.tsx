'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, ArrowLeft, LoaderCircle, ShieldCheck } from 'lucide-react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { aesGcmDecrypt, aesGcmEncrypt, bytesToHex, randomBytes } from '@arctrace/crypto';
import { Badge, Button, Card } from '../../components/ui';

export default function DemoPage() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [watermarkCode, setWatermarkCode] = useState('');

  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  const makeSample = async () => {
    setWorking(true); setError('');
    let plaintext: Uint8Array | undefined;
    let dek: Uint8Array | undefined;
    let keyWm: Uint8Array | undefined;
    try {
      const sample = await PDFDocument.create();
      const font = await sample.embedFont(StandardFonts.Helvetica);
      const page = sample.addPage([612, 792]);
      page.drawText('ArcTrace sample brief', { x: 56, y: 710, size: 26, font, color: rgb(0.07, 0.14, 0.12) });
      page.drawText('A safe public example for trying the encrypted document viewer.', { x: 56, y: 674, size: 12, font, color: rgb(0.32, 0.42, 0.36) });
      page.drawText('This sample is generated in your browser. It contains no private information.', { x: 56, y: 640, size: 11, font, color: rgb(0.32, 0.42, 0.36) });
      page.drawRectangle({ x: 56, y: 520, width: 500, height: 78, color: rgb(0.93, 0.96, 0.93) });
      page.drawText('Share securely  ·  Record an authorized open  ·  Download a watermarked copy', { x: 72, y: 555, size: 11, font, color: rgb(0.12, 0.25, 0.19) });
      page.drawText('ArcTrace cannot prevent copying or screen capture.', { x: 56, y: 72, size: 9, font, color: rgb(0.48, 0.54, 0.5) });

      plaintext = new Uint8Array(await sample.save());
      dek = randomBytes(32);
      const aad = new TextEncoder().encode('public-arctrace-demo-v1');
      const encrypted = aesGcmEncrypt(dek, plaintext, aad);
      const decrypted = aesGcmDecrypt(dek, encrypted.nonce, encrypted.ct, aad);
      keyWm = randomBytes(32);
      const code = bytesToHex(randomBytes(8));
      const { watermarkPdf } = await import('../../lib/open');
      const output = await watermarkPdf(decrypted, code, keyWm);
      const nextUrl = URL.createObjectURL(output);
      setDownloadUrl((old) => { if (old) URL.revokeObjectURL(old); return nextUrl; });
      setWatermarkCode(code);
      decrypted.fill(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the sample document.');
    } finally {
      plaintext?.fill(0); dek?.fill(0); keyWm?.fill(0); setWorking(false);
    }
  };

  return <main className="min-h-screen bg-paper px-5 py-8 md:px-8 md:py-12"><div className="mx-auto max-w-[980px]">
    <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-[#69776e] hover:text-ink"><ArrowLeft size={15} /> ArcTrace home</Link>
    <div className="mt-8 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-white"><ShieldCheck size={19} /></span><div><div className="text-lg font-semibold tracking-[-.04em]">ArcTrace sample demo</div><div className="text-xs text-[#89938c]">A quick, safe preview of the watermarked document flow</div></div></div>
    <div className="mt-7 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <Card className="p-6"><Badge tone="green">PUBLIC SAMPLE · NO SIGN-IN</Badge><h1 className="mt-4 text-2xl font-semibold tracking-[-.04em]">Try a watermarked copy</h1><p className="mt-3 text-sm leading-6 text-[#748078]">ArcTrace creates a sample PDF in this browser, encrypts and decrypts it locally, then embeds a unique invisible watermark. Nothing is uploaded and no ledger record is created in this quick demo.</p><Button disabled={working} onClick={() => void makeSample()} className="mt-6 w-full">{working ? <LoaderCircle size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{working ? 'Preparing sample…' : downloadUrl ? 'Create another sample copy' : 'Encrypt, decrypt & watermark'}</Button>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{watermarkCode && <div className="mt-4 rounded-lg bg-[#eff6ef] p-3 text-xs text-[#476c50]">Watermarked sample ready. Session code <span className="font-mono">{watermarkCode.slice(0, 8)}…</span></div>}<p className="mt-5 text-xs leading-5 text-[#89938c]">For the full account flow, create a workspace to share a document, record an open on Arkiv, and investigate a leaked copy.</p><Button asChild variant="outline" className="mt-3 w-full"><Link href="/auth?mode=register">Create a workspace</Link></Button></Card>
      <Card className="overflow-hidden">{downloadUrl ? <><div className="flex items-center justify-between border-b border-line px-4 py-3"><span className="text-sm font-medium">Watermarked sample brief</span><a href={downloadUrl} download="arctrace-sample-watermarked.pdf" className="inline-flex items-center gap-2 text-xs font-medium text-moss hover:underline"><ArrowDownToLine size={14} />Download PDF</a></div><iframe title="Watermarked ArcTrace sample PDF" src={downloadUrl} className="h-[620px] w-full" /></> : <div className="grid min-h-[420px] place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#edf3ed] text-moss"><ShieldCheck size={23} /></div><div className="mt-4 text-sm font-medium">Your sample preview will appear here</div><p className="mt-2 max-w-[340px] text-xs leading-5 text-[#89938c]">The file stays in this browser. Create a sample copy to preview and download it.</p></div></div>}</Card>
    </div>
  </div></main>;
}
