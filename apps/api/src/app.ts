/**
 * Fastify app factory. `buildApp` is shared by main.ts (real server) and the
 * integration tests (in-process inject) so both see identical routes,
 * guards, validation and the `{ error: { code, message } }` envelope.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { ApiConfig } from './config.js';
import { createDb, type Db } from './db/index.js';
import { makeAuthGuard } from './lib/auth.js';
import { registerErrorHandler } from './lib/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { healthRoutes } from './routes/health.js';
import { keysRoutes } from './routes/keys.js';
import { ledgerRoutes } from './routes/ledger.js';
import { openRoutes } from './routes/open.js';
import { orgRoutes } from './routes/org.js';
import { traceRoutes } from './routes/traces.js';
import type { Ctx } from './types.js';

export interface BuildOptions {
  /** Inject a test database; otherwise one is created from config. */
  db?: Db;
  logger?: boolean;
}

export async function buildApp(config: ApiConfig, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const useLogger = opts.logger !== undefined ? opts.logger : config.env !== 'test';
  const logger = useLogger
    ? {
        level: config.env === 'production' ? 'info' : 'debug',
        // Never log bodies, cookies or authorization headers (spec §10).
        redact: {
          paths: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers["x-csrf-token"]',
            'req.body',
            'res.body',
          ],
          censor: '[redacted]',
        },
        transport:
          config.env === 'development'
            ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
            : undefined,
      }
    : false;

  const app = Fastify({
    logger: logger as never,
    bodyLimit: 8 * 1024 * 1024, // JSON only; files go via multipart or presigned PUT
    trustProxy: false,
  });

  await app.register(cookie, {});
  await app.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'PUT'],
  });
  await app.register(multipart, {
    limits: { fileSize: config.traceMaxBytes, files: 1 },
  });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  const db = opts.db ?? createDb(config.databaseUrl);
  const ctx: Ctx = { config, db };

  app.decorate('authenticate', makeAuthGuard(config, db));
  registerErrorHandler(app);

  await app.register(
    async (v1) => {
      await healthRoutes(v1, ctx);
      await authRoutes(v1, ctx);
      await keysRoutes(v1, ctx);
      await orgRoutes(v1, ctx);
      await documentRoutes(v1, ctx);
      await openRoutes(v1, ctx);
      await traceRoutes(v1, ctx);
      await ledgerRoutes(v1, ctx);
    },
    { prefix: '/v1' },
  );

  await app.ready();
  return app;
}
