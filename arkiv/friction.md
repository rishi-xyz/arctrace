# Arkiv friction notes

Honest list of rough edges hit while integrating Arkiv Tiramisu testnet with
`@arkiv-network/sdk@0.8.1` (2026-10-18), from the perspective of a hackathon
team going from zero to a working integration in one day. Pinned profile
revision `27b032f009c234b8`, rules frozen at
`4f912d1fa595125621962c053a9f36fdcfca5a54`.

## What worked well

- The MCP server (`server_status`, `get_package`, `get_skill`, prompts) gave
  exact, pinned facts: SDK version, entity limits, attribute rules, errata.
  When we hit a mismatch, the pinned repository was authoritative and said so.
- SDK surface is small and coherent: `createEntity` / `getEntity` / query
  builder with `eq` / `select` / `fetch`, wallet-level `patch/extend/transfer/
  delete`. The contract test suite we wrote maps 1:1 onto it.
- `flags: { readonly }` behaved exactly as the errata describe, which made the
  "nobody can quietly change a record" claim of our app easy to test.

## Friction

1. **Faucet is the single biggest cold-start blocker.** Browser wallet
   sign-in + CAPTCHA; a CLI wallet (`genWallet` in the SDK) cannot self-fund.
   For an automated or agent-driven workflow this stalls everything: no testnet
   funds means no write, no latency measurement, no cost measurement. A CLI /
   API faucet with a rate limit would remove hours from the critical path.
   (Workaround used: a mock adapter matched to documented semantics, with the
   real-network run one env var away.)

2. **Attribute name casing is undocumented in the quickstart.** The SDK does
   not obviously reject non-lowercase attribute names, but they are effectively
   unusable in queries. Our app schemas are camelCase, so we maintain an
   explicit snake_case allow-list and a commit-time assert
   (`ALLOWED_ATTRIBUTES`, `assertAllowedAttributes()`). A validation error at
   `createEntity` time with a pointer to the rule would save a debug cycle.

3. **`readonly` semantics are surprising.** The natural reading of "read-only"
   is "immutable", but readonly blocks **patch only** — extend, transfer and
   delete still work for the owner. This is documented only in the errata, not
   in the parameter docs. For an audit-log use case (ours) the property we
   actually need — "the creator cannot silently edit history" — holds, but a
   team could easily choose `readonly` for the wrong reason or, worse, assume
   immutability they do not have.

4. **Docs/SDK drift needs the MCP to resolve.** Multiple times the honest
   answer came from `get_package` / pinned repository text rather than the
   public docs page (e.g. the `flags` vs `creationFlags` param name, the 200
   entity page cap, the explicit `.cursor(cursor: string)` argument). The
   pinned-revision quoting convention is good; a "this page is current as of
   rev X" banner on the docs site would make the same point without MCP
   access.

5. **No batch create.** Granting N recipients to one document is N entities
   and N transactions. A batch endpoint (or documenting a recommended
   pattern — e.g. one manifest + off-chain grant list anchored by a single
   hash) would help write-heavy flows.

6. **Query cost model is opaque.** It is not documented whether a two-attribute
   `eq` query is evaluated server-side or fetched-and-filtered. For a tracing
   query that runs on a leaked file this is the difference between "fast" and
   "page through everything". We page defensively (≤ 200 per page, cursor
   loop) because we could not find the answer.

7. **Minor: pnpm noise, not Arkiv.** Not an Arkiv issue, but noted for
   completeness in `/docs/blockers.md`: pnpm 11 keeps printing an
   `[ERR_PNPM_IGNORED_BUILDS]` esbuild warning despite the approval living in
   `pnpm-workspace.yaml`; cosmetic only.

## Summary for the Arkiv team

The core primitives (entities, attributes, queries, ownership, expiry) are
sound and the MCP + pinned repository give unusually trustworthy reference
material. The two changes with the best effort-to-impact ratio: **a CLI
faucet** and **casing/limit validation errors at write time**. Everything else
is documentation placement.
