# ArcTrace — Devfolio submission draft (Phase 6)

Prepared 2026-10-18 from the canonical repository
`Arkiv-Network/global-tour-stop-pre-devcon` @ `4f912d1fa595125621962c053a9f36fdcfca5a54`
(rules frozen 9 Oct 2026). If the Devfolio page differs, the repository applies.
Deadline: **18 Oct 2026, 23:59 London (22:59 UTC)**. Video ≤ 180 s.

Fill in the `<...>` placeholders. Everything else is paste-ready.

---

## Standard fields

**Project name:** ArcTrace

**Tagline:** Name the leaker, with proof nobody can fake.

**300-character summary** (paste as-is):

> ArcTrace names the leaker when a shared document leaks. Each open embeds an invisible per-session watermark; the recipient signs a post-quantum record committed to Arkiv before the plaintext is released. A leaked copy is traced to its opener in seconds — with proof no admin can fake or erase.

**Tracks to select:** Best Indian Use Case *(only if a team member holds Indian nationality — confirmed locally, never sent to the MCP)*. Optionally also a CROPS pillar — recommend **Security (Global)** as a second track. Max 1 prize per team.

**The problem it solves** (standard field):

> When a classified or confidential document is shared with a group and one copy leaks, every recipient looks equally guilty. Server logs can be edited by whoever runs the server, and an admin can always deny or fabricate evidence. ArcTrace makes every open cryptographically unique: an invisible per-open watermark plus an ML-DSA-65 signature committed to Arkiv *before* the plaintext is released. A leaked copy is traced to the exact opener, and the proof cannot be faked or erased by anyone — including the operator — because the record lives on a chain the operator does not control.

**Challenges I ran into** (standard field):

> 1. Faucet cold start: the testnet faucet needs a browser wallet + CAPTCHA, so a CLI wallet cannot self-fund. I built a mock ledger adapter matched to the pinned Arkiv docs/errata; the same contract tests run against real Arkiv with one env var (`ARKIV_E2E=1`).
> 2. Robust watermark extraction: recovering an 80-bit payload from a resized + re-JPEG'd copy needed a three-phase search (scale → grid offset → plan offset), a measured confidence gate (true decodes ≥ 0.41, false candidates ≤ 0.29) and a CRC-aided list decoder for the 1–2 bits that lose their majority under heavy attacks.
> 3. Arkiv attribute names must be lowercase, while app schemas are camelCase — solved with a checked snake_case allow-list enforced at commit time.
> 4. Deterministic signatures: noble defaults to hedged signing; FIPS 204 deterministic mode (`extraEntropy: false`) was needed for byte-identical retried writes.

---

## Custom questions (16 required)

**Q1 — Live app URL:** *(human: if no deployed URL, the honest answer is the repo + `pnpm poc:demo`, ~15 s end-to-end. Judges can run it. Consider a small hosted terminal replay if time allows.)*

> The full app runs from the repo in one command: `pnpm install && pnpm poc:demo` (end-to-end trace in ~15 s, output pasted in the demo video). No server is required for the Phase 1 CLI; a hosted web build is Phase 2.

**Q2 — Indian nationality:** *(human fact — answer locally on Devfolio. Basis for Best Indian Use Case eligibility.)*

**Q3 — Why Arkiv?**

> The product's entire claim is "nobody can fake or erase the evidence" — including us. Postgres or our own API would make the operator the auditor: an admin can edit rows or delete them. IPFS has no queryable, ordered, creator-attributed event log; a subgraph is a read indexer over someone else's contract and still needs a write layer plus trusted indexing. Arkiv gives us three things we cannot rebuild in a weekend: (1) creator-attributed, queryable, read-only event entities — our `decryption_event` records are filterable by `wm_code` and `$creator`, and the writer wallet is verifiable by anyone; (2) ownership/creator semantics plus expiry that let an auditor wallet take custody while the writer loses nothing it needs; (3) a hosted PQC-ready chain where writes cost fractions of a cent. What stays outside Arkiv: file ciphertexts, wrapped DEKs, the watermark key and all identity mappings — only pseudonymous IDs, a ciphertext hash and the signed record go on-chain.

**Q4 — How you use Arkiv?** *(replace `<REPO>` with the GitHub URL)*

> All writes go through `LedgerAdapter` (`packages/ledger`), implemented for both mock and Arkiv (`@arkiv-network/sdk@0.8.1`).
> 1. **Entity creation, read-only** — every entity is created with `flags: { readonly }`: `key_registration`, `doc_manifest`, `grant_event`, `decryption_event`. Code: `packages/ledger/src/arkiv.ts`.
> 2. **Attributes + payload** — JCS-canonicalized signed records as payloads (ML-DSA-65 sig ≈ 3.3 KB, entity well under the 128 KiB cap); snake_case attribute allow-list enforced at commit time: `<REPO>/packages/ledger/src/attributes.ts`.
> 3. **Attribute queries** — trace = `.where.eq("kind", ...).where.eq("wm_code", ...)` filtered to the trusted `$creator` set, cursor-paged (≤200/page): see the trace query in `packages/ledger/src/index.ts` and `<REPO>/arkiv/schema.md`.
> 4. **Commit-before-release ordering** — the decryption record is committed and read back before the client releases plaintext (demo step 4, `apps/poc/demo.ts`).
> 5. **Planted-record defense** — a second wallet writes a fake `wm_code` entity; the creator-filtered query ignores it (contract test: `packages/ledger/test/contract.test.ts`).

**Q5 — Friction report:**

> `<REPO>/arkiv/friction.md` — 7 issues, each with expected vs actual, versions (`@arkiv-network/sdk@0.8.1`, MCP server v1.1.24, pinned revision `4f912d1f`) and reproduction. Top issue: browser/CAPTCHA-gated faucet blocks CLI/agent wallets.

**Q6 — Wallet addresses that create your Arkiv entities:** *(human: the address printed by `pnpm gen:wallet`; role = "org writer service wallet — creates every ArcTrace entity (key_registration, doc_manifest, grant_event, decryption_event); recipients never hold funded wallets." Keep the address in the Devfolio form only.)*

**Q7 — Link to /arkiv/schema.md:**

> `<REPO>/arkiv/schema.md` — entity kinds, attribute tables, payload schemas, creator/owner semantics, readonly flags, expiry, and the exact trace query.

**Q8 — How can judges reproduce your Arkiv usage?**

> 1. `git clone <REPO> && pnpm install`
> 2. `pnpm test` — 64 tests incl. the ledger contract suite and the planted-record test (mock mode, deterministic).
> 3. `pnpm poc:demo` — end-to-end: 3 recipients, one ciphertext, Bob opens (record committed before decrypt), leak simulated (resize 80 % + JPEG Q75), watermark extracted, Arkiv query by `wm_code` + `$creator` printed, Bob named with signature-verified proof. Fail-closed exit codes on any verification failure.
> 4. For live Arkiv: `pnpm gen:wallet`, fund at hub.arkiv.network/faucet, `pnpm spike:s1` (live measurements), `ARKIV_E2E=1 pnpm test`, `LEDGER_MODE=arkiv pnpm poc:demo`.
> 5. Query semantics to inspect: `LEDGER_MODE=mock` writes to `apps/poc/out/mock-ledger.json`; every query passes the trusted-creator set; the planted fake record stays invisible.

**Q9 — Pre-existing work you reused:**

> None. All code was written between 9 and 18 October 2026. Dependencies (libraries, allowed): `@arkiv-network/sdk@0.8.1`, `@noble/post-quantum@0.7.1`, `@noble/ciphers`, `@noble/hashes`, `canonicalize` (RFC 8785), `zod`, `viem`, `jpeg-js`, `pngjs`, `vitest`, `tsx`.

**Q10 — Arkiv surfaces you used:** TypeScript SDK · Docs · Hub · Faucet · Arkiv MCP. *(also Block Explorer if you checked a tx after funding; Data Explorer if used)*

**Q12 — Time to first Arkiv entity:** *(human: answer from actual experience once the wallet is funded. If submitting before funding, "2 to 24 hours" reflects the real integration-to-first-write path via the SDK + mock-validated adapter; adjust honestly.)*

**Q13 — Which LLMs did you use:**

> Claude (Big Pickle) via OpenCode. *(add any others used.)*

**Q14 — One thing Arkiv should improve first:**

> A CLI/API faucet. The browser-wallet + CAPTCHA faucet makes wallets unfundable from scripts, which stalls every automated or agent-driven integration before the first write. A rate-limited CLI faucet (or testnet access keys with initial gas) would remove hours from the critical path. Second: validation errors at `createEntity` time for attribute-name casing and limit breaches.

**Q15 — Open to a 20-minute feedback call:** Yes.

**Q16 — Originality attestation:** Yes — our team's work, built 9–18 Oct 2026; pre-existing work disclosed in Q9.

**Q17 — MIT repo, links accessible:** Yes — MIT `LICENSE`, public repo `<REPO>`, `/arkiv/schema.md` and `/arkiv/friction.md` present, README has one-command setup.

**Q18 — Devcon 8 attendance (optional):** *(human.)*

---

## Rubric rationale (prepare, don't paste into the form verbatim)

**Why India?** *(Best Indian Use Case — paraphrased from idea.md sources; verify before quoting)*

> Document leaks are a live Indian national-security problem: an IAF Wing Commander was arrested in May 2026 under the Official Secrets Act for allegedly sharing documents as photos and videos (charge sheet filed 30 Jul 2026; The Quint, Outlook India); "Operation Firewall 2026" saw AP Counter Intelligence probe 13 Naval personnel among 18 suspects at the Eastern Naval Command (ThePrint, 6 Oct 2026); and the MoD ordered an internal inquiry over leaked Rafale documents (Deccan Herald, 2019). India is also making PQC official policy — the DST "Quantum-Safe Ecosystem in India" task force, DRDO leading post-quantum cryptography per the MoD, and C-DOT unveiling defence-grade PQC encryptors in Sep 2026. ArcTrace combines both: post-quantum-signed, watermark-traced accountability for exactly the leak pattern Indian agencies investigate — photo/video leaks of shared documents — without putting any name or file on-chain. We do not claim any agency asked for this.

**Why this pillar? (Security)**

> The security claim is the product: evidence that survives a hostile operator. Every record is signed by the recipient's ML-DSA-65 key (FIPS 204), committed to Arkiv read-only before plaintext release, and verified against an on-chain key registration during trace. The contract suite proves the adversarial cases: tampered records fail signature check, planted records from untrusted wallets are invisible to the creator-filtered query, and every verification failure exits non-zero. The watermark itself is key-derived and never stored on-chain, so the chain cannot be used to strip protection.

---

## Human-only checklist before submitting

- [ ] Registered: https://arkiv.devfolio.co/overview
- [ ] Repo public on GitHub with LICENSE, README, arkiv/schema.md, arkiv/friction.md (push `master`)
- [ ] Q2 nationality answered locally (basis for Best Indian Use Case)
- [ ] Q6 wallet address pasted from `pnpm gen:wallet` output (form only, never chat/MCP)
- [ ] Q12 answered from real experience
- [ ] Demo video ≤ 180 s attached (fallback: 60 s `pnpm poc:demo` screen capture)
- [ ] Track(s) selected; "Why India"/"Why pillar" rationale drafted above
- [ ] Deadline reminder: **22:59 UTC today, 18 Oct 2026**
- [ ] Optional: message Arkiv DevRel (Discord) with repo link + open questions from docs/blockers.md
- [ ] Keep deployment/repo available through 23 Oct 18:00 London; do not rewrite history after the deadline (organizer records the commit SHA)
