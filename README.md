# ArcTrace

**When a secret document shared with a group leaks, ArcTrace names the exact
person who opened it — with proof nobody (not even an admin) can fake or
erase.**

Every open is cryptographically unique: at the moment a recipient opens the
document, a hidden per-open watermark is embedded in the rendered page, the
recipient signs a record with their own post-quantum key, and the record is
committed to [Arkiv](https://hub.arkiv.network) *before* the plaintext is
released. A leaked copy is uploaded, the watermark is extracted, Arkiv is
queried by the decoded code, and the signed record names the recipient.

Built for the **Arkiv: Global Tour Stop** hackathon (submissions close
18 Oct 2026 22:59 UTC). Arkiv Tiramisu testnet, `@arkiv-network/sdk@0.8.1`.

## Quick start

```bash
pnpm install
pnpm test          # 64/64 unit + contract tests (mock ledger)
pnpm poc:demo      # end-to-end: encrypt → open → leak → trace (~15 s)
```

`pnpm poc:demo` prints `PoC PASSED` when a degraded copy (resize 80 %, JPEG
Q75) is traced back to the correct recipient with a verified proof chain.

Optional, for real Arkiv testnet:

```bash
pnpm gen:wallet                       # create a wallet
# fund its address at https://hub.arkiv.network/faucet (browser + CAPTCHA)
pnpm spike:s1                         # live Arkiv measurements
ARKIV_E2E=1 pnpm test                 # contract suite against real Arkiv
LEDGER_MODE=arkiv pnpm poc:demo       # full PoC on testnet
```

Other scripts: `pnpm spike:s2` (PQC measurements), `pnpm spike:s3` (watermark
spike: real PNG → JPEG Q75 → extract), `pnpm dev:up` / `pnpm dev:down`
(Postgres + MinIO for Phase 2), `pnpm typecheck`, `pnpm lint`.

## How it works

1. **Enrol.** Each recipient gets an ML-KEM-768 + ML-DSA-65 key pair; the
   public keys are registered on Arkiv (`key_registration`).
2. **Publish once.** The document is encrypted once (AES-256-GCM). The DEK is
   wrapped per recipient with ML-KEM-768. A `doc_manifest` and one
   `grant_event` per recipient go on-chain.
3. **Open = commit, then release.** Rendering the page embeds an invisible
   80-bit DCT watermark keyed to that open session (`wmCode`). The recipient
   signs a `decryption_event` (ML-DSA-65, JCS-canonical) and it is committed
   to Arkiv **before** the client decrypts. No record, no file.
4. **Trace a leak.** Upload the leaked copy. The extractor searches scale,
   grid offset and plan offset, majority-votes the 80 bits, verifies CRC and a
   confidence gate, then queries Arkiv by `kind + wm_code`, checks `$creator`
   is a trusted writer, and verifies the recipient signature against the
   on-chain key registration. Tampered and planted records fail closed.

### Cryptography

| Purpose | Algorithm |
|---|---|
| Key encapsulation | ML-KEM-768 (FIPS 203, `@noble/post-quantum`) |
| Signatures | ML-DSA-65 (FIPS 204, deterministic, `extraEntropy: false`) |
| Document encryption | AES-256-GCM |
| Record canonicalization | RFC 8785 JCS (`canonicalize`) |
| Watermark key | HKDF-SHA256, derived from the DEK — never stored on-chain |

### Watermark (why the leak is traceable)

The rendered page's luma channel carries one payload bit per non-flat 8×8
block, in the difference of two mid-frequency DCT coefficients, keyed by the
block's grid coordinates. Every block repeats the same 80-bit payload
(64-bit code + CRC16), so crops, resizes and re-encodes only cost votes.
Measured: PSNR ≥ 38 dB, survives JPEG Q60, resize 70–100 %, crop, grayscale,
noise, screenshots, and the PoC leak combo (resize 80 % + JPEG Q75). Extraction
confidence is gated (measured: true decodes ≥ 0.41, false candidates ≤ 0.29).
Text carrier (zero-width characters) also implemented, honestly labelled as
fragile.

## Where Arkiv is used

| App step | Arkiv operation | Entity kind |
|---|---|---|
| Enrol a recipient | `createEntity` | `key_registration` |
| Publish a document | `createEntity` | `doc_manifest` |
| Grant a recipient | `createEntity` | `grant_event` |
| Bob opens (commit-before-decrypt) | `createEntity`, then plaintext | `decryption_event` |
| Trace a leaked copy | `query` by `wm_code` + `$creator` | `decryption_event` |
| Tamper checks | on-record ML-DSA verify + key lookup | — |

Full schema: [`arkiv/schema.md`](arkiv/schema.md). Friction notes for the
Arkiv team: [`arkiv/friction.md`](arkiv/friction.md).

## Repository layout

```
packages/shared      Zod schemas, domain strings, attribute allow-list
packages/crypto      ML-KEM/ML-DSA/AES-GCM/JCS primitives
packages/watermark   DCT raster watermark + text carrier + attack suite
packages/ledger      LedgerAdapter: MockAdapter | ArkivAdapter
apps/poc             demo.ts — the end-to-end CLI
scripts              spikes S1–S3, wallet generation
infra                docker-compose.yml (Postgres + MinIO, Phase 2)
docs                 decisions.md, arkiv-notes.md, blockers.md
arkiv                schema.md, friction.md
```

The ledger runs in **mock mode by default** (persisted to
`apps/poc/out/mock-ledger.json`) because the testnet faucet is browser-gated;
`LEDGER_MODE=auto|mock|arkiv` switches, `ARKIV_E2E=1` enables the live
contract tests. Mock semantics were matched to the pinned Arkiv documentation
and errata — see [`docs/arkiv-notes.md`](docs/arkiv-notes.md).

## Decisions

Every non-obvious choice is logged with its trade-off in
[`docs/decisions.md`](docs/decisions.md) (D-001…D-020) and referenced from the
code. Known blockers in [`docs/blockers.md`](docs/blockers.md).

## License

MIT — see [LICENSE](LICENSE).
