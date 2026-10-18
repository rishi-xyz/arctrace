import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(webRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const publicDir = resolve(webRoot, 'public');

mkdirSync(publicDir, { recursive: true });
copyFileSync(source, resolve(publicDir, 'pdf.worker.mjs'));
