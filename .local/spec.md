# ArcTrace: Technical Spec

Everything here is a contract for the coding agent. Where a library detail is uncertain, **verify against the installed version and write it in `docs/arkiv-notes.md` or `docs/decisions.md`**. Do not guess the Arkiv SDK.

## 1. Repo layout
```
arctrace/
  apps/
    web/            Next.js (App Router), Web Workers
    api/            Fastify + Zod + Drizzle (or Prisma)
    gate/           Fastify, tiny, separate process
    witness/        Node worker: mirror + alerts
    keeper/         Node worker: extend expiry
    worker/         Node: trace jobs (extraction)
  packages/
    shared/         types, Zod schemas, constants, errors
    crypto/         PQC, AES, HKDF, canonical JSON, signing helpers
    watermark/      embed + extract (DCT), ECC/CRC, attack-suite helpers
    ledger/         LedgerAdapter, ArkivAdapter, MockAdapter, Merkle
    verify/         evidence bundle verification library + CLI (arctrace-verify)
  infra/            docker-compose.yml, Dockerfiles, Caddyfile
  docs/             arkiv-notes.md, decisions.md, blockers.md, runbooks/
  e2e/              Playwright tests
```
Tooling: pnpm workspaces, TypeScript strict, ESLint, Prettier, Vitest, Playwright, Zod, pino.

## 2. Crypto package

### 2.1 Algorithms
| Purpose | Algorithm |
|---|---|
| Key encapsulation | ML-KEM-768 |
| Signatures | ML-DSA-65 |
| File encryption | AES-256-GCM, 96-bit random nonce, AAD = `docId \|\| version` |
| KDF | HKDF-SHA-256 |
| Hash | SHA-256 |
| Password KDF | Argon2id (hash-wasm), min 64 MiB, t=3, p=1. Fallback PBKDF2-SHA-256 600k iterations |
| Canonical JSON | RFC 8785 (JCS). Use a vetted library, add test vectors |

### 2.2 Interface
```ts
export interface KemKeyPair { publicKey: Uint8Array; secretKey: Uint8Array }
export interface SigKeyPair { publicKey: Uint8Array; secretKey: Uint8Array }

export function generateKemKeyPair(): KemKeyPair;                 // ML-KEM-768
export function generateSigKeyPair(): SigKeyPair;                 // ML-DSA-65
export function kemEncapsulate(pk: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array };
export function kemDecapsulate(ct: Uint8Array, sk: Uint8Array): Uint8Array;
export function sign(domain: string, message: Uint8Array, sk: Uint8Array): Uint8Array;
export function verify(domain: string, message: Uint8Array, sig: Uint8Array, pk: Uint8Array): boolean;

export function aesGcmEncrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): { nonce: Uint8Array; ct: Uint8Array };
export function aesGcmDecrypt(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array, aad: Uint8Array): Uint8Array;

export function wrapKey(ss: Uint8Array, gateShare: Uint8Array, docId: string): Uint8Array;   // HKDF -> 32 bytes
export function canonicalize(obj: unknown): Uint8Array;           // JCS bytes
export function sealPayload(plaintext: Uint8Array, auditKey: Uint8Array, auditRecipientKemPks: Uint8Array[]): SealedPayload;   // AES-GCM + per-recipient ML-KEM wrap of auditKey
export function openPayload(sealed: SealedPayload, auditRecipientKemSk: Uint8Array): Uint8Array;
export function fingerprint(pk: Uint8Array): string;              // hex SHA-256
```
Notes: `sign` and `verify` prepend the domain string and a zero byte to the message. Check each library function's argument order against the installed `@noble/post-quantum` version. Add known-answer tests (KAT) and round-trip tests. Public key and signature sizes: record them in a constants file after measuring.

### 2.3 Domain strings
| Use | Domain |
|---|---|
| Decryption record | `ARCTRACE-DECRYPT-V1` |
| Key registration proof | `ARCTRACE-KEYREG-V1` |
| Manifest | `ARCTRACE-MANIFEST-V1` |
| Grant event | `ARCTRACE-GRANT-V1` |
| Anchor | `ARCTRACE-ANCHOR-V1` |
| Trace report | `ARCTRACE-TRACE-V1` |
| Evidence bundle | `ARCTRACE-BUNDLE-V1` |

## 3. Record schemas (Zod in `packages/shared`)
```ts
type Hex = string;                      // lowercase hex
interface DecryptionRecord {
  schema: "arctrace.decryption/1";
  orgId: string;                        // uuid
  docId: string;                        // uuid
  docVersion: number;
  docCiphertextSha256: Hex;
  recipientId: string;                  // uuid (pseudonymous)
  recipientSigKeyFp: Hex;               // sha256 of ML-DSA public key
  sessionId: Hex;                       // 16 bytes
  wmCode: Hex;                          // 8 bytes, server-assigned, unique
  challenge: Hex;                       // 16 bytes, server-assigned
  viewMode: "VIEW_ONLY" | "DOWNLOAD";
  clientTime: string;                   // ISO-8601, informational
  seq: number;                          // per-document, assigned at commit
  prevRecordHash: Hex | null;           // sha256 of previous record's JCS bytes
}
interface SignedDecryptionRecord {
  record: DecryptionRecord;
  alg: "ML-DSA-65";
  sig: string;                          // base64
}
```
**Chain rule:** the client signs the record with `seq` and `prevRecordHash` provided by the server in `begin`. If another open commits first, `commit` returns `409 CHAIN_MOVED` and the client re-begins. The API takes a per-document advisory lock between `begin` and `commit` expiry (max 60 s) or uses optimistic retry. Pick optimistic retry for simplicity and note it in `docs/decisions.md`.

**wmCode:** 8 random bytes from the server CSPRNG at `begin`. Unique index in Postgres. Retry on collision.

Other schemas: `KeyRegistration`, `DocManifest`, `GrantEvent`, `Anchor`, `TraceReport`. Each has `schema`, `orgId`, `ts`, the fields listed in architecture.md section 5, plus `alg`, `sig`, `signerKeyFp`.

## 4. Ledger package

### 4.1 Interface
```ts
export interface LedgerEntityInput {
  kind: "key_registration" | "doc_manifest" | "grant_event" | "decryption_event" | "anchor" | "trace_report";
  attributes: Record<string, string | number>;   // indexed
  payload: Uint8Array;                            // canonical JSON bytes
  retentionSeconds: number;
  readOnly: boolean;                              // default true (see 4.4)
  payloadMode: "plain" | "sealed";
  idempotencyKey: string;                         // e.g. sessionId
}
export interface LedgerRef { entityKey: string; txHash?: string; blockNumber?: number; committedAt: string }

export interface LedgerAdapter {
  commit(e: LedgerEntityInput): Promise<LedgerRef>;               // idempotent
  getByKey(entityKey: string): Promise<LedgerEntity | null>;      // includes `creator` and `owner`; callers must check `creator` against TRUSTED_WRITERS
  query(kind: LedgerEntityInput["kind"], where: Record<string, string | number>, opts: { creators: string[]; limit?: number; cursor?: string }): Promise<{ items: LedgerEntity[]; next?: string }>;
  extendRetention(entityKey: string, extraSeconds: number): Promise<void>;
  transferOwnership(entityKey: string, newOwner: string): Promise<void>;
  health(): Promise<{ ok: boolean; latencyMs: number }>;
}
```
- `MockAdapter`: in-memory plus file persistence, supports deletion to test the witness, and enforces `readOnly`, `creator`, `owner` and transfer the way S1 shows Arkiv does.
- `ArkivAdapter`: implemented after spike S1. Map the attribute and payload model to the real SDK. Record the SDK package name, version, auth method, payload limit, cost per write and query syntax in `docs/arkiv-notes.md`.
- **If the payload limit is too small** for a 3.3 KB signature plus record: store `payloadHash` on Arkiv and the full payload in the blob store, and mark `payloadLocation: "offchain"` in attributes. Keep the same verifier logic.

### 4.2 Merkle
Binary Merkle tree over leaves `sha256(entityKey || sha256(payload))` ordered by `(kind, seq)`. Provide `buildTree`, `proof(leaf)`, `verifyProof`. Anchor entity stores `root`, `leafCount`, `fromSeq`, `toSeq`, signature by the org anchor key.

### 4.3 Public attribute policy
Arkiv attributes are public. **Allowed** on any entity: `schema`, `kind`, `orgId` (random id), `docId` (random id), `docHash` (SHA-256 of the **ciphertext**, equal to `docCiphertextSha256`), `recipientId` (random id), `wmCode`, `sessionId`, `seq`, `ts`, `action`, `keyFp`, `traceId`, `fromSeq`, `toSeq`.
**Forbidden:** names, emails, file names, titles, plaintext hashes (they let anyone confirm a guessed document), org names, IP addresses, device info, and anything that identifies a person without our private mapping.
A unit test scans every entity the code builds and fails if an attribute key is not on the allow list.

### 4.4 Creation and lookup rules
1. Create every entity with `readOnly: true`. If spike S1 shows this blocks something we need (for example lifetime extension), record the decision in `docs/decisions.md` and apply the narrowest exception.
2. Create with the writer wallet, then call `transferOwnership` to the auditor wallet in a retried background job. Track status in `ledger_outbox`.
3. `TRUSTED_WRITERS` lists the writer addresses. Every `query` passes `creators` from it, and `getByKey` results whose `creator` is not trusted are rejected. This applies to the API, gate, worker, witness and verifier.
4. Retention: `retentionSeconds` is N months from the org config. The keeper calls `extendRetention` (lifetime extension) while an inquiry is open or policy requires it.

### 4.5 Sealed payload (production option)
With `payloadMode: "sealed"`, payload = `AES-GCM(auditKey, JCS(record + sig))` plus, for each audit recipient, an ML-KEM-wrapped copy of `auditKey`. Attributes stay in the clear so lookups still work. `plain` is the demo default so judges can read records. The verifier takes `--audit-key` for sealed entities.

## 5. Watermark package

### 5.1 Payload
`bits = wmCode (64) || CRC16-CCITT(wmCode) (16)` = 80 bits. Optional Reed-Solomon over GF(256) (stretch). Every page and every image carries the full payload.

### 5.2 Raster embed (L2), default parameters
These are starting values. **Tune with the attack suite** and keep them in `watermark.config.ts`.

| Parameter | Start value |
|---|---|
| Channel | Luma Y of YCbCr |
| Block | 8x8 DCT-II, non-overlapping |
| Coefficient pairs | Choose per block from `[(2,3),(3,2),(3,3),(1,4),(4,1),(2,4),(4,2)]` using a PRNG seeded by `K_wm` and block index |
| Embedding | Differential: for bit 1 force `C1 - C2 >= +delta`; for bit 0 force `C1 - C2 <= -delta` |
| Delta | Adaptive: `delta = clamp(base * (1 + activity), 6, 18)`; `activity` from block variance; `base = 8` |
| Bit assignment | `bitIndex = PRNG(K_wm, blockIndex) mod 80` |
| Skip rule | Skip nearly flat blocks (variance below threshold) to avoid visible banding |
| Extraction | For each block compute `sign(C1 - C2)`, add a weighted vote to its bit; majority per bit; verify CRC |
| Alignment | Search 8x8 grid offsets (0..7 in x and y) and scales in `[0.7 .. 1.3]` in steps of 0.05 until CRC passes. Cap the search time |
| `K_wm` | Per document, from `HKDF(gateMaster or docSecret, "wm-key")`. Delivered to the browser with the gate share. In PoC, derived from the DEK |
| Visibility target | PSNR above 38 dB and no visible artifacts on the sample set |

### 5.3 Text layer (L1)
- TXT and clipboard text: encode `wmCode` bits as zero-width characters (U+200B, U+200C) inserted at pseudo-random word boundaries. Mark as **fragile** (stripped by normalization).
- PDF download: micro adjustments of word gaps (a few hundredths of a point) encoding the bits, read back from glyph positions. Stretch. Document the attacks it survives.

### 5.4 Metadata (L3)
PDF XMP field with `wmCode`. Fragile on purpose, used only as a quick hint.

### 5.5 Attack suite (`packages/watermark/attacks`)
Automated tests over a fixed sample set (at least 20 images including text-heavy pages, photos, charts):
| Attack | Pass criteria |
|---|---|
| Identity | 100% |
| JPEG Q90, Q75, Q60 | at least 99% |
| Resize 90%, 80%, 70% | at least 99% |
| Crop 5%, 10% | at least 95% |
| Screenshot simulation (resample 1x, 2x, color profile shift) | at least 95% |
| Grayscale | at least 99% |
| Gaussian noise sigma up to 3 | at least 95% |
| Print-scan simulation (blur, rotate under 1 degree, gamma) | report only |
| Photo-of-screen simulation (perspective, moire, blur) | report only |
Also report **false positive rate** on 10,000 unwatermarked images (CRC must fail at least 99.99%) and PSNR/SSIM of watermarked vs original.

### 5.6 Interface
```ts
export interface EmbedOptions { keyWm: Uint8Array; payload80: Uint8Array; strength?: number }
export function embedRaster(img: ImageDataLike, opts: EmbedOptions): ImageDataLike;
export interface ExtractResult { ok: boolean; wmCode?: Hex; confidence: number; votes: number[]; alignment: { dx: number; dy: number; scale: number } }
export function extractRaster(img: ImageDataLike, keyWm: Uint8Array): ExtractResult;
export function embedText(text: string, wmCode: Hex, keyWm: Uint8Array): string;
export function extractText(text: string): { wmCode?: Hex; ok: boolean };
```
`ImageDataLike` is `{ width; height; data: Uint8ClampedArray }` so the same code runs in the browser and Node. Confidence = fraction of bit votes agreeing with the final bits, combined with CRC pass.

## 6. API (apps/api)
Base path `/v1`. JSON. Auth: session cookie (httpOnly, SameSite=Lax) plus CSRF token. All inputs validated with Zod. Errors use `{ error: { code, message } }`.

| Method and path | Role | Purpose |
|---|---|---|
| `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /me` | any | Account basics. Password hashed with argon2id |
| `POST /keys` | recipient | Register public keys plus proof-of-possession signature. Commits `key_registration` |
| `GET /keys/:userId` | any authed | Fetch public keys |
| `POST /keys/:keyId/revoke` | owner, admin | Revoke. Commits `grant_event` revoke |
| `POST /documents` | sender | Create doc id and upload URL |
| `PUT` presigned URL | sender | Upload ciphertext |
| `POST /documents/:id/finalize` | sender | Body: manifest, grants (wrapped DEKs), sender signature. Commits manifest and grants |
| `GET /documents`, `GET /documents/:id` | sender, recipient | List and fetch metadata |
| `POST /documents/:id/grants`, `DELETE /documents/:id/grants/:recipientId` | sender | Add or revoke recipients |
| `POST /documents/:id/open/begin` | recipient | Returns `sessionId`, `wmCode`, `challenge`, `seq`, `prevRecordHash`, wrapped DEK material, ciphertext URL, expiry |
| `POST /documents/:id/open/commit` | recipient | Body: signed record. Verifies, commits to ledger, returns `LedgerRef` |
| `POST /traces` | investigator | Upload leaked file, returns `traceId` |
| `GET /traces/:id` | investigator | Status and result |
| `GET /traces/:id/bundle` | investigator | Evidence bundle (zip: JSON, PDF, proofs) |
| `GET /ledger/verify/:entityKey` | any authed | Re-fetch an entity and verify signature and anchor |
| `GET /healthz`, `GET /readyz` | none | Liveness, readiness (includes ledger health) |

**Commit verification order:** session exists and not expired, not used; challenge and `wmCode` match; user owns recipient key; key not revoked; grant active; `seq` and `prevRecordHash` current; ML-DSA signature valid over `domain || JCS(record)`; client time within 10 minutes of server time. Then commit with idempotency key = `sessionId`.

**Gate API (apps/gate):** `POST /release` body `{ sessionId, entityKey }`. The gate queries the ledger itself, checks `kind=decryption_event`, that `creator` is in `TRUSTED_WRITERS`, matching `sessionId`, `wmCode` and `recipientId`, and that the entity is not older than 5 minutes. Returns `{ gateShare, keyWm }` over TLS. Rate limited per recipient. `POST /grant-share` (sender only, mutual auth with API) returns the share for a recipient at grant time.

## 7. Database (Postgres)
```
orgs(id, name, retention_seconds, created_at)
users(id, org_id, email, pw_hash, role, display_name, created_at)
user_keys(id, user_id, kem_pk, sig_pk, kem_fp, sig_fp, status, ledger_entity_key, created_at, revoked_at)
documents(id, org_id, sender_id, title_enc, version, ciphertext_key, ciphertext_sha256, view_mode, status, manifest_entity_key, created_at)
grants(id, doc_id, recipient_id, kem_ct, wrapped_dek, wrap_nonce, status, ledger_entity_key, created_at, revoked_at)
open_sessions(id, doc_id, recipient_id, session_id, wm_code UNIQUE, challenge, seq, prev_hash, status, expires_at, ledger_entity_key, created_at)
ledger_outbox(id, kind, payload, attributes, idempotency_key UNIQUE, status, attempts, last_error, created_at)
traces(id, org_id, investigator_id, leaked_sha256, status, result_json, report_entity_key, created_at)
anchors(id, org_id, from_seq, to_seq, root, entity_key, created_at)
audit_local(id, actor_id, action, meta, created_at)   -- convenience only, not authoritative
```
`title_enc` is encrypted client-side so the server does not see titles. Add indexes on `wm_code`, `(doc_id, seq)`, `idempotency_key`.

## 8. Evidence bundle (zip)
```
bundle.json          { traceId, leakedFileSha256, extraction{wmCode,confidence,alignment}, entityKey, record, signature, signerKeyFp, ledgerRef, anchorProof, chainCheck, createdAt, investigatorSig }
leaked.sha256        hash only; the leaked file is optional and off by default
report.pdf           human readable summary
proofs/              merkle proof, key registration entity, manifest entity
VERIFY.md            how to run arctrace-verify
```
`arctrace-verify bundle.zip [--offline]` checks: bundle signature, record signature against the registered key, key registration entity, hash chain neighbors, Merkle proof, and (online) that the entity exists on Arkiv with the same payload hash. Exit code 0 only if all pass.

## 9. Config (env)
`LEDGER_MODE`, `TRUSTED_WRITERS`, `AUDITOR_OWNER_ADDRESS`, `PAYLOAD_MODE`, `ARKIV_RPC_URL`, `ARKIV_WRITER_KEY`, `ARKIV_*` (from spike), `RETENTION_SECONDS`, `GATE_MODE`, `GATE_URL`, `GATE_MASTER_KEY`, `ANCHOR_SIG_SK`, `DATABASE_URL`, `S3_*`, `SESSION_SECRET`, `ALERT_WEBHOOK_URL`. Validate with Zod at startup. Never commit `.env`.

## 10. Security requirements
- Strict CSP, `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` for workers, HSTS, no inline scripts.
- Rate limits on auth, begin, commit, release, traces.
- Max upload size and content-type checks. Leaked-file parsing in a sandboxed worker with time and memory limits.
- Dependency audit in CI. Lockfile committed. Pin crypto library versions.
- Logs redact keys, signatures, passphrases, emails.
- Private keys: never serialized to the network. Test with a network-capture e2e test.
- Clear the DEK and plaintext buffers when the viewer closes.

## 11. Testing requirements
| Level | Must include |
|---|---|
| Unit | KATs for ML-KEM and ML-DSA, AES round trip, HKDF vectors, JCS vectors, CRC, Merkle proofs |
| Property | JCS determinism across key order; sign/verify round trip; tamper any byte fails |
| Watermark | Attack suite with thresholds above; PSNR and false positive reports saved to `reports/` |
| Integration | API with MockAdapter (including read-only, creator filter and ownership transfer); real Arkiv adapter tests behind `ARKIV_E2E=1`; sealed payload round trip |
| E2E (Playwright) | share, open, trace, verify, revoke, fail-closed when ledger down |
| Security | replay commit, wrong signer, revoked key, expired challenge, tampered record, gate bypass attempt, planted record from an untrusted wallet, attempted update or delete of a read-only entity, public attribute allow-list scan |
| Load (k6) | 50 concurrent opens, 20 concurrent traces; record p95 |
| Chaos | kill Arkiv mid-commit; delete an entity and see witness alert |

## 12. Definition of done (any feature)
Code, tests, types, docs updated, checklist ticked, no secrets in logs, lint and typecheck green, CI green.