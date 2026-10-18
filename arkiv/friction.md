# Arkiv friction notes

Honest list of rough edges hit while integrating Arkiv Tiramisu testnet with
`@arkiv-network/sdk@0.8.1` (2026-10-18), from the perspective of a hackathon
team going from zero to a working integration in one day. Pinned profile
revision `27b032f009c234b8`, rules frozen at
`4f912d1fa595125621962c053a9f36fdcfca5a54`.

## Context

- **Date and project revision:** 2026-10-18, ArcTrace, repo HEAD `41d841f`
  at time of writing; work performed 9–18 Oct 2026.
- **Runtime and exact versions:** Node on pnpm 11 workspace;
  `@arkiv-network/sdk@0.8.1`, `viem@2.57.7`. MCP server v1.1.24.
- **Network and chain ID:** Tiramisu testnet, RPC reports `chainId 7738577`.
- **Surfaces actually used:** TypeScript SDK (entities, query builder,
  ownership/flags), Tiramisu RPC reads and signed writes, Arkiv MCP
  (`server_status`, `get_package`, `get_skill`, `guides/*`, prompts), public
  docs, Hub faucet (browser), local `MockAdapter`/`ArkivAdapter` contract
  suite. Not used: access keys, WebSocket events, block/data explorers.
- **Intended users and the public query the app needs:** an org writer wallet
  commits watermark records to Arkiv *before* any plaintext is released;
  investigators (no funded wallet required) query `decryption_event` by
  `kind` + `wm_code` with a `$creator` filter to trace a leaked file to its
  decryptor.
- **Reproduction entry points:** `pnpm spike:s1`,
  `ARKIV_E2E=1 pnpm test`, `LEDGER_MODE=arkiv pnpm poc:demo`;
  measured results live in `docs/arkiv-notes.md`, blocker history in
  `docs/blockers.md`.
- **Evidence tags used below:** `[live]` = executed against Tiramisu with a
  funded wallet (signed tx or RPC read), `[mcp]` = pinned MCP/repository
  reference, `[doc]` = public docs reading, `[src]` = SDK/source reading.

## What worked well

- The MCP server (`server_status`, `get_package`, `get_skill`, prompts) gave
  exact, pinned facts: SDK version, entity limits, attribute rules, errata.
  When we hit a mismatch, the pinned repository was authoritative and said so.
  `[mcp]`
- SDK surface is small and coherent: `createEntity` / `getEntity` / query
  builder with `eq` / `select` / `fetch`, wallet-level `patch/extend/transfer/
  delete`. The contract test suite we wrote maps 1:1 onto it — 21/21 live
  E2E checks pass on Tiramisu, including a second-wallet planted-record test.
  `[live]`
- `flags: { readonly }` behaved exactly as the errata describe, which made the
  "nobody can quietly change a record" claim of our app easy to test
  (`spike:s1` checks: readonly blocks patch, allows extension, allows
  deletion — all PASS). `[live]`
- Live cost/latency on Tiramisu is predictable: write ≈ 5–7.4 s, read ≈ 0.7 s,
  query ≈ 0.4 s, gas per write ≈ 107 k. `[live]`

## Friction

1. **Faucet is the single biggest cold-start blocker.** Browser wallet
   sign-in + CAPTCHA; a CLI wallet (`genWallet` in the SDK) cannot self-fund.
   For an automated or agent-driven workflow this stalls everything: no testnet
   funds means no write, no latency measurement, no cost measurement. A CLI /
   API faucet with a rate limit would remove hours from the critical path.
   - Surface/version: Hub faucet (browser), observed 2026-10-18.
   - Repro: `genWallet()` a fresh keypair, open
     `https://hub.arkiv.network/faucet`, attempt to fund it — wallet sign-in
     and CAPTCHA required, no programmatic path.
   - Workaround and status: while unfunded, all development ran on a mock
     adapter matched to documented semantics. **Since resolved manually** —
     two wallets were funded by a human through the browser faucet, after
     which every live path passes (`spike:s1` 10/10, E2E 21/21, `poc:demo`
     PASS; see `docs/blockers.md`). The friction stands for any fresh
     contributor, CI run or agent-driven cold start.
   - Evidence type: `[live]` environment observation, 2026-10-18.

2. **Attribute name casing is undocumented in the quickstart.** The SDK does
   not obviously reject non-lowercase attribute names, but they are effectively
   unusable in queries. Our app schemas are camelCase, so we maintain an
   explicit snake_case allow-list and a commit-time assert
   (`ALLOWED_ATTRIBUTES`, `assertAllowedAttributes()`). A validation error at
   `createEntity` time with a pointer to the rule would save a debug cycle.
   - Surface/version: SDK 0.8.1 `createEntity`.
   - Repro: create an entity with a camelCase attribute (accepted), then run
     an `eq` query on that attribute — the attribute is not usable; the
     lowercase-ASCII rule appears only in MCP/errata material, not the
     quickstart.
   - Evidence type: `[live]` + `[mcp]`, rule confirmed via `get_package`/
     repository text (decision D-003 in our repo).

3. **`readonly` semantics are surprising.** The natural reading of "read-only"
   is "immutable", but readonly blocks **patch only** — extend, transfer and
   delete still work for the owner. This is documented only in the errata, not
   in the parameter docs. For an audit-log use case (ours) the property we
   actually need — "the creator cannot silently edit history" — holds, but a
   team could easily choose `readonly` for the wrong reason or, worse, assume
   immutability they do not have.
   - Surface/version: SDK 0.8.1 `flags: { readonly }`.
   - Repro: create a readonly entity, then `patch` (fails), `extend`
     (succeeds, 2.7 s), `transfer` (succeeds), `delete` (succeeds) — exactly
     our `spike:s1` checks 6, 8, 9.
   - Evidence type: `[live]` for behavior, `[mcp]` for the errata that
     explains it.

4. **Docs/SDK drift needs the MCP to resolve.** Multiple times the honest
   answer came from `get_package` / pinned repository text rather than the
   public docs page (e.g. the `flags` vs `creationFlags` param name, the 200
   entity page cap, the explicit `.cursor(cursor: string)` argument). The
   pinned-revision quoting convention is good; a "this page is current as of
   rev X" banner on the docs site would make the same point without MCP
   access.
   - Surface/version: public docs vs SDK 0.8.1 / pinned rev `4f912d1f…`.
   - Repro: follow the docs' create-entity example expecting
     `creationFlags`; call `.cursor()` per the docs; page past 200 entities.
   - Evidence type: `[doc]` vs `[mcp]`/`[src]` comparison, 2026-10-18.

5. **No batch create.** Granting N recipients to one document is N entities
   and N transactions. A batch endpoint (or documenting a recommended
   pattern — e.g. one manifest + off-chain grant list anchored by a single
   hash) would help write-heavy flows.
   - Surface/version: SDK 0.8.1 / RPC, no batch surface found.
   - Repro: onboard N recipients → `grant_event` written per recipient; our
     own open question #2 in `docs/blockers.md` remains unanswered.
   - Evidence type: `[doc]`/`[src]` absence + `[live]` N sequential writes
     (each ≈ 5–7.4 s).

6. **Query cost model is opaque.** It is not documented whether a two-attribute
   `eq` query is evaluated server-side or fetched-and-filtered. For a tracing
   query that runs on a leaked file this is the difference between "fast" and
   "page through everything". We page defensively (≤ 200 per page, cursor
   loop) because we could not find the answer.
   - Surface/version: query builder, SDK 0.8.1.
   - Repro: run `eq(kind) + eq(wm_code)` and look for documentation of where
     the filter is evaluated — not found in docs, MCP or repository;
     open question #3 in `docs/blockers.md`.
   - Evidence type: `[doc]` absence; observed wall time `[live]` query
     ≈ 0.4 s at our data volume (too small to distinguish the models).

7. **Address attributes need an explicit `addr(...)` wrapper.** Querying
   `$creator` with a plain string throws at build time:
   `InvalidPredicateError: "$creator" is a addr, but the value is a str`.
   The docs' examples read as if a string works. Wrapping with `addr()` from
   `@arkiv-network/sdk/attr` fixes it, but the error message ("write addr(...)
   around the value") is delivered as a thrown predicate error rather than in
   the page that documents the query builder.
   - Surface/version: SDK 0.8.1 query builder.
   - Repro: `query(...).eq("$creator", someHexAddress)` → throws at build;
     change to `eq("$creator", addr(someHexAddress))` → passes. Caught live by
     `spike:s1` check 4 (attribute + `$creator` query, 1 hit in 408 ms).
   - Evidence type: `[live]`, 2026-10-18.

8. **Read-after-write is not immediately consistent.** A 5 KB entity created
   and then fetched in the same script was reported as "No live entity… never
   created, or deleted or has expired" for a moment before becoming readable.
   We added a poll-until-visible loop; a "recently created, still indexing"
   distinct error (or a documented read-after-write guarantee) would let
   callers avoid defensive retries.
   - Surface/version: SDK 0.8.1 `createEntity` → `getEntity`, Tiramisu.
   - Repro: create a 5 KB entity, immediately `getEntity` by key → brief
     "not found"; spike polls up to 30 s, in practice the second read
     succeeds within ~0.3 s (`spike:s1` check 5: 5120 B readable after
     344 ms).
   - Evidence type: `[live]`, 2026-10-18. No documented read-after-write
     guarantee found (`[doc]` absence).

9. **Ownership transfer requires an EIP-55 checksummed address.** `change
   Ownership` (via viem) rejects a lowercase or non-checksummed hex address
   with "Address must match its checksum counterpart". Callers must normalise
   first (we use `getAddress(x.toLowerCase())`), which is a small but easy-to-
   miss step when the address came from another tool.
   - Surface/version: SDK 0.8.1 `changeOwnership`, viem 2.57.7.
   - Repro: call `changeOwnership` with a lowercase hex address → rejected;
     normalise with `getAddress(x.toLowerCase())` → accepted (verified by the
     live transfer check: owner→auditor, `$creator` unchanged).
   - Evidence type: `[live]`, 2026-10-18. Related: private keys exported
     without a `0x` prefix are also rejected; our adapter accepts raw 64-char
     hex.

10. **Minor: pnpm config drift, not Arkiv.** Not an Arkiv issue. pnpm 11
    auto-migrated our `onlyBuiltDependencies: [esbuild]` block in
    `pnpm-workspace.yaml` to the newer `allowBuilds: { esbuild: true }` form,
    which cleared the `[ERR_PNPM_IGNORED_BUILDS]` warning. Noted for
    completeness in `docs/blockers.md`; since resolved.

## Summary for the Arkiv team

The core primitives (entities, attributes, queries, ownership, expiry) are
sound and the MCP + pinned repository give unusually trustworthy reference
material. The two changes with the best effort-to-impact ratio: **a CLI
faucet** and **casing/limit validation errors at write time**. Everything else
is documentation placement.
