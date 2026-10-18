/**
 * Drizzle + postgres.js client and the auto-migrate helper. Both apps/api and
 * apps/worker import this; tests point DATABASE_URL at arctrace_test.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { join } from "node:path";
import { repoRoot } from "../config.js";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;
/** Alias used across lib/routes for the injected database handle. */
export type Database = Db;

export function createDb(databaseUrl: string): Db {
  const client = postgres(databaseUrl, {
    max: 10,
    onnotice: () => {},
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

export const MIGRATIONS_FOLDER = join(repoRoot(), "apps", "api", "drizzle");

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Cheap liveness probe for /readyz. */
export async function pingDb(db: Db): Promise<number> {
  const t0 = Date.now();
  await db.execute(sql`select 1`);
  return Date.now() - t0;
}
