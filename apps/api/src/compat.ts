import type { AuthedUser } from './lib/session.js';

/** Small route contract shared by the existing endpoint modules and Express adapter. */
export interface ApiRequest {
  body: unknown;
  params: any;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  user?: AuthedUser;
  ip: string;
  method: string;
  url: string;
  file(): Promise<{ filename?: string; toBuffer(): Promise<Buffer> } | undefined>;
}

export interface ApiReply {
  status(code: number): this;
  send(body?: unknown): this;
  setCookie(name: string, value: string, options: Record<string, unknown>): this;
  clearCookie(name: string, options: Record<string, unknown>): this;
}

type Handler = (req: ApiRequest, reply: ApiReply) => unknown | Promise<unknown>;
type RouteOptions = { onRequest?: (req: ApiRequest, reply: ApiReply) => void | Promise<void>; config?: { rateLimit?: { max: number; timeWindow: string } } };

export interface RouteApp {
  authenticate(req: ApiRequest, reply: ApiReply): Promise<void>;
  get<T = unknown>(path: string, handler: Handler): void;
  get<T = unknown>(path: string, options: RouteOptions, handler: Handler): void;
  post<T = unknown>(path: string, handler: Handler): void;
  post<T = unknown>(path: string, options: RouteOptions, handler: Handler): void;
  delete<T = unknown>(path: string, handler: Handler): void;
  delete<T = unknown>(path: string, options: RouteOptions, handler: Handler): void;
}
