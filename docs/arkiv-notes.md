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

## S1 spike status

`pnpm spike:s1` (`scripts/spike-s1-arkiv.ts`) is written and measures exactly
what the checklist asks for: create/read/query, a 5 KB payload, cost and
latency per write, query latency, expiry extension, readonly patch/extend/
transfer/delete behaviour, and a sealed (expired) entity. It exits with code 2
and a BLOCKED message when `ARKIV_PRIVATE_KEY` is missing or the wallet is
unfunded — the testnet faucet requires a browser wallet sign-in and CAPTCHA,
so a CLI wallet cannot self-fund (see `docs/blockers.md`).

Until the wallet is funded, all ledger behaviour runs through `MockAdapter`,
whose semantics were matched to the pinned documentation and MCP errata above.
The same contract test suite covers both adapters; once funded:

```
pnpm spike:s1            # real measurements, pasted into this file
ARKIV_E2E=1 pnpm test    # contract suite against real Arkiv
LEDGER_MODE=arkiv pnpm poc:demo
```

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
