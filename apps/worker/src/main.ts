import { loadConfig, loadDotEnv } from 'arctrace-api/config';
import { createDb } from 'arctrace-api/db';
import { initLedger } from 'arctrace-api/ledger';
import { claimNextTrace, processTrace } from './trace.js';
import { drainOutboxOnce } from './outbox.js';

const POLL_MS = 1_000;
let running = true;

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  await initLedger(config);
  console.log(`[worker] ready (ledger: ${config.ledgerMode}); API service owns database migrations`);

  while (running) {
    let worked = false;
    try {
      const stats = await drainOutboxOnce(db, config);
      if (stats) {
        worked = true;
        if (stats.committed || stats.parked) {
          console.log(`[worker] outbox committed=${stats.committed} parked=${stats.parked}`);
        }
      }
    } catch (err) {
      console.error('[worker] outbox pass failed', { message: (err as Error).message.slice(0, 300) });
    }

    try {
      const traceId = await claimNextTrace(db);
      if (traceId) {
        worked = true;
        await processTrace(db, config, traceId);
        console.log(`[worker] trace processed ${traceId}`);
      }
    } catch (err) {
      console.error('[worker] trace pass failed', { message: (err as Error).message.slice(0, 300) });
    }

    if (!worked && running) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function stop(signal: string) {
  console.log(`[worker] ${signal} — stopping`);
  running = false;
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

main().then(() => process.exit(0)).catch((err) => {
  console.error('[worker] startup failed', { message: (err as Error).message.slice(0, 500) });
  process.exit(1);
});
