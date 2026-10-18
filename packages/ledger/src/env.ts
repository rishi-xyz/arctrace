/**
 * One place that turns process env into a LedgerAdapter, shared by apps/api,
 * apps/worker and the arctrace-verify CLI (decision D-026).
 *
 * LEDGER_MODE semantics (docs/decisions.md D-006):
 *   arkiv — real Tiramisu testnet; fails closed if unreachable or unconfigured
 *   mock  — in-memory / write-through file mock, explicit
 *   auto  — (default) arkiv when a key is present and healthy, else mock with
 *           a loud warning
 */
import { ArkivAdapter } from "./arkiv.js";
import { MockAdapter } from "./mock.js";
import type { LedgerAdapter } from "./types.js";

export interface AdapterChoice {
  adapter: LedgerAdapter;
  mode: "arkiv" | "mock";
  /** Human-readable description for logs, /readyz and the UI status panel. */
  detail: string;
}

export class LedgerConfigError extends Error {}

export interface AdapterEnvOptions {
  /** Explicit mode; defaults to env LEDGER_MODE ?? "auto". */
  mode?: string;
  /** Mock persistence file (write-through). Omit for memory-only mock. */
  mockFile?: string;
  warn?: (msg: string) => void;
}

export async function createAdapterFromEnv(opts: AdapterEnvOptions = {}): Promise<AdapterChoice> {
  const mode = (opts.mode ?? process.env.LEDGER_MODE ?? "auto").toLowerCase();
  const warn = opts.warn ?? ((m: string) => console.warn(`[ledger] ${m}`));
  const key = process.env.ARKIV_PRIVATE_KEY;
  const wantArkiv = mode === "arkiv" || (mode === "auto" && Boolean(key));

  if (wantArkiv && key) {
    const adapter = new ArkivAdapter({
      privateKey: key as `0x${string}`,
      rpcUrl: process.env.ARKIV_RPC_URL,
      auditor: process.env.ARKIV_AUDITOR as `0x${string}` | undefined,
    });
    const h = await adapter.health();
    if (h.ok) {
      return {
        adapter,
        mode: "arkiv",
        detail: `arkiv (Tiramisu testnet, latency ${h.latencyMs} ms)`,
      };
    }
    if (mode === "arkiv") {
      throw new LedgerConfigError(
        `LEDGER_MODE=arkiv but the network is unreachable (${h.latencyMs} ms) — fail closed`,
      );
    }
    warn(`Arkiv unreachable (${h.latencyMs} ms) — falling back to mock ledger`);
  } else if (wantArkiv) {
    if (mode === "arkiv") {
      throw new LedgerConfigError(
        "LEDGER_MODE=arkiv but ARKIV_PRIVATE_KEY is missing — fail closed",
      );
    }
    warn("LEDGER_MODE=auto with no ARKIV_PRIVATE_KEY — using mock ledger");
  }

  const adapter = new MockAdapter(opts.mockFile ? { file: opts.mockFile } : {});
  return {
    adapter,
    mode: "mock",
    detail: opts.mockFile ? `mock (write-through file ${opts.mockFile})` : "mock (in memory)",
  };
}

/**
 * The trusted `$creator` set every query MUST pass: env TRUSTED_WRITERS
 * (comma-separated) when configured, otherwise the adapter's own writer set.
 */
export function resolveTrustedWriters(adapter: LedgerAdapter): string[] {
  const fromEnv = process.env.TRUSTED_WRITERS;
  if (fromEnv && fromEnv.trim()) {
    const list = fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) return list;
  }
  return adapter.trustedWriters();
}
