# ArcTrace hosted deployment

This setup uses a Render web service for the Express API, a Render background worker for outbox/trace processing, Neon Postgres, Cloudflare R2, and Vercel for Next.js.

## Why this layout

- Keep the worker as a Render **Background Worker** on an always-on paid plan. It polls the database queue itself, so a sleeping/free web service would delay trace work. The worker uses the same Neon database, Arkiv writer key, and R2 credentials as the API.
- Render free web services can sleep. The login page immediately calls the API status endpoint and retries with backoff while the user types, so the API starts warming before form submission. That reduces perceived cold-start delay, but cannot guarantee zero delay on a sleeping instance. Use an always-on API plan if login must be immediately responsive.
- The login screen displays the configured Arkiv writer public address and its live GLM balance. The address is public chain data; the private key remains server-side.
- The API applies Drizzle migrations at startup (`AUTO_MIGRATE=true`). The worker does not run migrations.

## 1. Neon Postgres

Create a Neon project and database. Copy its **pooled** connection string for the API and worker, preserving `sslmode=require`; use the same value for both `DATABASE_URL` variables. The Render services must be able to reach the Neon endpoint. Keep the connection string private.

## 2. Cloudflare R2

Create a private R2 bucket and an R2 API token scoped to that bucket with object read/write access. Set the endpoint to `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, region to `auto`, and use the token's access key ID and secret access key. The bucket must exist before the API starts; do not grant bucket-creation permissions to the runtime token.

## 3. Render API and worker

Connect the repository to Render and create services from the root `render.yaml` blueprint. Choose a paid **Starter** plan (or higher) for both services; the worker must be an always-on Background Worker. Fill all `sync: false` values in each service's Environment page. For variables that appear on both services, use the same values.

### API environment

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Render-provided port (blueprint sets `10000`) |
| `DATABASE_URL` | Neon pooled connection string (`sslmode=require`) |
| `AUTO_MIGRATE` | `true` |
| `SESSION_SECRET` | Random secret, at least 32 random bytes; never reuse the dev value |
| `COOKIE_SECURE` | `true` |
| `ALLOWED_ORIGINS` | Exact Vercel origin, e.g. `https://your-app.vercel.app` (comma-separated for custom domains) |
| `LEDGER_MODE` | `arkiv` |
| `ARKIV_PRIVATE_KEY` | Funded Tiramisu writer private key; secret, server-side only |
| `ARKIV_RPC_URL` | `https://rpc.tiramisu.db-chain.testnet.arkiv.network` (or your reliable RPC endpoint) |
| `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | Existing R2 bucket name |
| `S3_ACCESS_KEY` | R2 token access key ID |
| `S3_SECRET_KEY` | R2 token secret |
| `ARCTRACE_WM_MASTER` | Long random secret; keep stable because changing it affects watermark derivation |
| `ARKIV_AUDITOR` | Optional public auditor address |
| `TRUSTED_WRITERS` | Optional comma-separated trusted public writer addresses; omit to use the configured writer |

### Worker environment

Set `NODE_ENV=production`, `LEDGER_MODE=arkiv`, and provide the same `DATABASE_URL`, `ARKIV_PRIVATE_KEY`, `ARKIV_RPC_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `ARCTRACE_WM_MASTER` as the API. Set optional `ARKIV_AUDITOR` and `TRUSTED_WRITERS` identically if used.

After first deployment, wait for API startup and check `https://<api-host>/v1/healthz`. The readiness endpoint `https://<api-host>/v1/readyz` checks Postgres, Arkiv, and R2. The worker should log that it is ready and then process queued traces/outbox records.

## 4. Vercel web app

Create a Vercel project with **Root Directory** `apps/web`. Use pnpm from the repository root (install command `pnpm install --frozen-lockfile`; build command `pnpm --filter arctrace-web build`). Add these environment variables for Production and Preview as appropriate:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://<api-host>/v1` (no trailing slash) |
| `ARCTRACE_S3_PROXY_URL` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |

Redeploy after setting variables because `NEXT_PUBLIC_API_URL` and the S3 rewrite are used during the Next.js build. Add the exact deployed Vercel origin to Render's `ALLOWED_ORIGINS`.

## 5. Smoke check

1. Open the Vercel app and confirm the login screen's public panel shows the Arkiv writer address and a GLM balance (or explicitly reports the balance unavailable).
2. Register and sign in. On the first request, allow time for a cold API start if using a sleeping plan; the login-page warm-up begins in parallel with user input.
3. Upload a document and verify that the worker processes the trace; check Render worker logs if it remains pending.
4. Check API readiness and confirm all three dependency checks pass.
5. Keep the writer private key, session secret, Neon URL, R2 secret, and watermark master in Render's secret environment fields only. Never add them to Vercel or commit them.

## Local env file

`.env.example` documents local development variables. Production values belong in Render/Vercel environment settings. Do not put real production secrets in `.local` or commit them.
