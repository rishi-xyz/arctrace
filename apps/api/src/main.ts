/**
 * API entrypoint: env → config → migrations → ledger → S3 → listen.
 * LEDGER_MODE=arkiv fails closed at startup (spec §4/§9); mock and auto fall
 * back with a loud warning inside createAdapterFromEnv.
 */
import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { createDb, runMigrations } from './db/index.js';
import { initLedger, ledgerDetail, ledgerMode } from './lib/ledger.js';
import { ensureBucket } from './lib/s3.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();

  const db = createDb(config.databaseUrl);
  if (config.autoMigrate) {
    await runMigrations(db);
    console.log(`[api] migrations applied (${config.env})`);
  }

  const choice = await initLedger(config).then(() => ({ detail: ledgerDetail(), mode: ledgerMode() }));
  console.log(`[api] ledger: ${choice.detail}`);

  await ensureBucket(config);
  console.log(`[api] object storage: ${config.s3.endpoint} bucket "${config.s3.bucket}"`);

  const app = await buildApp(config, { db });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[api] listening on http://localhost:${config.port} (mode: ${choice.mode})`);

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} — shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] failed to start (fail closed):', err);
  process.exit(1);
});
