/**
 * Trace worker: watermark extraction → ledger query → signature + chain
 * verification → structured result (spec §5, checklist Phase 2 "trace").
 *
 * The result is written even on an honest negative (no watermark found) so an
 * investigator always gets a report; only exceptions mark the trace 'failed'.
 * Fail-closed: ledger read errors fail the trace rather than reporting a
 * fabricated all-clear.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  canonicalize,
  fingerprint,
  fromBase64,
  sha256Hex,
  verify,
} from "@arctrace/crypto";
import { DOMAIN, SignedDecryptionRecordSchema, type TraceResult } from "@arctrace/shared";
import { extractRaster, type ImageDataLike } from "@arctrace/watermark";
import { wmKeyFor } from "@arctrace/crypto";
import type { Db } from "arctrace-api/db";
import type { ApiConfig } from "arctrace-api/config";
import { documents, openSessions, traces, users } from "arctrace-api/schema";
import { getLedger, trustedWriters } from "arctrace-api/ledger";
import { getObject } from "arctrace-api/s3";
import { decodeLeak, extractFromText } from "./decode.js";

const QUERY_PAGE = 100;
const QUERY_MAX_PAGES = 20;

interface Extraction {
  ok: boolean;
  wmCode: string | null;
  confidence: number;
  attempts: number;
}

/** Extract the watermark by trying every candidate document's derived key. */
async function extractWm(
  decoded: Awaited<ReturnType<typeof decodeLeak>>,
  docIds: string[],
  config: ApiConfig,
): Promise<Extraction> {
  let attempts = 0;

  // Text carriers (txt, PDF text layer) embed zero-width bits keyed per doc.
  if (decoded.text) {
    const direct = extractFromText(decoded.text);
    attempts++;
    if (direct.ok && direct.wmCode) {
      return { ok: true, wmCode: direct.wmCode, confidence: 1, attempts };
    }
  }

  if (decoded.kind === "raster" && decoded.images.length > 0) {
    for (const docId of docIds) {
      const keyWm = wmKeyFor(docId, config.wmMaster);
      for (const img of decoded.images as ImageDataLike[]) {
        attempts++;
        const r = extractRaster(img, keyWm, { searchScales: true });
        if (r.ok && r.wmCode) {
          return { ok: true, wmCode: r.wmCode, confidence: r.confidence, attempts };
        }
      }
    }
  }
  return { ok: false, wmCode: null, confidence: 0, attempts };
}

/** All committed decryption events for a document, trusted creators only. */
async function queryDocChain(docId: string) {
  const ledger = getLedger();
  const creators = trustedWriters();
  const items = [];
  let cursor: string | undefined;
  for (let page = 0; page < QUERY_MAX_PAGES; page++) {
    const res = await ledger.query("decryption_event", { doc_id: docId }, { creators, limit: QUERY_PAGE, cursor });
    items.push(...res.items);
    if (!res.next) break;
    cursor = res.next;
  }
  return items;
}

export async function processTrace(db: Db, config: ApiConfig, traceId: string): Promise<void> {
  const rows = await db.select().from(traces).where(eq(traces.id, traceId)).limit(1);
  const trace = rows[0];
  if (!trace) return;
  if (trace.status !== "processing") return;

  const checks: TraceResult["checks"] = [];
  try {
    const bytes = await getObject(config, trace.fileKey);
    if (!bytes) throw new Error("Leaked file missing from object storage");

    const decoded = await decodeLeak(trace.fileKind ?? "txt", bytes);

    // Candidate documents: anything that ever had a committed open session.
    const sessions = await db
      .select({ docId: openSessions.docId })
      .from(openSessions)
      .where(eq(openSessions.status, "committed"));
    const docIds = [...new Set(sessions.map((s) => s.docId))];

    const extraction = await extractWm(decoded, docIds, config);
    checks.push({
      name: "watermark extracted from leaked file",
      ok: extraction.ok,
      detail: extraction.ok
        ? `wmCode=${extraction.wmCode} confidence=${extraction.confidence.toFixed(3)} (${extraction.attempts} attempts)`
        : `no watermark found (${extraction.attempts} attempts across ${docIds.length} candidate documents)`,
    });

    // Ledger query by wmCode + trusted creator (spec §5).
    let hits: Awaited<ReturnType<typeof getLedger>["query"]>["items"] = [];
    const expression = extraction.wmCode
      ? `kind=decryption_event AND wm_code=${extraction.wmCode} AND $creator∈trusted(${trustedWriters().length})`
      : "kind=decryption_event AND (skipped: no watermark)";
    if (extraction.wmCode) {
      const ledger = getLedger();
      const res = await ledger.query(
        "decryption_event",
        { wm_code: extraction.wmCode },
        { creators: trustedWriters(), limit: QUERY_PAGE },
      );
      hits = res.items;
    }
    checks.push({
      name: "record found by wmCode + trusted $creator",
      ok: hits.length > 0,
      detail: `${hits.length} hit(s)`,
    });

    // Verify the first hit deeply (unique wmCode ⇒ one honest record expected).
    let record: TraceResult["record"] = null;
    let entityKey: string | null = null;
    let creator: string | null = null;
    let recordVerified = false;
    let recipient: TraceResult["recipient"] = null;
    let chain: TraceResult["chain"] = null;

    const hit = hits[0];
    if (hit) {
      entityKey = hit.key;
      creator = hit.creator;
      const parsed = SignedDecryptionRecordSchema.safeParse(
        JSON.parse(new TextDecoder().decode(hit.payload)),
      );
      checks.push({
        name: "payload parses under SignedDecryptionRecord schema",
        ok: parsed.success,
        detail: parsed.success ? "strict schema ok" : parsed.error.message.slice(0, 200),
      });

      if (parsed.success) {
        record = parsed.data;
        const rec = parsed.data.record;

        // Signer key on the ledger, fingerprint-checked (fail closed).
        const ledger = getLedger();
        const keyReg = await ledger.query(
          "key_registration",
          { key_fp: rec.recipientSigKeyFp },
          { creators: trustedWriters(), limit: 10 },
        );
        let pkOk = false;
        let sigOk = false;
        if (keyReg.items[0]) {
          try {
            const kr = JSON.parse(new TextDecoder().decode(keyReg.items[0].payload)) as {
              sigPk: string;
            };
            const pk = fromBase64(kr.sigPk);
            pkOk = fingerprint(pk) === rec.recipientSigKeyFp;
            sigOk = pkOk && verify(DOMAIN.decryption, canonicalize(rec), fromBase64(parsed.data.sig), pk);
          } catch {
            pkOk = false;
            sigOk = false;
          }
        }
        checks.push({
          name: "signer key registered and fingerprint matches",
          ok: pkOk,
          detail: pkOk ? `key_fp=${rec.recipientSigKeyFp}` : "no trusted key_registration for record's key_fp",
        });
        checks.push({
          name: "ML-DSA-65 signature verifies over JCS record",
          ok: sigOk,
          detail: sigOk ? "signature valid" : "signature verification failed",
        });
        checks.push({
          name: "record wmCode matches extracted watermark",
          ok: rec.wmCode === extraction.wmCode,
          detail: `record=${rec.wmCode} extracted=${extraction.wmCode}`,
        });
        recordVerified = sigOk && rec.wmCode === extraction.wmCode;

        // Recipient identity from Postgres (local, notarized in bundle).
        const u = await db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(eq(users.id, rec.recipientId))
          .limit(1);
        recipient = u[0]
          ? { recipientId: u[0].id, displayName: u[0].displayName }
          : { recipientId: rec.recipientId, displayName: null };

        // Chain neighbors for this document (spec §5 / §6).
        const all = await queryDocChain(rec.docId);
        const bySeq = new Map<number, (typeof all)[number]>();
        for (const e of all) bySeq.set(Number(e.attributes.seq ?? -1), e);
        const prev = bySeq.get(rec.seq - 1) ?? null;
        const next = bySeq.get(rec.seq + 1) ?? null;
        const prevOk = rec.prevRecordHash === null
          ? rec.seq === 0
          : !!prev && sha256Hex(prev.payload) === rec.prevRecordHash;
        // A successor, if present, must hash-link back to this record;
        // when this record is the chain terminator there is nothing to link.
        const nextOk = next ? chainNextOk(hit.payload, next.payload) : rec.seq >= maxSeqOf(bySeq);
        chain = {
          seq: rec.seq,
          prevRecordHash: rec.prevRecordHash,
          prevEntityKey: prev ? prev.key : null,
          prevOk,
          nextCount: next ? 1 : 0,
          nextOk,
        };
        checks.push({
          name: "chain linkage (prev record hash + successor)",
          ok: prevOk && nextOk,
          detail: `seq=${rec.seq} prev=${prevOk ? "linked" : "broken"} next=${nextOk ? "terminator or linked" : "broken"}`,
        });
      }
    }

    const result: TraceResult = {
      fileKind: (["png", "jpeg", "pdf", "txt"] as const).includes(trace.fileKind as never)
        ? (trace.fileKind as TraceResult["fileKind"])
        : "txt",
      leakedSha256: trace.leakedSha256 as TraceResult["leakedSha256"],
      extraction: {
        ok: extraction.ok,
        wmCode: (extraction.wmCode as TraceResult["extraction"]["wmCode"]) ?? null,
        confidence: extraction.confidence,
        alignment: { dx: 0, dy: 0, scale: 1 },
        attempts: extraction.attempts,
      },
      query: { expression, hits: hits.length },
      record,
      entityKey,
      creator,
      recordVerified,
      recipient,
      chain,
      checks,
    };

    // Validate before persisting — a malformed result never reaches the UI.
    const validated = (await import("@arctrace/shared")).TraceResultSchema.parse(result);
    await db
      .update(traces)
      .set({ status: "done", resultJson: validated, completedAt: new Date(), error: null })
      .where(eq(traces.id, traceId));
  } catch (err) {
    await db
      .update(traces)
      .set({ status: "failed", error: (err as Error).message.slice(0, 500), completedAt: new Date() })
      .where(eq(traces.id, traceId));
  }
}

function chainNextOk(thisPayload: Uint8Array, nextPayload: Uint8Array): boolean {
  try {
    const next = SignedDecryptionRecordSchema.parse(
      JSON.parse(new TextDecoder().decode(nextPayload)),
    );
    return next.record.prevRecordHash === sha256Hex(thisPayload);
  } catch {
    return false;
  }
}

function maxSeqOf(bySeq: Map<number, unknown>): number {
  let max = -1;
  for (const k of bySeq.keys()) if (k > max) max = k;
  return max;
}

/** Claim the oldest pending trace atomically (pending → processing). */
export async function claimNextTrace(db: Db): Promise<string | null> {
  const rows = await db
    .select({ id: traces.id })
    .from(traces)
    .where(eq(traces.status, "pending"))
    .orderBy(asc(traces.createdAt))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) return null;
  const claimed = await db
    .update(traces)
    .set({ status: "processing" })
    .where(and(eq(traces.id, id), eq(traces.status, "pending")))
    .returning({ id: traces.id });
  return claimed[0]?.id ?? null;
}
