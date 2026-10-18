# ArcTrace Decision Log

Every non-obvious choice made while building Phases 0 and 1, with the
reason and the trade-off. Decision IDs are referenced from the code.

Environment these decisions were made in (2026-10-18):
Node v26.10.0, pnpm 11.28.4, `@arkiv-network/sdk@0.8.1`,
`@noble/post-quantum@0.7.1`, `@noble/ciphers@2.4.0`, `@noble/hashes@2.4.0`,
`canonicalize@5.1.0` (RFC 8785 JCS), `zod@4.6.7`, `viem@2.57.7`,
`jpeg-js@0.4.x`, `pngjs@7.0.x`.

---

## Repository and tooling

### D-001 Monorepo layout, PoC-first
`packages/shared|crypto|watermark|ledger` plus `apps/poc` for the CLI demo.
`apps/api`, `apps/gate`, `apps/worker` from the spec are Phase 2 and were not
created: a 1-day hackathon slice needs one runnable end-to-end path, not
scaffolding for services nobody will call yet. `infra/docker-compose.yml`
(Postgres 16 + MinIO with healthchecks) exists for Phase 2 and is not required
by the PoC, which persists the mock ledger to `apps/poc/out/mock-ledger.json`.

### D-002 Mirrored coefficient pairs, degenerate pairs dropped
The spec's start list was `[(2,3),(3,2),(3,3),(1,4),(4,1),(2,4),(4,2)]`.
`(3,3)` is degenerate: `C1 - C2` with `C1 === C2` is identically zero, so no
differential can be carried. The shipped list is
`[(2,3),(1,4),(2,4),(3,4),(3,1),(4,1),(4,2)]` — every entry has `u != v`, and
each pair is the mirror `(u,v)/(v,u)` of the differential. The spec text
sanctions tuning ("starting values … tune with the attack suite").

### D-004 Source-direct package exports
Workspace packages export TypeScript source (`"exports": "./src/index.ts"`)
with `moduleResolution: bundler`. No build step between packages; `tsx` and
`vitest` consume the source directly. Keeps the feedback loop fast and the
hackathon repo honest — what runs is what is written. A build step arrives
with Phase 2's browser bundling.

### D-010 `jpeg-js` and `pngjs` are runtime dependencies, not dev
`@arctrace/watermark` re-exports the attack suite (`toJpeg`/`fromJpeg`) and
`apps/poc` writes real PNG files, so both libraries execute at runtime.
Keeping them in devDependencies would break any consumer of the package.

### D-020 Browser-worker PQC validation deferred to Phase 2
The checklist's S2 asks for Node **and** browser-worker round trips. Only the
Node side was validated today. `@noble/post-quantum` 0.7.1 is pure JS with no
Node-specific APIs in the code paths we call (`ml_kem768`, `ml_dsa65`, SHA-256,
HKDF, AES-GCM), so we expect the browser worker to work unchanged, but
"expect" is not "measured" — this stays open (see `docs/blockers.md`).

---

## Ledger integration

### D-003 snake_case on-chain attribute names
Arkiv attribute names must be lowercase ASCII; the app-level schemas use
camelCase (`wmCode`). The public attribute allow-list is therefore
snake_case — `schema, kind, org_id, doc_id, doc_hash, recipient_id, wm_code,
session_id, seq, ts, action, key_fp, trace_id, from_seq, to_seq` — and
`assertAllowedAttributes()` in `@arctrace/ledger` enforces it at commit time.
Anything outside the allow-list is rejected before it can reach the chain.

### D-005 Mock-first development, faucet as an explicit blocker
The testnet faucet requires a browser wallet sign-in plus CAPTCHA, so a CI or
CLI wallet cannot self-fund. Rather than stall, all development ran against
`MockAdapter`, which mimics the Arkiv semantics confirmed from the pinned
documentation and the Arkiv MCP (see `docs/arkiv-notes.md`): read-only blocks
patch but not extend/transfer/delete, `$creator` never changes, owner changes
on transfer, expiry removes an entity from reads. The same contract test suite
runs against both adapters; the real-network run is one command once the
wallet is funded (`ARKIV_E2E=1 pnpm test`, `LEDGER_MODE=arkiv pnpm poc:demo`).

### D-006 `LEDGER_MODE=auto|mock|arkiv`, fail-closed rules
`auto` (default) uses Arkiv when reachable and falls back to the mock with a
loud warning; `arkiv` fails closed if the network is unreachable — a demo must
never silently pretend a record was written. `mock` is explicit and prints
"mode: mock" in the demo header. The exit-code contract of the CLI follows the
same rule: any failed verification step exits non-zero.

### D-007 Commit-before-decrypt ordering
Bob's decryption record is signed **and committed** to the ledger before the
client releases the plaintext. If the process crashes mid-open there is a
record with no view; there is never a view with no record. This is the "no
record, no file" property from the idea, enforced by ordering instead of
trusting the client.

### D-009 Non-repudiation is a signature inside the payload
Recipient non-repudiation comes from the ML-DSA-65 signature over the JCS
canonical record, not from the recipient holding a chain identity. Recipients
never need a funded wallet: the record is written by the org's writer wallet
(`$creator`), and the recipient's public key is itself registered on-ledger
(`key_registration`, keyed by `key_fp`), so verification works from Arkiv
alone. The planted-record test proves an attacker's wallet cannot inject a
fake `decryption_event` into a trace: every query passes the trusted-creator
filter.

### D-008 `K_wm` never touches the ledger
The per-document watermark key is `sha256("wmkey|" + docId + "|" +
ARCTRACE_WM_MASTER)` (in the PoC, derived from the DEK). Storing it on-chain
would make the watermark public and the whole exercise pointless. It reaches
the recipient's browser only through the gate share.

### D-011 Deterministic ML-DSA signing (`extraEntropy: false`)
noble 0.7.1 defaults to *hedged* (randomized) signing — two signatures over
the same message differ, which broke a determinism test. FIPS 204
deterministic signing is selected with `{ extraEntropy: false }`. Same bytes
in, same signature out, which also makes record bytes idempotent for retries.
KATs: noble implements the ACVP-tested reference code, so we assert sizes,
argument order, round trips and domain separation rather than re-embedding
ACVP vectors (a 20-minute spike cannot reproduce a formal validation
programme, and a fake KAT would be worse than none).

### D-012 Text watermark: all 80 bits at one keyed boundary
The first draft spread the 80 zero-width characters across several word
boundaries, but short documents do not have 80 boundaries and the chunking
silently dropped bits. All 80 characters now sit at one PRNG-chosen boundary,
in bit order. Fragile by design (normalisation strips it) — labelled as such.

---

## Watermark

### D-013 Plan-offset `(kx, ky)` search (crop robustness)
The keyed per-block plan (which coefficient pair, which payload bit) is a
function of the block's absolute grid coordinates. A crop shifts the grid, so
extraction's block `(bx, by)` was block `(bx+kx, by+ky)` at embed time.
Extraction therefore searches plan offsets up to `planOffsetMax = 8` blocks
(64 px, covering a 10 %+ centre crop of the 512 px sample pages) in addition
to pixel offsets and resample scales. The spec's "grid offset search" extended
to keep the crop row of the attack table honest.

### D-014 Confidence gate on CRC passes
A CRC16 pass alone is not proof of a watermark: an exhaustive search examines
tens of thousands of candidate alignments, so occasional noise alignments pass
CRC by luck (observed: the wrong scale decoding a *plausible but wrong* code).
A decode is only reported when vote confidence also clears
`minExtractConfidence = 0.35`. Measured with exhaustive searches: the weakest
true decode (resize 0.8 + JPEG Q75) lands at 0.41; the strongest false
candidate (unwatermarked image or wrong key, full scale + offset + plan
search) reaches only 0.29. Both sides of the gate are measured, not guessed.

### D-015 Skip near-saturated blocks, symmetrically
Embed and extract apply the identical predicate — skip blocks with variance
< 20 or mean luma ≥ 240 or ≤ 15. A block full of 255-valued pixels cannot
absorb a positive luma delta without clamping; it would keep its natural
differential and vote against the payload with full weight. Skipping the same
blocks on both sides keeps the vote sets identical.

### D-016 Three-phase extraction search
Order matters for wall-clock time, not just for correctness. Phase A tries
every scale at offset (0,0)/(0,0) — identity, JPEG, grayscale, noise and
aligned resizes all resolve here in well under a second. Phase B sweeps every
pixel offset at scale 1 — screenshots and translations. Phase C sweeps the
plan-offset range at scale 1 — crops. The expensive crop search is only
reached when the cheap phases fail; typical leak extraction takes 0.7–7 s.

### D-017 Adjacent restore-width/height candidates
Two-decimal scale steps cannot always restore the exact attacked size
(410 × 1.25 → 513, one pixel off the original 512), and a one-pixel size error
halves the vote confidence through grid drift. Phase A therefore tries
`n-1, n, n+1` in both dimensions for every non-unit scale. This is what makes
the 80 % resize of the PoC leak recoverable.

### D-018 Clipped-block down-weighting
Blocks containing ≥ 8 pixels at 0 or 255 are exactly the blocks where the
forced differential was partially destroyed by clamping during embedding; at
identity extraction they accounted for ~8.6 % wrong-sign votes. Their votes
carry a 0.25 weight multiplier. Identity confidence rose from 0.898 to 0.973
with no change to PSNR (38.2 dB).

### D-019 CRC-aided list decode
Under the leak combo (resize 0.8 + JPEG Q75) one or two marginal bits can
lose their majority even though the watermark is intact, which fails the CRC.
The decoder now retries the 55 flip-sets of size 1 and 2 over the 10
least-certain bits (sorted by vote *ratio*, not absolute vote) and lets CRC16
arbitrate. Expected false-accept contribution is ~55 × 2⁻¹⁶ ≈ 0.0008 per
candidate, and the D-014 confidence gate still applies to the result. This is
the "ECC/CRC" role from the spec's package layout, implemented as list
decoding instead of a forward error-correcting code.

### D-021 Allow-list enforced in both adapters
`MockAdapter.commit` always called `assertAllowedAttributes`, but `ArkivAdapter.commit`
did not — caught by the shared contract suite the first time it ran against
real Arkiv (`enforces the public attribute allow-list` failed). The allow-list
is the privacy guarantee (no filename or private metadata may become a public,
queryable attribute), so it must be enforced in application code, not left to
the SDK (Arkiv accepts arbitrary user attribute names). Both adapters now call
the same `assertAllowedAttributes` before any write.

### D-022 Normalise keys and addresses from `.env`
Real wallets export keys in different shapes and viem is strict:
- Private keys are accepted with or without the `0x` prefix (the first live
  `pnpm spike:s1` failed with "invalid private key, expected hex or 32 bytes,
  got string" for a raw 64-char key). Normalised in `ArkivAdapter` and the S1
  spike.
- `changeOwnership` requires an EIP-55 checksummed address; a raw hex string
  throws in viem. `ArkivAdapter.transferOwnership` normalises with
  `getAddress(newOwner.toLowerCase())`.
Tolerating either shape removes a whole class of "why won't it start" friction
without weakening any check.

### D-023 Tolerate eventual read-after-write consistency
A 5 KB entity created and immediately fetched was briefly reported "No live
entity". Rather than treat create→read as atomic, the S1 spike polls until the
entity is visible (up to 30 s; in practice the second read succeeds in ~0.3 s).
The app's own flow never reads an entity back immediately after writing it, so
no other path needs the retry.
