import {
  createAdapterFromEnv,
  resolveTrustedWriters,
  type AdapterChoice,
  type LedgerAdapter,
} from '@arctrace/ledger';
import type { ApiConfig } from '../config.js';
import { ledgerUnavailable } from './errors.js';

let choice: AdapterChoice | null = null;
let initialized: Promise<void> | null = null;

/**
 * Process-wide ledger adapter. Reads are fail-closed: if the ledger cannot be
 * reached, requests that depend on it surface LEDGER_UNAVAILABLE (503) rather
 * than falling back to any local cache.
 */
export function getLedger(): LedgerAdapter {
  if (!choice) throw ledgerUnavailable('Ledger adapter not initialized');
  return choice.adapter;
}

export function ledgerMode(): 'arkiv' | 'mock' {
  if (!choice) throw ledgerUnavailable('Ledger adapter not initialized');
  return choice.mode;
}

export function ledgerDetail(): string {
  if (!choice) throw ledgerUnavailable('Ledger adapter not initialized');
  return choice.detail;
}

export async function initLedger(config: ApiConfig): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    choice = await createAdapterFromEnv({
      mode: config.ledgerMode,
      mockFile: config.mockLedgerFile,
    });
  })();
  try {
    await initialized;
  } catch (err) {
    initialized = null;
    throw err;
  }
}

/** Test hook: drop the singleton so a new adapter (config) can be built. */
export function resetLedger(): void {
  choice = null;
  initialized = null;
}

export function ledgerReady(): boolean {
  return choice !== null;
}

export function trustedWriters(): string[] {
  return choice ? resolveTrustedWriters(choice.adapter) : [];
}
