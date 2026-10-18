# ArcTrace blockers (Phase 0–1, 2026-10-18)

## Hard blockers (external)

### 1. Testnet faucet is browser-gated
The Tiramisu testnet faucet (`https://hub.arkiv.network/faucet`) requires a
browser wallet sign-in plus CAPTCHA. A CLI-generated wallet (`pnpm gen:wallet`)
cannot self-fund, so:

- `pnpm spike:s1` exits with code 2 (BLOCKED) until the wallet has GLM.
- `ARKIV_E2E=1 pnpm test` and `LEDGER_MODE=arkiv pnpm poc:demo` are written
  and ready but have not run against real Arkiv.

**Workaround (in place):** every development run used `MockAdapter`, whose
semantics were matched to the pinned Arkiv documentation and MCP errata
(`docs/arkiv-notes.md`). The contract suite runs against both adapters with
one env var.

**To unblock:** `pnpm gen:wallet`, fund the printed address at the faucet URL,
then `pnpm spike:s1` → `ARKIV_E2E=1 pnpm test` → `LEDGER_MODE=arkiv pnpm poc:demo`.

### 2. 60-second screen capture (checklist Phase 1 exit)
Needs a human recording of the PoC run. The CLI output it should capture is
stable and reproducible with `pnpm poc:demo` (mock mode, ~15 s end to end).

## Soft blockers (workarounds in place)

### 3. pnpm "Ignored build scripts: esbuild" warning
pnpm 11.28.4 prints `[ERR_PNPM_IGNORED_BUILDS]` on every command even after
`onlyBuiltDependencies: [esbuild]` was moved to `pnpm-workspace.yaml` and an
`--force` reinstall. The warning is cosmetic: esbuild executes correctly (the
full test suite, `tsx` runs, and every spike pass). The approval cache appears
stale; `pnpm approve-builds` is interactive and was not run. No functional
impact.

### 4. Browser-worker PQC validation deferred (decision D-020)
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
