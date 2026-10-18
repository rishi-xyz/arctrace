#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { verifyBundleZip } from './index.js';

if (existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch { /* environment may already be loaded */ }
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  console.log('Usage: arctrace-verify <bundle.zip> [--offline]');
  console.log('Offline mode verifies signatures and the included ledger proofs.');
  console.log('Default mode also checks the decryption entity using the configured ledger adapter.');
  process.exit(args.includes('--help') ? 0 : 2);
}
const offline = args.includes('--offline');
const path = args.find((arg) => !arg.startsWith('--'));
if (!path) throw new Error('Provide an evidence bundle ZIP path.');

try {
  const bytes = new Uint8Array(await readFile(path));
  const result = await verifyBundleZip(bytes, { online: !offline });
  for (const item of result.checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
  console.log(`${result.valid ? 'VERIFIED' : 'INVALID'} (${result.mode})`);
  process.exitCode = result.valid ? 0 : 1;
} catch (error) {
  console.error(`INVALID: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
