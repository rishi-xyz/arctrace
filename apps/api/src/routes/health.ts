import type { RouteApp } from '../compat.js';
import type { ReadyResponse } from '@arctrace/shared';
import { pingDb } from '../db/index.js';
import { ensureBucket } from '../lib/s3.js';
import { ledgerStatus } from '../lib/status.js';
import type { Ctx } from '../types.js';

export async function healthRoutes(app: RouteApp, ctx: Ctx): Promise<void> {
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
