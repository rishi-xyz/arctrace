import type { LedgerStatus } from '@arctrace/shared';
import type { ApiConfig } from '../config.js';
import { getLedger, ledgerMode, ledgerReady, trustedWriters } from './ledger.js';

/**
 * Status panel data (spec §6 /readyz + embedded in key & commit responses).
 * Never throws: an unreachable ledger reports ok=false so the UI can fail
 * closed visibly.
 */
export async function ledgerStatus(config: ApiConfig): Promise<LedgerStatus> {
  if (!ledgerReady()) {
    return {
      mode: 'mock',
      ok: false,
      latencyMs: 0,
      writers: [],
      explorerUrl: config.explorerUrl,
      gateMode: config.gateMode,
    };
  }
  let ok = false;
  let latencyMs = 0;
  try {
    const h = await getLedger().health();
    ok = h.ok;
    latencyMs = h.latencyMs;
  } catch {
    ok = false;
  }
  return {
    mode: ledgerMode(),
    ok,
    latencyMs,
    writers: trustedWriters(),
    explorerUrl: config.explorerUrl,
    gateMode: config.gateMode,
  };
}

/** Explorer deep link for an entity (mock mode has no explorer). */
export function entityLink(config: ApiConfig, entityKey: string): string {
  return `${config.explorerUrl.replace(/\/$/, '')}/entity/${entityKey}`;
}
