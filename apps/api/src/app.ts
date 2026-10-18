/** Express 5 API server. Route modules are registered through a small adapter
 * so their validation and domain logic remains independent of the HTTP layer. */
import express, { type CookieOptions, type ErrorRequestHandler, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { ApiConfig } from './config.js';
import { createDb, type Db } from './db/index.js';
import { makeAuthGuard } from './lib/auth.js';
import { ApiError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { healthRoutes } from './routes/health.js';
import { keysRoutes } from './routes/keys.js';
import { ledgerRoutes } from './routes/ledger.js';
import { openRoutes } from './routes/open.js';
import { orgRoutes } from './routes/org.js';
import { traceRoutes } from './routes/traces.js';
import type { Ctx } from './types.js';
import type { ApiReply, ApiRequest, RouteApp } from './compat.js';

export interface BuildOptions { db?: Db; logger?: boolean }

function apiErrorHandler(config: ApiConfig): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, _next) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid request payload' } });
      return;
    }
    const anyErr = err as { status?: number; statusCode?: number; code?: string; message?: string; name?: string };
    const status = anyErr.statusCode ?? anyErr.status;
    if (typeof status === 'number' && status < 500) {
      const code = status === 429 ? 'RATE_LIMITED' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED';
      res.status(status).json({ error: { code, message: anyErr.message ?? 'Request rejected' } });
      return;
    }
    // Keep request payloads, cookies and SQL parameters out of server logs.
    if (config.env !== 'test') console.error('[api] request failed', { name: anyErr.name, code: anyErr.code, method: req.method, path: req.path });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal error', requestId: randomUUID() } });
  };
}

/** Translate the shared endpoint declaration contract to Express middleware.
 * All HTTP handling, body parsing, limits, cookies and routing are
 * provided by Express itself. */
function routeAdapter(router: ReturnType<typeof express.Router>, config: ApiConfig, db: Ctx['db']): RouteApp {
  const authenticate = makeAuthGuard(config, db);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.traceMaxBytes, files: 1 } });
  const adapter: RouteApp = {
    authenticate,
    get: ((path: string, optsOrHandler: unknown, maybeHandler?: unknown) => addRoute('get', path, optsOrHandler, maybeHandler)) as RouteApp['get'],
    post: ((path: string, optsOrHandler: unknown, maybeHandler?: unknown) => addRoute('post', path, optsOrHandler, maybeHandler)) as RouteApp['post'],
    delete: ((path: string, optsOrHandler: unknown, maybeHandler?: unknown) => addRoute('delete', path, optsOrHandler, maybeHandler)) as RouteApp['delete'],
  };

  function addRoute(method: 'get' | 'post' | 'delete', path: string, optsOrHandler: unknown, maybeHandler?: unknown) {
    const options = typeof optsOrHandler === 'function' ? {} : (optsOrHandler ?? {}) as { onRequest?: RouteOptions['onRequest']; config?: { rateLimit?: { max: number; timeWindow: string } } };
    const handler = (typeof optsOrHandler === 'function' ? optsOrHandler : maybeHandler) as (req: ApiRequest, reply: ApiReply) => unknown | Promise<unknown>;
    const middlewares: express.RequestHandler[] = [];
    if (options.config?.rateLimit) {
      const duration = options.config.rateLimit.timeWindow.includes('minute') ? 60_000 : 1_000;
      middlewares.push(rateLimit({ windowMs: duration, limit: options.config.rateLimit.max, standardHeaders: 'draft-8', legacyHeaders: false }));
    }
    if (path === '/traces' && method === 'post') {
      middlewares.push(upload.single('file'));
      middlewares.push((req, _res, next) => {
        const file = (req as Request & { file?: Express.Multer.File }).file;
        (req as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined> }).file = async () => file ? ({ filename: file.originalname, toBuffer: async () => file.buffer }) : undefined;
        next();
      });
    }
    if (options.onRequest) {
      middlewares.push((req, res, next) => {
        const reply = makeReply(res);
        Promise.resolve(options.onRequest!(req as unknown as ApiRequest, reply)).then(() => next(), next);
      });
    }
    middlewares.push(async (req, res, next) => {
      try {
        const result = await handler(req as unknown as ApiRequest, makeReply(res));
        if (res.headersSent) return;
        if (res.statusCode === 204 || result === null) res.status(204).end();
        else res.json(result === undefined ? {} : result);
      } catch (err) { next(err); }
    });
    router[method](`/v1${path}`, ...middlewares);
  }
  return adapter;
}

function makeReply(res: Response): ApiReply {
  const reply = {
    status(code: number) { res.status(code); return reply; },
    send(body?: unknown) { res.send(body); return reply; },
    setCookie(name: string, value: string, options: Record<string, unknown>) { res.cookie(name, value, options as unknown as CookieOptions); return reply; },
    clearCookie(name: string, options: Record<string, unknown>) { res.clearCookie(name, options); return reply; },
  };
  return reply;
}

type RouteOptions = { onRequest?: (req: ApiRequest, reply: ApiReply) => void | Promise<void> };

export async function buildApp(config: ApiConfig, opts: BuildOptions = {}) {
  const app = express();
  const router = express.Router();
  app.disable('x-powered-by');
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin) || (config.env !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) callback(null, true);
      else callback(new Error('Origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'PUT'],
  }));
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());
  app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }));

  const db = opts.db ?? createDb(config.databaseUrl);
  const ctx: Ctx = { config, db };
  const routes = routeAdapter(router, config, db);
  await healthRoutes(routes, ctx);
  await authRoutes(routes, ctx);
  await keysRoutes(routes, ctx);
  await orgRoutes(routes, ctx);
  await documentRoutes(routes, ctx);
  await openRoutes(routes, ctx);
  await traceRoutes(routes, ctx);
  await ledgerRoutes(routes, ctx);
  app.use(router);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use(apiErrorHandler(config));
  return app;
}
