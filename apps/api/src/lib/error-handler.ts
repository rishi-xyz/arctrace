import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from './errors.js';

export function registerErrorHandler(app: {
  setErrorHandler: (fn: (err: unknown, req: FastifyRequest, reply: FastifyReply) => void) => void;
  setNotFoundHandler: (fn: (req: FastifyRequest, reply: FastifyReply) => void) => void;
}): void {
  /**
   * Never log raw query errors: DrizzleQueryError messages embed the full
   * statement + params (password hashes, payloads). Keep type/code and a
   * params-redacted message only (spec §10 "no secrets in logs").
   */
  const sanitizeErr = (err: unknown): Record<string, unknown> => {
    const e = err as { name?: string; message?: string; code?: unknown; cause?: { code?: unknown } };
    let message = e.message ?? String(err);
    message = message.replace(/params:[\s\S]*$/u, 'params: [redacted]');
    if (message.length > 600) message = `${message.slice(0, 600)}…`;
    return {
      name: e.name,
      code: e.code ?? e.cause?.code,
      message,
    };
  };

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: { code: 'VALIDATION_FAILED', message: 'Invalid request payload' },
      });
      return;
    }
    const anyErr = err as { statusCode?: number; code?: string; message?: string };
    // Fastify's own errors (payload too large, bad JSON, rate limit…)
    if (typeof anyErr.statusCode === 'number' && anyErr.statusCode < 500) {
      const code =
        anyErr.statusCode === 429
          ? 'RATE_LIMITED'
          : anyErr.statusCode === 413
            ? 'PAYLOAD_TOO_LARGE'
            : 'VALIDATION_FAILED';
      reply
        .status(anyErr.statusCode)
        .send({ error: { code, message: anyErr.message ?? 'Request rejected' } });
      return;
    }
    // Never leak internals or stack traces to the client; log server-side
    // only, with query params redacted.
    req.log.error({ err: sanitizeErr(err), reqId: req.id }, 'unhandled error');
    reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Internal error', requestId: req.id ?? randomUUID() },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.url}` },
    });
  });
}
