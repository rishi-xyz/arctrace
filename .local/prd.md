# ArcTrace: Product Requirements (PRD)

## 1. Summary
A web app for sending sensitive documents to a group and tracing the exact recipient if a copy leaks. It combines per-open invisible watermarks, post-quantum signatures from each recipient, and an Arkiv-backed tamper-evident record of every open.

## 2. Users
| Role | Who | Needs |
|---|---|---|
| Sender | Officer or staff sharing a document | Share to a named group, set view or download policy, see who opened it |
| Recipient | Person who must read the document | Open it simply, with their own key, without friction |
| Investigator | Security or counter-intelligence team | Upload a leaked copy, get a named recipient and proof |
| Auditor | Independent reviewer | Verify records without trusting the admin |
| Org Admin | IT admin | Manage users, keys and retention. Cannot edit or delete records |

## 3. Goals and non-goals
**Goals**
- G1: Every decrypted copy looks identical but is forensically unique.
- G2: Every decryption is signed by the recipient with a NIST post-quantum signature (ML-DSA-65).
- G3: Every signed record is committed to Arkiv before the file is shown.
- G4: From a leaked copy, return the exact recipient with a verifiable evidence bundle.
- G5: No single admin or compromised account can erase or rewrite a record without it being detected.
- G6: Runs as a real deployable product (Docker, CI, monitoring), not only a demo.

**Non-goals**
- Preventing leaks, screen capture or analog copying.
- Hiding that a document exists.
- Supporting every file type. v1 covers PDF, PNG, JPEG and TXT.
- Mobile apps.

## 4. User stories and acceptance criteria
**US-1 Register keys (Recipient).** On first login, the browser generates an ML-KEM-768 key pair and an ML-DSA-65 key pair. Private keys stay in the browser, encrypted with a passphrase. Public keys are registered and recorded on Arkiv.
- AC: Private keys never reach the server (verified by network tests). Key registration appears on Arkiv with a proof-of-possession signature.

**US-2 Share a document (Sender).** Select a file, pick recipients and a policy (`VIEW_ONLY` or `DOWNLOAD`), and send.
- AC: The file is encrypted once in the browser. A wrapped key is created for each recipient. A manifest is signed by the sender and committed to Arkiv. The server never sees plaintext.

**US-3 Open a document (Recipient).** Click the document, enter the passphrase, see it.
- AC: The app signs a decryption record and commits it to Arkiv. The document renders only after the commit is confirmed. Every page carries the same session watermark. Typical time to open is under 10 seconds.
- AC: If Arkiv is unavailable, opening fails closed with a clear message.

**US-4 Trace a leak (Investigator).** Upload a leaked file.
- AC: The app extracts the watermark, shows a confidence score, finds the matching Arkiv record, verifies the recipient signature, and shows the recipient pseudonym and its identity from the org directory.
- AC: If extraction fails or confidence is low, it says so and does not guess.
- AC: One click exports an **evidence bundle** (JSON + PDF) that the CLI verifier can check offline and against Arkiv.

**US-5 Verify independently (Auditor).** Use the public verifier page or the `arctrace-verify` CLI.
- AC: It re-checks signatures, the hash chain, Merkle anchors and Arkiv entity existence without any ArcTrace server access.

**US-6 Revoke access (Sender or Admin).** Revoke a recipient or a lost key.
- AC: The revocation is recorded on Arkiv. Later open attempts are rejected. Earlier records stay intact.

**US-7 Watch for tampering (Admin).** A witness service mirrors Arkiv records and alerts if any disappear or change.
- AC: Deleting a test entity triggers an alert within 5 minutes.

## 5. Functional requirements
| ID | Requirement | Phase |
|---|---|---|
| FR-1 | Hybrid encryption: AES-256-GCM for the file, ML-KEM-768 for per-recipient key wrap | PoC |
| FR-2 | Per-session watermark (64-bit code plus CRC) embedded in the browser | PoC |
| FR-3 | ML-DSA-65 signed decryption record, canonicalized with RFC 8785 | PoC |
| FR-4 | Commit record to Arkiv as a read-only entity with minimal public attributes; query by `wmCode` filtered to trusted creator wallets | PoC |
| FR-5 | Watermark extraction from PNG, JPEG, PDF | PoC |
| FR-6 | Web UI for sender, recipient, investigator | MVP |
| FR-7 | Roles and permissions (RBAC), multi-tenant orgs | MVP |
| FR-8 | Evidence bundle export and CLI verifier | MVP |
| FR-9 | Per-document hash chain (`seq`, `prevRecordHash`) | MVP |
| FR-10 | Gated key release (commit-before-release enforced by a separate service) | Hardening |
| FR-11 | Merkle anchoring and witness watcher | Hardening |
| FR-12 | Expiry keeper that extends Arkiv retention | Hardening |
| FR-13 | Key revocation and rotation | Hardening |
| FR-14 | Text-layer watermark for PDF downloads, zero-width marks for TXT | Hardening |
| FR-15 | Anti-collusion fingerprint codes | Stretch |
| FR-16 | Anchor Merkle roots on Ethereum L1/L2 | Stretch |
| FR-17 | Move record ownership to an auditor wallet after creation | Hardening |
| FR-18 | Sealed (encrypted) payload mode | Hardening |

## 6. Non-functional requirements
- **Security:** no plaintext or private keys on the server; TLS everywhere; strict CSP; rate limiting; secrets from env or KMS, never in the repo.
- **Privacy:** no PII or file names on-chain. IDs are random UUIDs.
- **Performance:** watermark embed under 400 ms per page at 150 DPI; commit-to-render p95 under 10 s (depends on Arkiv); extraction under 30 s for a 20-page leaked PDF.
- **Reliability:** fail closed on ledger errors; outbox with retries; idempotent commits by `sessionId`.
- **Observability:** structured logs, metrics, traces, alerts for commit failures, keeper, witness mismatch.
- **Accessibility and usability:** keyboard friendly, plain language errors.

## 7. Watermark supported-attacks statement (ship this in the product)
| Attack | Target |
|---|---|
| Copy file as is | Always recovered |
| JPEG quality 60 or higher | Recovered (acceptance: at least 99% on test set) |
| Resize 70 to 100% | Recovered |
| Screenshot at 1x or 2x | Recovered |
| Crop up to 10% | Recovered with grid search |
| Grayscale, light noise | Recovered |
| Print then scan | Best effort, reported with confidence |
| Photo of a screen | Best effort, often fails |
| Collusion (comparing copies from several recipients) | Not defended in v1; Stretch FR-15 |

## 8. Success metrics
- Extraction success on the attack suite meets the targets above.
- False positive rate is negligible (extracted code must also match a ledger record and verify against that record).
- A new engineer can run the whole product locally with one command.
- Hackathon: a live demo goes from share to open to leak to named recipient in under 4 minutes.

## 9. Milestones
| Milestone | Outcome |
|---|---|
| **PoC** | CLI end to end: encrypt, open, watermark, sign, commit to Arkiv, extract, trace |
| **MVP** | Web app for the three main roles, evidence bundle, CLI verifier |
| **Hardened** | Gate, anchors, witness, keeper, revocation, RBAC, rate limits |
| **Production** | CI/CD, monitoring, backups, security review, runbooks, load test |
| **Stretch** | Collusion codes, L1/L2 anchoring, photo robustness, private DB-Chain |

## 10. Risks
| Risk | Mitigation |
|---|---|
| Arkiv API or limits differ from assumptions | Spike S1 first; adapter plus mock |
| Payload too big (3.3 KB signature) | Measure; fallback stores signature hash plus off-chain copy, with a note |
| Owner wallet can edit or delete its entities | Read-only flag, ownership moved to an auditor wallet, anchors, witness mirror (confirm in spike S1) |
| Fake records planted on the public chain | Every lookup filters by trusted `$creator`; signatures checked against registered keys |
| Client bypass (offline decrypt with own key) | Gated release (FR-10) |
| Watermark weak against photos or collusion | Honest coverage statement; confidence scores; stretch goals |
| Testnet only | Say so plainly; keep adapter portable |
| 2-day deadline | Use the cut line in checklist.md |

## 11. Demo script (5 minutes)
1. Sender shares one PDF with Alice, Bob and Carol.
2. Alice and Bob open it. Show the read-only Arkiv entities appearing.
3. A "leaked" screenshot of Bob's copy is uploaded by the investigator.
4. ArcTrace extracts the watermark, shows the query by `wmCode` (filtered to our writer wallet), names Bob, then shows confidence, the signature check, the Arkiv entity and the evidence bundle.
5. An admin deletes an entity in a test. The witness raises an alert.
6. Close with the "Why India" evidence and the supported-attacks table.