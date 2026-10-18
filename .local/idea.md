# ArcTrace: Idea


## One line
When a secret document is shared with a group and one copy leaks, ArcTrace names the exact person who opened it, with proof that nobody (not even an admin) can fake or erase.

## The problem (plain words)
- A sender encrypts a file once. Each recipient opens it with their own key.
- Everyone sees the same file. If it leaks, all recipients look equally guilty.
- Server logs can be edited by an admin. A watermark that is the same for everyone does not help.

## The idea
1. **Every open is unique.** At the moment a recipient opens the file, the app adds a hidden watermark that only that open session has. The file looks identical to the eye.
2. **The recipient signs the open.** Their own post-quantum private key signs a record: who, which file, when, which watermark code. They cannot deny it later.
3. **The record goes to Arkiv.** The signed record is written as an Arkiv entity with queryable attributes (`docId`, `recipientId`, `wmCode`). Nobody can quietly change it.
4. **No record, no file.** The file is shown only after the record is committed (see "gated release" in architecture.md).
5. **Trace a leak.** Upload the leaked copy. The app extracts the watermark, queries Arkiv by `wmCode`, checks the signature, and produces an evidence report anyone can verify.

## Where Arkiv is used (this is the core, not a side feature)
| Use | Arkiv entity | Why Arkiv, not a normal DB |
|---|---|---|
| Decryption events | `decryption_event`, created **read-only**, with indexed `wmCode`, `docHash`, `docId`, `recipientId` (random ID), `sessionId` | The leak lookup is one attribute query, filtered to our writer wallet. Nobody can patch the record later. No private indexer to run. |
| Public keys | `key_registration` | Verification works from Arkiv alone. |
| Document manifests | `doc_manifest` (ciphertext hash, recipient list hash, sender signature) | Proves what was shared, to whom, in which version. |
| Grants and revocations | `grant_event` | Full access history, not just current state. |
| Integrity anchors | `anchor` (Merkle root of recent events) | Makes deletion or edits detectable. |
| Investigations | `trace_report` | The trace itself becomes evidence with its own custody trail. |
| Retention | Arkiv expiry | Records live for the retention period, then are pruned. A keeper job extends them while the case is open. |

## Arkiv features we use, and why each one
| Feature | How we use it | Why |
|---|---|---|
| Indexed attributes | `wmCode`, `docHash`, `docId`, `recipientId` (random ID), `sessionId`, `seq`, `kind` | These are the only public fields. The trace is one query on `wmCode`. |
| Read-only entities (`readOnly: true` at creation) | Every decryption event, manifest, key registration and anchor | Nobody can patch a record later, not us and not an admin. |
| Creator filter (`$creator`) | Every lookup (trace, gate check, verifier) accepts only our trusted writer wallet(s) | Anyone can write to a public chain. Without this, someone could plant a fake record with a real watermark ID and confuse the trace. |
| Ownership transfer (`transferEntityOwnership`) | We write with a service wallet, then move ownership to an auditor wallet or multisig | After the move, the writer cannot act on what it wrote. Stronger than a second writer. |
| Entity expiry and lifetime extension | Retention is N months. We extend while an inquiry is open | Retention policy is part of the data, not a cron job on a database. |
| Payload | The signed record. Plain in the demo, sealed (encrypted) in production | Verification from Arkiv alone. Sealed mode encrypts the payload to an audit key. |

**Public data policy:** attributes are public, so they hold only a watermark ID, document identifiers (random ID and a ciphertext hash) and random reader and session IDs. The mapping from reader ID to a real person stays in our private database. The file never goes on Arkiv. We hash the *ciphertext*, not the plaintext, so nobody can confirm a guessed document by hashing it.

**Sealed payload (production option):** encrypt the signed record with AES-256-GCM and wrap that key to the auditor and investigator ML-KEM keys. Attributes stay in the clear so lookups still work. Trade-off: verification then needs the audit key, so the demo keeps the payload readable.

**To verify in spike S1** (feature names as given to us; confirm exact behavior in the docs): does `readOnly` also block deletion? Does it block lifetime extension? Does ownership transfer work on a read-only entity?

## What it is not
- Not DRM. It cannot stop a leak. It makes the leaker identifiable.
- A photo of a screen can weaken the watermark. The product reports a confidence score and a supported-attacks statement instead of promising magic.
- Records on a public testnet are pseudonymous. No names, file names or personal data go on-chain.

## Why this story is real (verify before you quote)
Use these as the "Why India" narrative. Paraphrase them. Do not claim MoD asked for this feature.
- IAF Wing Commander arrested May 2026 under the Official Secrets Act for allegedly sharing documents by photos and videos. Charge sheet 30 Jul 2026. (The Quint, Outlook India)
- "Operation Firewall 2026": AP Counter Intelligence, 13 Naval personnel among 18 suspects, Eastern Naval Command. (ThePrint, 6 Oct 2026)
- Rafale documents: MoD ordered an internal inquiry; the Defence Secretary said it was running to find where the leak took place. (Deccan Herald, Free Press Journal, 2019)
- PQC is official policy: DST "Quantum-Safe Ecosystem in India" task force; MoD says DRDO leads post-quantum cryptography work; C-DOT unveiled defence-grade PQC encryptors (Sep 2026).
- Short quote usable in a pitch (MoD RTI reply, Deccan Herald): an "internal inquiry on disclosure of classified official information".

## Questions to send to the Arkiv team
1. Max payload size per entity, and the cost per write (GLM)? Our record is about 5 KB (an ML-DSA-65 signature is about 3.3 KB).
2. Does `readOnly: true` block deletion as well as edits? Does it block lifetime extension? Can ownership of a read-only entity be transferred (`transferEntityOwnership`), including to a multisig or contract? What does deletion leave visible?
3. Query language: equality, range and prefix on attributes? Pagination limits? Latency?
4. Expiry: how do we extend it, and what does extension cost?
5. Time to finality for a write, so we can set the "commit before release" timeout.
6. Is a private or permissioned DB-Chain possible for sensitive defence use?
7. Rate limits on testnet?
8. How do we combine the `$creator` filter with attribute filters in one query? Does `$creator` stay the original writer after an ownership transfer?
9. Can the payload be encrypted client-side without breaking attribute queries? (We expect yes, since attributes stay in the clear.)

## Locked decisions (do not re-debate)
- Language: TypeScript, pnpm monorepo, Node 20+.
- Web: Next.js (App Router). API: Express. DB: Postgres. Blobs: S3 or MinIO. Local dev: Docker Compose.
- Crypto: **ML-KEM-768** (FIPS 203), **ML-DSA-65** (FIPS 204) via `@noble/post-quantum`. AES-256-GCM via WebCrypto. HKDF-SHA-256. SHA-256. Canonical JSON per RFC 8785.
- Plaintext never touches the server. Decryption and watermarking happen in the browser.
- Ledger access only through a `LedgerAdapter` interface. A mock adapter exists for tests.
- Every Arkiv entity is created `readOnly` where Arkiv allows it (confirm in S1), written by a service wallet, then ownership moves to an auditor wallet.
- Every Arkiv lookup filters by creator (`$creator`) to our trusted writer wallets.

## Rules for the coding agent
1. Read in this order: `idea.md`, `prd.md`, `architecture.md`, `spec.md`, then work from `checklist.md`.
2. **Do not invent the Arkiv SDK API.** Do spike S1 in the checklist first. Read https://docs.arkiv.network and https://hub.arkiv.network/resources, then write what you learn into `docs/arkiv-notes.md`.
3. No custom cryptography. Use the libraries named above. Check the argument order of `sign`/`verify` and `encapsulate`/`decapsulate` against the installed version.
4. Test first for crypto, canonicalization and watermark code.
5. Never log keys, plaintext, passphrases or full signatures.
6. No names, file names or personal data on-chain. Use random pseudonymous IDs.
7. Tick boxes in `checklist.md` as you finish. Keep commits small. If blocked more than 30 minutes, write the blocker in `docs/blockers.md` and move to the next item.
8. Prefer a working vertical slice over many half-done parts. Phase 1 must run end to end before Phase 2 starts.
9. Never query Arkiv without the creator filter. Never create an entity without the read-only flag unless spike S1 shows it blocks something we need; record that exception in `docs/decisions.md`.
10. Public attributes follow the policy in spec.md section 4.3. Check every new attribute against it.
