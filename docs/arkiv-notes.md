# ArcTrace × Arkiv notes (Tiramisu testnet)

Facts verified from the Arkiv MCP (`server_status`: server v1.1.24, profile
revision `27b032f009c234b8`; rules frozen at `4f912d1fa595125621962c053a9f36fdcfca5a54`,
9 Oct 2026) and from live SDK/library checks. The pinned repository revision is
quoted wherever behaviour matters; where the Devfolio page and the repository
differ, the repository applies.

## SDK and chain facts (verified 2026-10-18)

- Tiramisu testnet RPC answers `chainId 7738577`. Exact install:
  `@arkiv-network/sdk@0.8.1` (profile pins 0.8.x).
- Entity payload ≤ 128 KiB. Attribute count ≤ 30 per entity. Attribute names
  must be lowercase ASCII — this is why the on-chain attribute allow-list is
  snake_case (decision D-003).
- `.cursor(cursor)` takes an explicit string argument; query pages are capped
  at 200 entities; `select().fetch()` returns `{ entities, cursor, blockNumber }`.
- `flags: { readonly }` semantics (errata, not obvious from the docs):
  readonly blocks **patch only**. extend, transfer and delete still work.
  `$creator` never changes; `owner` changes on transfer; a deleted or expired
  entity disappears from reads.
- Create-entity param is `flags` (not `creationFlags`) — an erratum in the
  pinned docs.
- The MCP never receives keys and never signs. All writes happen locally in
  this repo through `ARKIV_PRIVATE_KEY` in `.env` (gitignored).

## PQC libraries (verified live)

- `@noble/post-quantum@0.7.1`: ML-KEM-768 pk/sk/ct/ss = 1184/2400/1088/32;
  ML-DSA-65 pk/sk/sig = 1952/4032/3309. Argument order:
  `ml_dsa65.sign(msg, sk, opts?)`, `ml_dsa65.verify(sig, msg, pk)`.
  Default signing is hedged/randomized; `{ extraEntropy: false }` selects
  FIPS 204 deterministic signing (decision D-011).
- `@noble/ciphers@2.4.0`, `@noble/hashes@2.4.0`, `canonicalize@5.1.0` (RFC 8785
  JCS), `zod@4.6.7`, `viem@2.57.7`.

## S1 spike — live results (2026-10-18, funded wallet)

`pnpm spike:s1` (`scripts/spike-s1-arkiv.ts`) ran against the real Tiramisu
testnet and passed **10/10 checks**:

| Check | Result |
|---|---|
| create small entity | PASS — 7.4 s, tx `0x690db6c8…` |
| gas per write | 107 320 gas |
| read back by key | PASS — 129 B in 718 ms |
| query by attribute AND `$creator` | PASS — 1 hit in 408 ms |
| 5 KB payload | PASS — read back 5120 B after 344 ms |
| readonly blocks patch | PASS |
| readonly allows extension | PASS — 2.7 s |
| transfer keeps `$creator` | PASS — owner→auditor, creator unchanged |
| readonly allows deletion | PASS |
| sealed payload round trip | PASS — 2745 B sealed, opened OK |

Measured on testnet: write latency ≈ 5–7.4 s, read ≈ 0.7 s, query ≈ 0.4 s,
gas per write ≈ 107 k. The PoC's trace step is dominated by the local
watermark search (~8 s), not the Arkiv query (386 ms).

- **Live contract suite:** `ARKIV_E2E=1 pnpm test` → **21/21 pass** (both
  adapters, 62 s), including the planted-record test where a *second funded
  wallet* writes a competing `wm_code` entity that the `$creator`-filtered
  trace correctly ignores.
- **Live end-to-end:** `LEDGER_MODE=arkiv pnpm poc:demo` → **PASS**, exit 0,
  leaked copy traced to Bob (confidence 0.393); report in
  `apps/poc/out/report.json`.

The suite still runs fully in `MockAdapter` mode with no `.env`, so CI and a
judge without a funded wallet get the same coverage minus live-network timing.

### Errata found only by running against the real chain

- `$creator` (and other address attributes) must be wrapped in `addr(...)`
  from `@arkiv-network/sdk/attr`. A plain string throws
  `InvalidPredicateError: "$creator" is a addr, but the value is a str`.
- Read-after-write is **not immediately consistent**: a 5 KB entity created
  immediately before `getEntity` was briefly "not found". The spike now polls
  up to 30 s; in practice the second read succeeds within ~0.3 s.
- `changeOwnership` requires an **EIP-55 checksummed** address (viem rejects a
  raw hex string). The adapter normalises with `getAddress(x.toLowerCase())`.
- Private keys pasted from a wallet export may lack the `0x` prefix; both the
  adapter and the spike accept raw 64-char hex.

Until a wallet is funded, all ledger behaviour runs through `MockAdapter`,
whose semantics were matched to the pinned documentation and MCP errata above.

## Where Arkiv is used in the app

| App step | Arkiv operation | Entity kind |
|---|---|---|
| Enrol a recipient | `createEntity` | `key_registration` |
| Publish a document | `createEntity` | `doc_manifest` |
| Grant a recipient | `createEntity` | `grant_event` |
| Bob opens (commit-before-decrypt) | `createEntity`, then plaintext | `decryption_event` |
| Trace a leaked copy | `query` by `wm_code` + `$creator` | `decryption_event` |
| Tamper checks | on-record ML-DSA verify + key lookup | — |

`$creator` is the org writer wallet for every write; recipients never need a
funded wallet (decision D-009). Full schema in `/arkiv/schema.md`.
