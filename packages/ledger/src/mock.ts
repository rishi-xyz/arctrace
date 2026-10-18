/**
 * In-memory LedgerAdapter that mimics the Arkiv semantics confirmed in
 * spike S1 (see docs/arkiv-notes.md):
 *   - readonly blocks patch (attribute/payload change) but NOT extension,
 *     ownership transfer, or deletion;
 *   - creator never changes, owner changes on transfer;
 *   - expiry removes the entity from reads.
 * Optional file persistence (JSON) so a PoC run survives process restarts.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { bytesToHex } from "@arctrace/crypto";
import { LEDGER_ERROR, LedgerError } from "./types.js";
import type {
  LedgerAdapter,
  LedgerEntity,
  LedgerEntityInput,
  LedgerRef,
  QueryOptions,
  QueryPage,
} from "./types.js";
import { assertAllowedAttributes } from "./attributes.js";
import type { LedgerKind } from "@arctrace/shared";

interface StoredEntity extends LedgerEntity {
  idempotencyKey: string;
  deleted?: boolean;
}

interface PersistShape {
  /** Same as StoredEntity but with the payload serialized as a plain array
   *  so it survives a JSON round-trip. */
  entities: Array<Omit<StoredEntity, "payload"> & { payload: number[] }>;
  counter: number;
}

const NOW_BLOCK = () => BigInt(Math.floor(Date.now() / 2000));

export class MockAdapter implements LedgerAdapter {
  readonly name = "mock";
  private entities = new Map<string, StoredEntity>();
  private byIdem = new Map<string, string>();
  private counter = 0;
  private writer: string;
  private auditor: string;

  constructor(opts: { writer?: string; auditor?: string; file?: string } = {}) {
    this.writer = opts.writer ?? "0x00000000000000000000000000000000000000A1";
    this.auditor = opts.auditor ?? "0x00000000000000000000000000000000000000AD";
    if (opts.file && existsSync(opts.file)) {
      const data = JSON.parse(readFileSync(opts.file, "utf8")) as PersistShape;
      this.counter = data.counter;
      for (const e of data.entities) {
        const ent: StoredEntity = { ...e, payload: new Uint8Array(e.payload) };
        this.entities.set(ent.key, ent);
        this.byIdem.set(ent.idempotencyKey, ent.key);
      }
    }
  }

  trustedWriters(): string[] {
    return [this.writer];
  }

  auditorAddress(): string {
    return this.auditor;
  }

  private assertTrusted(creator: string, opts: QueryOptions): boolean {
    return opts.creators.map((c) => c.toLowerCase()).includes(creator.toLowerCase());
  }

  async commit(e: LedgerEntityInput): Promise<LedgerRef> {
    assertAllowedAttributes(e.attributes);
    const existingKey = this.byIdem.get(e.idempotencyKey);
    if (existingKey) {
      const ex = this.entities.get(existingKey)!;
      return {
        entityKey: ex.key,
        txHash: `0xmock-idem-${e.idempotencyKey}`,
        blockNumber: Number(ex.createdAt),
        committedAt: new Date().toISOString(),
      };
    }
    const key = `0xmock${(++this.counter).toString(16).padStart(60, "0")}`;
    const now = NOW_BLOCK();
    const blocks = BigInt(Math.floor(e.retentionSeconds / 2));
    const entity: StoredEntity = {
      key,
      creator: this.writer,
      owner: this.writer,
      // The kind is always an indexed attribute (mirrors ArkivAdapter), so
      // query(kind, ...) can match on it.
      attributes: { ...e.attributes, kind: e.kind },
      payload: new Uint8Array(e.payload),
      contentType: e.payloadMode === "sealed" ? "application/x-arctrace-sealed" : "application/json",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + blocks,
      readOnly: e.readOnly,
      payloadMode: e.payloadMode,
      idempotencyKey: e.idempotencyKey,
    };
    this.entities.set(key, entity);
    this.byIdem.set(e.idempotencyKey, key);
    return {
      entityKey: key,
      txHash: `0xmock${this.counter.toString(16).padStart(64, "0")}`,
      blockNumber: Number(now),
      committedAt: new Date().toISOString(),
    };
  }

  private live(key: string): StoredEntity | null {
    const e = this.entities.get(key);
    if (!e || e.deleted) return null;
    if (e.expiresAt <= NOW_BLOCK()) return null;
    return e;
  }

  async getByKey(entityKey: string): Promise<LedgerEntity | null> {
    const e = this.live(entityKey);
    if (!e) return null;
    const { idempotencyKey: _i, deleted: _d, ...rest } = e;
    void _i;
    void _d;
    return rest;
  }

  async query(
    kind: LedgerKind,
    where: Record<string, string | number>,
    opts: QueryOptions,
  ): Promise<QueryPage> {
    if (!opts.creators.length)
      throw new LedgerError(
        LEDGER_ERROR.untrustedCreator,
        "query without a trusted creator set is forbidden",
      );
    const items: LedgerEntity[] = [];
    const now = NOW_BLOCK();
    for (const e of this.entities.values()) {
      if (e.deleted || e.expiresAt <= now) continue;
      if (e.attributes.kind !== kind) continue;
      if (!this.assertTrusted(e.creator, opts)) continue;
      let matches = true;
      for (const [k, v] of Object.entries(where)) {
        if (e.attributes[k] !== v) {
          matches = false;
          break;
        }
      }
      if (matches) {
        const { idempotencyKey: _i, deleted: _d, ...rest } = e;
        void _i;
        void _d;
        items.push(rest);
      }
    }
    items.sort((a, b) => Number(b.createdAt - a.createdAt));
    const limit = opts.limit ?? items.length;
    return { items: items.slice(0, limit) };
  }

  async extendRetention(entityKey: string, extraSeconds: number): Promise<void> {
    const e = this.live(entityKey);
    if (!e) throw new LedgerError(LEDGER_ERROR.notFound, `no entity ${entityKey}`);
    // Arkiv semantics: owner OR permissionlessExtension can extend.
    e.expiresAt += BigInt(Math.floor(extraSeconds / 2));
  }

  async transferOwnership(entityKey: string, newOwner: string): Promise<void> {
    const e = this.live(entityKey);
    if (!e) throw new LedgerError(LEDGER_ERROR.notFound, `no entity ${entityKey}`);
    if (e.owner.toLowerCase() !== this.writer.toLowerCase())
      throw new LedgerError(LEDGER_ERROR.notOwner, "writer no longer owns entity");
    e.owner = newOwner;
  }

  /** Test hook: write a record as a DIFFERENT wallet (planted-record tests). */
  async commitAs(writer: string, e: LedgerEntityInput): Promise<LedgerRef> {
    const prev = this.writer;
    this.writer = writer;
    try {
      return await this.commit(e);
    } finally {
      this.writer = prev;
    }
  }

  /** Test hook: emulate an admin deleting an entity (witness chaos test). */
  async deleteForTest(entityKey: string): Promise<void> {
    const e = this.entities.get(entityKey);
    if (e) e.deleted = true;
  }

  /** Test hook: emulate a patch attempt; enforces readonly like Arkiv. */
  async patchForTest(entityKey: string, set: Record<string, string | number>): Promise<void> {
    const e = this.live(entityKey);
    if (!e) throw new LedgerError(LEDGER_ERROR.notFound, `no entity ${entityKey}`);
    if (e.readOnly) throw new LedgerError(LEDGER_ERROR.readOnly, "readonly entity");
    Object.assign(e.attributes, set);
    e.updatedAt = NOW_BLOCK();
  }

  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    return { ok: true, latencyMs: 0 };
  }

  /** Persist to a JSON file (payloads as base64). */
  persist(file: string): void {
    const shape: PersistShape = {
      counter: this.counter,
      entities: [...this.entities.values()].map((e) => ({
        ...e,
        payload: Array.from(e.payload),
      })),
    };
    writeFileSync(file, JSON.stringify(shape));
  }

  static payloadHex(p: Uint8Array): string {
    return bytesToHex(p);
  }
}
