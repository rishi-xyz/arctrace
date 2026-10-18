import type { ApiConfig } from '../config.js';
import type { Database } from '../db/index.js';
import type { ApiReply, ApiRequest } from '../compat.js';
import { forbidden, unauthenticated } from './errors.js';
import { loadSession, SESSION_COOKIE, type AuthedUser } from './session.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Login/register must come from an allowed origin (defends against cross-site
 * form posts riding the browser). Requests without an Origin header (curl,
 * tests) are allowed — the session cookie + CSRF token still gate access.
 */
export function assertSameOrigin(req: ApiRequest, config: ApiConfig): void {
  const rawOrigin = req.headers.origin;
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
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
  return async function authenticate(req: ApiRequest, _reply: ApiReply): Promise<void> {
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

export function requireUser(req: ApiRequest): AuthedUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}
