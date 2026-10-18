/**
 * 12-factor env config, validated with Zod at startup (spec.md section 9).
 * Never commit .env — .env.example documents every variable.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Walk up from this file to the pnpm workspace root (shared by all apps). */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

/** Load the root .env into process.env (no-op when absent). */
export function loadDotEnv(): void {
  const file = join(repoRoot(), ".env");
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    /* malformed or already loaded */
  }
}

const boolFromEnv =
  (def: boolean) =>
  (v: string | undefined): boolean => {
    if (v === undefined || v === "") return def;
    return v === "true" || v === "1";
  };

const intFromEnv =
  (def: number, min = 0) =>
  (v: string | undefined): number => {
    if (v === undefined || v === "") return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) {
      throw new Error(`expected an integer >= ${min}, got "${v}"`);
    }
    return n;
  };

const str = (v: string | undefined, def: string): string =>
  v === undefined || v === "" ? def : v;

const strOpt = (v: string | undefined): string | undefined =>
  v === undefined || v === "" ? undefined : v;

export interface ApiConfig {
  env: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  };
  sessionSecret: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  allowedOrigins: string[];
  ledgerMode: string;
  arkivRpcUrl?: string;
  trustedWriters?: string;
  mockLedgerFile: string;
  explorerUrl: string;
  gateMode: "on" | "off";
  wmMaster: string;
  retentionSeconds: number;
  openSessionTtlSeconds: number;
  presignPutSeconds: number;
  presignGetSeconds: number;
  uploadMaxBytes: number;
  traceMaxBytes: number;
  orgName: string;
  autoMigrate: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = str(env.NODE_ENV, "development");
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be development|test|production, got "${nodeEnv}"`);
  }
  const databaseUrl = strOpt(env.DATABASE_URL);
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const gateMode = str(env.GATE_MODE, "off");
  if (gateMode !== "on" && gateMode !== "off") {
    throw new Error(`GATE_MODE must be on|off, got "${gateMode}"`);
  }

  // Deterministic demo default so the PoC watermark key derivation works
  // without configuration; MUST be overridden in real deployments
  // (production start refuses the empty value — Phase 3 adds a refuse-default
  // gate too). See docs/decisions.md D-0xx.
  const wmMaster = str(env.ARCTRACE_WM_MASTER, "arctrace-demo-wm-master-v1");
  if (nodeEnv === "production" && !wmMaster) {
    throw new Error("ARCTRACE_WM_MASTER must be set in production");
  }

  const sessionSecret = str(env.SESSION_SECRET, "arctrace-dev-session-secret-change-me");
  if (nodeEnv === "production" && sessionSecret.startsWith("arctrace-dev")) {
    throw new Error("SESSION_SECRET must be changed in production");
  }

  const config: ApiConfig = {
    env: nodeEnv as ApiConfig["env"],
    port: intFromEnv(3001, 1)(env.PORT),
    databaseUrl,
    s3: {
      endpoint: str(env.S3_ENDPOINT, "http://localhost:9000"),
      region: str(env.S3_REGION, "us-east-1"),
      bucket: str(env.S3_BUCKET, "arctrace"),
      accessKey: str(env.S3_ACCESS_KEY, "arctrace"),
      secretKey: str(env.S3_SECRET_KEY, "arctrace123"),
    },
    sessionSecret,
    sessionTtlHours: intFromEnv(168, 1)(env.SESSION_TTL_HOURS),
    cookieSecure: boolFromEnv(false)(env.COOKIE_SECURE),
    allowedOrigins: str(
      env.ALLOWED_ORIGINS,
      "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000",
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    ledgerMode: str(env.LEDGER_MODE, "auto"),
    arkivRpcUrl: strOpt(env.ARKIV_RPC_URL),
    trustedWriters: strOpt(env.TRUSTED_WRITERS),
    mockLedgerFile:
      str(env.MOCK_LEDGER_FILE, "") || join(repoRoot(), ".data", "mock-ledger.json"),
    explorerUrl: str(env.EXPLORER_URL, "https://tiramisu.explorer.arkiv.network"),
    gateMode: gateMode as "on" | "off",
    wmMaster,
    retentionSeconds: intFromEnv(90 * 24 * 3600, 60)(env.RETENTION_SECONDS),
    openSessionTtlSeconds: intFromEnv(300, 30)(env.OPEN_SESSION_TTL_SECONDS),
    presignPutSeconds: intFromEnv(900, 60)(env.PRESIGN_PUT_SECONDS),
    presignGetSeconds: intFromEnv(900, 60)(env.PRESIGN_GET_SECONDS),
    uploadMaxBytes: intFromEnv(100 * 1024 * 1024, 1024)(env.UPLOAD_MAX_BYTES),
    traceMaxBytes: intFromEnv(25 * 1024 * 1024, 1024)(env.TRACE_MAX_BYTES),
    orgName: str(env.ORG_NAME, "ArcTrace Demo Org"),
    autoMigrate: boolFromEnv(true)(env.AUTO_MIGRATE),
  };
  return config;
}
