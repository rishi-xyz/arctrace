import type { RouteApp } from '../compat.js';
import type { ReadyResponse } from '@arctrace/shared';
import { pingDb } from '../db/index.js';
import { ensureBucket } from '../lib/s3.js';
import { ledgerStatus } from '../lib/status.js';
import { createPublicClient, formatEther, http } from 'viem';
import { tiramisu } from '@arkiv-network/sdk/chains';
import type { Ctx } from '../types.js';

export async function healthRoutes(app: RouteApp, ctx: Ctx): Promise<void> {
  /** Public demo funding status. The writer address and balance are public chain data. */
  app.get('/public/status', async () => {
    const status = await ledgerStatus(ctx.config);
    const address = status.writers[0] ?? null;
    let balance: string | null = null;
    if (address && status.mode === 'arkiv') {
      try {
        const client = createPublicClient({ chain: tiramisu, transport: http(ctx.config.arkivRpcUrl) });
        balance = formatEther(await client.getBalance({ address: address as `0x${string}` }));
      } catch {
        balance = null;
      }
    }
    return {
      ledgerMode: status.mode,
      ledgerOnline: status.ok,
      writerAddress: address,
      glmBalance: balance,
      explorerUrl: status.explorerUrl,
    };
  });

  /** Liveness — no dependencies (spec §6). */
  app.get('/healthz', async () => ({ status: 'ok', at: new Date().toISOString() }));

  /** Readiness — DB, ledger (fail closed), object storage (spec §6). */
  app.get('/readyz', async (): Promise<ReadyResponse> => {
    const checks: ReadyResponse['checks'] = [];

    const dbT0 = Date.now();
    let dbOk = false;
    let dbDetail = '';
    try {
      await pingDb(ctx.db);
      dbOk = true;
      dbDetail = 'postgres reachable';
    } catch (err) {
      dbDetail = (err as Error).message;
    }
    checks.push({ name: 'postgres', ok: dbOk, detail: dbDetail, latencyMs: Date.now() - dbT0 });

    let ledger: Awaited<ReturnType<typeof ledgerStatus>>;
    try {
      ledger = await ledgerStatus(ctx.config);
    } catch (err) {
      ledger = {
        mode: 'mock',
        ok: false,
        latencyMs: 0,
        writers: [],
        explorerUrl: ctx.config.explorerUrl,
        gateMode: ctx.config.gateMode,
      };
      void err;
    }
    checks.push({
      name: `ledger (${ledger.mode})`,
      ok: ledger.ok && ledger.writers.length > 0,
      detail: ledger.ok
        ? `${ledger.writers.length} trusted writer(s), latency ${ledger.latencyMs} ms`
        : 'ledger unreachable or unconfigured — fail closed',
      latencyMs: ledger.latencyMs,
    });

    const s3T0 = Date.now();
    let s3Ok = false;
    let s3Detail = '';
    try {
      await ensureBucket(ctx.config);
      s3Ok = true;
      s3Detail = `bucket "${ctx.config.s3.bucket}" present`;
    } catch (err) {
      s3Detail = (err as Error).message;
    }
    checks.push({ name: 'object storage', ok: s3Ok, detail: s3Detail, latencyMs: Date.now() - s3T0 });

    return { ok: checks.every((c) => c.ok), checks };
  });
}
