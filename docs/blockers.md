# ArcTrace blockers (Phase 0–1, 2026-10-18)

## Resolved

### Testnet faucet was browser-gated — RESOLVED

The Tiramisu testnet faucet (`https://hub.arkiv.network/faucet`) requires a
browser wallet sign-in plus CAPTCHA, so a CLI-generated wallet could not
self-fund. Two wallets were funded manually; all live paths now run:

- `pnpm spike:s1` → 10/10 checks pass (measurements in `docs/arkiv-notes.md`).
- `ARKIV_E2E=1 pnpm test` → 21/21 pass, both adapters, including the live
  planted-record test from the second wallet.
- `LEDGER_MODE=arkiv pnpm poc:demo` → PASS, exit 0, leaked copy traced to Bob.

While the wallet was unfunded, every development run used `MockAdapter`, whose
semantics were matched to the pinned Arkiv documentation and MCP errata
(`docs/arkiv-notes.md`). The contract suite still runs against both adapters
behind one env var.

### pnpm esbuild build-approval warning — RESOLVED
pnpm 11 rewrote the stale `onlyBuiltDependencies: [esbuild]` block in
`pnpm-workspace.yaml` to the current `allowBuilds: { esbuild: true }` form; the
`[ERR_PNPM_IGNORED_BUILDS]` warning no longer appears.

## Hard blockers (external)

### 1. 60-second screen capture (checklist Phase 1 exit)
Needs a human recording of the PoC run. The CLI output it should capture is
stable and reproducible with `pnpm poc:demo` (~15 s end-to-end in mock mode, or
`LEDGER_MODE=arkiv pnpm poc:demo` for the live testnet run, ~47 s).

## Soft blockers (workarounds in place)

### 2. Browser-worker PQC validation deferred (decision D-020)
S2 asks for Node and browser-worker round trips; only Node was validated today.
`@noble/post-quantum` 0.7.1 uses no Node-specific APIs in the paths we call, so
the browser worker is expected to work unchanged — but that is unmeasured and
tracked, not assumed.

## Open questions for the Arkiv team (checklist S4)
Not answered yet; not blocking Phase 0–1:
1. Recommended retention/extension pattern for append-heavy event streams
   (`decryption_event` grows with every open) — per-entity expiry vs periodic
   anchoring into a `trace_report`?
2. Is there a batch-create API (multiple entities, one tx) for the grant burst
   when onboarding N recipients at once?
3. Attribute query cost model: does `eq` on two attributes (`kind` + `wm_code`)
   evaluate server-side, or is the result set fetched and filtered client-side?
