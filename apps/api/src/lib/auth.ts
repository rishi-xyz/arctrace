import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { forbidden, unauthenticated } from './errors.js';
import { loadSession, SESSION_COOKIE, type AuthedUser } from './session.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
  interface FastifyInstance {
    /** Global session+CSRF guard (attached in buildApp). */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Login/register must come from an allowed origin (defends against cross-site
 * form posts riding the browser). Requests without an Origin header (curl,
 * tests) are allowed — the session cookie + CSRF token still gate access.
 */
export function assertSameOrigin(req: FastifyRequest, config: ApiConfig): void {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = new Set(config.allowedOrigins);
  if (config.env !== 'production') {
    allowed.add(`http://localhost:${config.port}`);
    allowed.add(`http://127.0.0.1:${config.port}`);
  }
  if (!allowed.has(origin)) throw forbidden('Origin not allowed');
}

export function makeAuthGuard(config: ApiConfig, db: Database) {
  void config; // origin checks are route-specific (register/login only)
  return async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE];
    const csrf = req.headers['x-csrf-token'];
    const user = await loadSession({
      db,
      token,
      csrfToken: typeof csrf === 'string' ? csrf : undefined,
      enforceCsrf: MUTATING.has(req.method),
    });
    if (!user) throw unauthenticated();
    req.user = user;
  };
}

export function requireUser(req: FastifyRequest): AuthedUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}
