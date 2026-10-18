# ArcTrace: Build Checklist

Work top to bottom. Tick boxes as you go. Each phase must run end to end before the next starts.

## How to use the time
| Time you have | Do this |
|---|---|
| **2 days** | Phase 0, Phase 1, then the **CUT LINE** items in Phase 2, then the demo prep in Phase 6 |
| **3-5 days** | Phases 0-3, then Phase 6. Start Phase 4 only if time is left |
| **More** | Continue to Phases 4 and 5 |

---

## Phase 0: Setup and spikes (about 3-4 hours)
- [x] **S0** Create the pnpm monorepo per spec.md section 1. TypeScript strict, ESLint, Prettier, Vitest.
- [x] **S0** `infra/docker-compose.yml` with Postgres and MinIO. One command: `pnpm dev:up`.
- [x] **S1 Arkiv spike (do first, blocks everything)** — *DONE on live Tiramisu testnet: `pnpm spike:s1` → 10/10 checks pass. Measurements + errata in docs/arkiv-notes.md. Wallet funded manually (faucet needs browser + CAPTCHA).*
  - [x] Read https://docs.arkiv.network and https://hub.arkiv.network/resources. Get testnet funds from the faucet. *(docs read via MCP; two wallets funded manually — browser + CAPTCHA step)*
  - [x] Write one entity with attributes and a payload. Read it back. Query by an attribute. *(live: create 7.4 s, read-back 718 ms, query 408 ms)*
  - [x] Measure: max payload size, cost per write, write latency, query latency, expiry extension, deletion behavior. *(128 KiB max payload; 107 320 gas/write; write ≈5–7 s; read ≈0.7 s; query ≈0.4 s; extend + delete both succeed on readonly)*
  - [x] Test a 5 KB payload. If rejected, choose the off-chain payload fallback in spec.md 4.1. *(accepted, read back 5120 B — no fallback needed)*
  - [x] Create an entity with `readOnly: true`. Try to update it, delete it and extend its life. Record which of these succeed. *(patch blocked; extend OK; delete OK)*
  - [x] Confirm `$creator` can be combined with attribute filters in one query. *(live: 1 hit in 408 ms; needs `addr(...)` wrapper — see errata)*
  - [x] Call `transferEntityOwnership` on a read-only entity. Check that `$creator` still shows the writer after the transfer. *(owner→auditor; creator unchanged)*
  - [x] Round-trip an encrypted (sealed) payload and confirm attribute queries still work. *(live: sealed 2745 B, opened OK, attributes intact)*
  - [x] Write everything in `docs/arkiv-notes.md` with exact package names and versions.
- [x] **S2 PQC spike:** `@noble/post-quantum` ML-KEM-768 and ML-DSA-65 work in Node and in a browser worker. Note argument orders and key and signature sizes in `docs/decisions.md`. *(Node validated: `pnpm spike:s2` green; argument orders + sizes in D-011. Browser worker deferred to Phase 2, D-020.)*
- [x] **S3 Watermark spike:** embed 80 bits in one PNG using DCT differential embedding, JPEG Q75 it, extract it. Report the bit error rate and PSNR. *(BER 0, PSNR 38.2 dB, real PNG file round trip: `pnpm spike:s3`)*
- [ ] **S4** Send the questions from idea.md to the Arkiv team if any answer is still unclear. *(3 questions drafted in docs/blockers.md; sending is a human step)*

## Phase 1: Proof of concept, CLI end to end (Day 1)
Goal: one script proves the whole idea.
- [x] `packages/shared`: Zod schemas for `DecryptionRecord`, `SignedDecryptionRecord`.
- [x] `packages/crypto`: keygen, encaps/decaps, sign/verify with domain strings, AES-GCM, HKDF `wrapKey`, JCS canonicalize, fingerprint. With tests and KATs. *(sizes, argument orders and deterministic-signing verified — D-011; ACVP KAT decision documented)*
- [x] `packages/ledger`: `LedgerAdapter`, `MockAdapter`, `ArkivAdapter` (from S1). Contract test suite that runs against both. *(live: `ARKIV_E2E=1 pnpm test` → 21/21 pass on Tiramisu, both adapters)*
  - [x] Create entities read-only. Every query passes `creators`.
  - [x] Planted-record test: a second wallet writes a fake `wmCode` entity and the trace ignores it. *(runs live from the second funded wallet — `ARKIV_ATTACKER_KEY`)*
- [x] `packages/watermark`: payload (64-bit + CRC16), DCT helpers, `embedRaster`, `extractRaster`, grid-offset search. Unit tests. *(19/19 green; plan-offset crop search + confidence gate + list decode — D-013..D-019)*
- [x] PoC CLI `pnpm poc:demo`:
  - [x] Generate keys for Alice, Bob, Carol.
  - [x] Encrypt a sample PDF page (image) once, wrap the DEK for each.
  - [x] "Open" as Bob: assign `wmCode`, build and sign the record, commit to Arkiv, decrypt, watermark.
  - [x] Simulate a leak: JPEG Q75 plus resize 80% of Bob's copy.
  - [x] Trace: extract, query Arkiv by `wmCode` and `$creator` (print the query and the result), verify signature, print "Bob" and a verification report.
- [ ] Record a 60 second screen capture of the CLI demo. This is your fallback demo. *(human step — run `pnpm poc:demo`, ~15 s, output is stable)*

**Exit gate:** the CLI prints the correct recipient from a degraded copy **using real Arkiv testnet data** — **PASS**: `LEDGER_MODE=arkiv pnpm poc:demo` traced the leaked copy to Bob on Tiramisu, exit 0 (proof in `apps/poc/out/report.json`).

## Phase 2: MVP web app (Days 2-3)

### 2A: Backend
- [ ] `apps/api`: Fastify, Zod validation, Drizzle migrations for the tables in spec.md section 7.
- [ ] Auth (register, login, logout, `/me`), roles, session cookie, CSRF.
- [ ] `POST /keys`, `GET /keys/:userId` with proof-of-possession check and ledger commit.
- [ ] Documents: create, presigned upload, finalize (manifest and grants), list, get.
- [ ] `open/begin` and `open/commit` with the full verification order in spec.md section 6.
- [ ] Ledger outbox and worker for non-blocking commits.
- [ ] Trace endpoints and `apps/worker` extraction job.
- [ ] `/healthz` and `/readyz`.

### 2B: Frontend (CUT LINE: items marked with a star are the minimum for a 2-day demo)
- [ ] ★ Sign up, key generation, passphrase, encrypted key storage in IndexedDB.
- [ ] ★ Sender: pick file, pick recipients, encrypt in the browser, upload, finalize.
- [ ] ★ Recipient inbox and open flow: begin, sign, commit, decrypt, watermark, render in a Web Worker.
- [ ] ★ Investigator: upload leaked file, show result, confidence and the Arkiv record.
- [ ] Ledger status panel: show the Arkiv entity key and a link to the explorer.
- [ ] Evidence bundle download button.
- [ ] Error states: ledger down (fail closed), wrong passphrase, revoked key.
- [ ] Basic accessibility pass (keyboard, labels, contrast).

### 2C: Verifier
- [ ] `packages/verify` and `arctrace-verify` CLI with online and offline modes.
- [ ] Evidence bundle format per spec.md section 8.

**Exit gate:** Playwright e2e passes: share, open as two users, upload a degraded screenshot, correct user named, bundle verifies.

## Phase 3: Hardening (Day 4)
- [ ] **Gate service** (`apps/gate`): `/release`, `/grant-share`, independent Arkiv check, rate limits. `GATE_MODE=on` e2e test proving that without a ledger entity the client cannot decrypt.
- [ ] Per-document hash chain (`seq`, `prevRecordHash`) with `CHAIN_MOVED` retry.
- [ ] **Merkle anchors:** builder job, `anchor` entity, proof endpoint, verifier support.
- [ ] **Witness** (`apps/witness`): mirror entities to write-once storage. Alert webhook. Chaos test: delete an entity, alert within 5 minutes.
- [ ] **Keeper** (`apps/keeper`): extend expiry below 30% remaining life. Dry-run mode. Cost report.
- [ ] Revocation of keys and grants end to end, with ledger events.
- [ ] **Ownership transfer job:** after creation, move ownership to the auditor wallet (retried, idempotent). Test that the writer wallet can no longer change or extend the entity.
- [ ] **Sealed payload mode** (`PAYLOAD_MODE=sealed`): encrypt records to the audit key, verifier `--audit-key`, round-trip test.
- [ ] **Public attribute allow-list scan** in CI (spec.md 4.3).
- [ ] **Planted-record security test:** a record from an untrusted wallet is ignored by trace, gate and verifier.
- [ ] **Retention demo:** create an entity with a short expiry, mark an inquiry as open, show lifetime extension working (or document exactly what read-only blocks).
- [ ] Watermark attack suite wired into CI with thresholds from spec.md 5.5. Save reports.
- [ ] Text-layer marks for TXT (zero-width). Mark as fragile in the UI.
- [ ] Security tests: replay, wrong signer, expired challenge, tampered record, revoked key.
- [ ] Network-capture test: private keys and plaintext never appear in requests.

## Phase 4: Production readiness (Day 5 and beyond)
- [ ] Dockerfiles for every service. Non-root users. Health checks.
- [ ] CI/CD (GitHub Actions): lint, typecheck, unit, integration, e2e, attack suite, dependency audit, build, image push.
- [ ] Secrets: no `.env` in git, KMS or Vault for gate master key and anchor key, rotation procedure documented.
- [ ] TLS, HSTS, CSP, COOP/COEP, rate limiting, CORS locked down.
- [ ] Observability: pino logs with redaction, Prometheus metrics, Grafana dashboard, alerts for ledger commit failures, gate errors, witness mismatches, keeper failures.
- [ ] Backups and restore drill for Postgres and blobs. Prove that Postgres can be rebuilt from Arkiv plus blobs for audit data.
- [ ] Load test with k6 and record p95 numbers in `docs/performance.md`.
- [ ] Runbooks in `docs/runbooks/`: ledger outage, key compromise, witness alert, expiry emergency, restoring service.
- [ ] Security review checklist: threat model walk-through, dependency review, basic pen test of auth and upload paths, leaked-file parser sandbox limits.
- [ ] Privacy review: confirm no PII or file names on-chain. Document the metadata that is visible.
- [ ] Docs: README, deployment guide, admin guide, API reference (generated from Zod), supported-attacks statement.
- [ ] Decide public testnet versus private DB-Chain for real deployments. Write the decision in `docs/decisions.md`.

## Phase 5: Stretch
- [ ] PDF text-layer watermark (word-gap micro adjustments) and extraction.
- [ ] Anti-collusion fingerprint codes (Tardos-style) with a collusion test.
- [ ] Robustness upgrades for print-scan and photo-of-screen (sync templates, stronger ECC).
- [ ] Second independent auditor wallet writing the same events.
- [ ] Anchor Merkle roots on Ethereum L1 or L2.
- [ ] WebAuthn PRF to protect private keys.
- [ ] Multi-org federation and cross-org verification.
- [ ] Admin dashboard: usage, retention cost forecast, integrity status.

## Phase 6: Hackathon submission (last 3-4 hours, do not skip)
- [ ] Deployed demo URL working, with seeded demo users (Alice, Bob, Carol) and sample documents.
- [ ] Demo script from prd.md section 11 rehearsed twice. Backup video from Phase 1 ready.
- [ ] The demo shows the full loop on screen: file opened, record created, leaked copy found, query by `wmCode` shown, reader identified. Also show the read-only flag and the `$creator` filter.
- [x] README with a one-command setup, architecture diagram, and the "Where Arkiv is used" table. *(`README.md`: setup, ASCII architecture diagram, "Where Arkiv is used" table, supported-attacks table)*
- [x] 300-character summary and a short pitch with the Why India evidence (paraphrased, sources listed). *(drafted in `.local/submission-draft.md` for paste into Devfolio)*
- [x] **Friction report:** list every Arkiv rough edge you hit (docs gaps, limits, errors, latency, costs) and what you did about it. *(`arkiv/friction.md`: faucet, `$creator` `addr()` wrapper, read-after-write, address checksum, casing, readonly semantics, no batch create, query cost)*
- [x] Supported-attacks table and honest limitations slide. *(README "Supported attacks & honest limitations"; pitch notes in `.local/submission-draft.md`)*
- [ ] Submit on Devfolio before the deadline. Confirm the deadline now.
- [ ] Message the Arkiv DevRel with the repo link, the demo link and your open questions.

---

## Daily review questions
1. Does the end-to-end slice still run from a clean checkout?
2. Did any secret, key or plaintext reach a log or the network?
3. Is anything on-chain that identifies a person or a file name?
4. Did I write down what I learned about Arkiv in `docs/arkiv-notes.md`?
5. Is every entity read-only and every query creator-filtered?