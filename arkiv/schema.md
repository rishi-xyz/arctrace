# ArcTrace on-chain schema (Arkiv / Tiramisu testnet)

Everything below is what ArcTrace writes to or queries from Arkiv. Verified
against `@arkiv-network/sdk@0.8.1` and the pinned repository revision
`4f912d1fa595125621962c053a9f36fdcfca5a54`; see `/docs/arkiv-notes.md`.

## Global conventions

- Every entity carries `schema` (e.g. `arctrace.decryption/1`) and `kind`
  attributes. `kind` selects the record type in queries.
- Attribute names are **snake_case**, lowercase ASCII — Arkiv rejects or
  mangles non-lowercase names, while the app-level Zod schemas use camelCase
  (decision D-003). The allow-list below is enforced at commit time by
  `assertAllowedAttributes()`; anything else fails before reaching the chain.
- Entity payloads are JCS-canonicalized (`canonicalize`, RFC 8785) before
  write. Retried writes with `{ extraEntropy: false }` signatures (D-011) are
  byte-identical, hence idempotent-friendly.
- Entity payload ≤ 128 KiB, ≤ 30 attributes. Query pages ≤ 200 entities.
- All entities are created with `flags: { readonly }`: patch is blocked, but
  extend, transfer and delete remain available to the owner. `$creator` never
  changes; owner changes on transfer; deleted/expired entities vanish from
  reads.
- `$creator` is always the **org writer wallet**. Recipients never need a
  funded wallet; their non-repudiation is the ML-DSA-65 signature inside the
  payload (decision D-009).

## Public attribute allow-list

```
schema  kind  org_id  doc_id  doc_hash  recipient_id  wm_code  session_id
seq  ts  action  key_fp  trace_id  from_seq  to_seq
```

## Entity kinds

### 1. `key_registration`

One entity per enrolled recipient key. Written at enrolment; queried by
`key_fp` during trace verification to find the signer's public key.

Attributes: `schema, kind, org_id, recipient_id (as user id), key_fp, ts`.

Payload (`arctrace.keyreg/1`):

```jsonc
{
  "schema": "arctrace.keyreg/1",
  "orgId": "uuid", "ts": "ISO-8601",
  "userId": "uuid", "keyId": "uuid",
  "kemPk": "base64 ML-KEM-768 public key (1184 B)",
  "sigPk": "base64 ML-DSA-65 public key (1952 B)",
  "kemFp": "hex32", "sigFp": "hex32",
  "alg": "ML-KEM-768+ML-DSA-65",
  "sig": "base64", "signerKeyFp": "hex32"
}
```

### 2. `doc_manifest`

One entity per published document version. Query by `doc_id` (+ `doc_hash`
for integrity checks).

Attributes: `schema, kind, org_id, doc_id, doc_hash, seq (version), ts`.

Payload (`arctrace.manifest/1`):

```jsonc
{
  "schema": "arctrace.manifest/1",
  "orgId": "uuid", "ts": "ISO-8601",
  "docId": "uuid", "version": 1,
  "senderId": "uuid",
  "ciphertextSha256": "hex32",
  "recipientSetHash": "hex32",
  "viewMode": "VIEW_ONLY | DOWNLOAD",
  "signerKeyFp": "hex32", "sig": "base64"
}
```

### 3. `grant_event`

One entity per grant or revoke of one recipient on one document. Query by
`doc_id` + `recipient_id`.

Attributes: `schema, kind, org_id, doc_id, recipient_id, action, ts`.

Payload (`arctrace.grant/1`):

```jsonc
{
  "schema": "arctrace.grant/1",
  "orgId": "uuid", "ts": "ISO-8601",
  "docId": "uuid", "recipientId": "uuid",
  "action": "grant | revoke",
  "signerKeyFp": "hex32", "sig": "base64"
}
```

### 4. `decryption_event` ← the traceable record

One entity per open, committed **before** the plaintext is released
(decision D-007). This is the kind the leak-tracing query targets.

Attributes: `schema, kind, org_id, doc_id, recipient_id, wm_code, session_id, seq, ts`.

Payload (`arctrace.decryption/1`), signed by the recipient's ML-DSA-65 key:

```jsonc
{
  "record": {
    "schema": "arctrace.decryption/1",
    "orgId": "uuid", "docId": "uuid", "docVersion": 1,
    "docCiphertextSha256": "hex32",
    "recipientId": "uuid", "recipientSigKeyFp": "hex32",
    "sessionId": "hex16",
    "wmCode": "hex8",            // the 64-bit raster watermark code
    "challenge": "hex16",
    "viewMode": "VIEW_ONLY | DOWNLOAD",
    "clientTime": "ISO-8601",    // informational
    "seq": 0, "prevRecordHash": "hex32 | null"   // per-recipient hash chain
  },
  "alg": "ML-DSA-65",
  "sig": "base64"               // 3309 B over the JCS-canonical record
}
```

`wmCode` is never accompanied by the watermark key: `K_wm` is derived from the
document DEK and never stored on-chain (decision D-008).

### 5. `anchor`

Batch/checkpoint record (spec §3), reserved for Phase 2 periodic anchoring of
event streams. Not written by the PoC.

Attributes: `schema, kind, org_id, doc_id, trace_id, from_seq, to_seq, ts`.

### 6. `trace_report`

Written after a leak is traced: which code decoded, which record it hit, the
verification chain. Attributes: `schema, kind, org_id, doc_id, trace_id, ts`.

## Query patterns

Trace a leaked copy (what the PoC runs):

```ts
.query((e) => e.where.eq("kind", str("decryption_event"))
                 .where.eq("wm_code", str(decodedWmCode)))
.select({ key: true, creator: true, payload: true })
.fetch()                                    // pages ≤ 200
```

then verify, in order: `$creator` ∈ trusted writer set → record parses under
`SignedDecryptionRecordSchema` → ML-DSA-65 signature verifies against the
`key_registration` found via `key_fp` → `doc_id`/`doc_hash` match the leaked
file. Any failure fails closed (non-zero exit).
