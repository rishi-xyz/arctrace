import type { ApiConfig } from './config.js';
import type { Database } from './db/index.js';

/** Everything route modules need, passed from buildApp. */
export interface Ctx {
  config: ApiConfig;
  db: Database;
}
