/**
 * ArkivAdapter: maps the LedgerAdapter contract onto the Tiramisu testnet via
 * @arkiv-network/sdk 0.8.1. Every fact here was checked against docs.arkiv.network
 * and re-verified in spike S1 (docs/arkiv-notes.md).
 *
 * On-chain attribute names are snake_case (Arkiv rejects uppercase); values are
 * typed: seq/ts as u64, everything else str. `kind` is always set and is part of
 * every query. Every query filters $creator to the trusted writer set.
 */
import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
  NoEntityFoundError,
} from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { addr, str, u64 } from "@arkiv-network/sdk/attr";
import { and, eq, or, type Expression } from "@arkiv-network/sdk/query";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, http } from "viem";
import { assertAllowedAttributes } from "./attributes.js";
import { LEDGER_ERROR, LedgerError } from "./types.js";
import type {
  LedgerAdapter,
  LedgerEntity,
  LedgerEntityInput,
  LedgerRef,
  QueryOptions,
  QueryPage,
} from "./types.js";
import type { LedgerKind } from "@arctrace/shared";

const NUMERIC_ATTRS = new Set(["seq", "ts", "from_seq", "to_seq"]);

function toAttrValue(name: string, v: string | number) {
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new LedgerError(LEDGER_ERROR.invalidAttribute, `${name} must be an integer`);
    return u64(BigInt(v));
  }
  if (NUMERIC_ATTRS.has(name)) return u64(BigInt(v));
  return str(v);
}

function fromAttrValue(a: { type: string; value: unknown }): string | number {
  if (a.type === "u64" || a.type === "u256") return Number(a.value as bigint);
  if (a.type === "i32") return a.value as number;
  if (a.type === "bool") return String(a.value);
  return String(a.value);
}

export interface ArkivAdapterOptions {
  /** Hex private key of the writer wallet (0x...). */
  privateKey: `0x${string}`;
  /** Optional RPC URL override. */
  rpcUrl?: string;
  /** Auditor wallet that receives ownership after creation. */
  auditor?: string;
}

export class ArkivAdapter implements LedgerAdapter {
  readonly name = "arkiv";
  private wallet;
  private pub;
  private writer: string;
  private auditor?: string;
  private idem = new Map<string, string>();

  constructor(opts: ArkivAdapterOptions) {
    // Accept raw 64-char hex as well as 0x-prefixed keys from .env.
    const pk = (
      opts.privateKey.startsWith("0x") ? opts.privateKey : `0x${opts.privateKey}`
    ) as `0x${string}`;
    const account = privateKeyToAccount(pk);
    const transport = http(opts.rpcUrl);
    this.wallet = createWalletClient({ chain: tiramisu, transport, account });
    this.pub = createPublicClient({ chain: tiramisu, transport });
    this.writer = account.address;
    this.auditor = opts.auditor;
  }

  trustedWriters(): string[] {
    return [this.writer];
  }

  auditorAddress(): string | undefined {
    return this.auditor;
  }

  async commit(e: LedgerEntityInput): Promise<LedgerRef> {
    // Enforce the same privacy allow-list as MockAdapter: no attribute name may
    // leak filenames or other private metadata onto the public ledger.
    assertAllowedAttributes(e.attributes);
    const cached = this.idem.get(e.idempotencyKey);
    if (cached) {
      const entity = await this.getByKey(cached);
      if (entity) {
        return {
          entityKey: cached,
          blockNumber: Number(entity.createdAt),
          committedAt: new Date().toISOString(),
        };
      }
    }
    const attributes: Record<string, ReturnType<typeof toAttrValue>> = {
      kind: str(e.kind),
    };
    for (const [k, v] of Object.entries(e.attributes)) {
      if (k === "kind") continue;
      attributes[k] = toAttrValue(k, v);
    }
    // Arkiv durations are multiples of 2 seconds.
    const seconds = Math.max(2, Math.ceil(e.retentionSeconds / 2) * 2);
    try {
      const { entityKey, txHash, expiresAt } = await this.wallet.createEntity({
        payload: e.payload,
        contentType: e.payloadMode === "sealed" ? "application/x-arctrace-sealed" : "application/json",
        attributes,
        expires: ExpirationTime.fromSeconds(seconds),
        flags: { readonly: e.readOnly },
      });
      this.idem.set(e.idempotencyKey, entityKey);
      return {
        entityKey,
        txHash,
        blockNumber: Number(expiresAt),
        committedAt: new Date().toISOString(),
      };
    } catch (err) {
      throw new LedgerError(LEDGER_ERROR.unavailable, `arkiv createEntity failed: ${(err as Error).message}`);
    }
  }

  private toLedgerEntity(e: any): LedgerEntity {
    const attributes: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(e.attributes ?? {})) {
      attributes[k] = fromAttrValue(v as { type: string; value: unknown });
    }
    return {
      key: e.key,
      creator: e.creator,
      owner: e.owner,
      attributes,
      payload: e.payload as Uint8Array,
      contentType: e.contentType,
      createdAt: e.createdAt as bigint,
      updatedAt: e.updatedAt as bigint,
      expiresAt: e.expiresAt as bigint,
      readOnly: Boolean(e.creationFlags?.readonly),
      payloadMode:
        e.contentType === "application/x-arctrace-sealed" ? "sealed" : "plain",
    };
  }

  async getByKey(entityKey: string): Promise<LedgerEntity | null> {
    try {
      const e = await this.pub.getEntity(entityKey as `0x${string}`);
      return this.toLedgerEntity(e);
    } catch (err) {
      if (err instanceof NoEntityFoundError) return null;
      throw new LedgerError(LEDGER_ERROR.unavailable, `arkiv getEntity failed: ${(err as Error).message}`);
    }
  }

  async query(
    kind: LedgerKind,
    where: Record<string, string | number>,
    opts: QueryOptions,
  ): Promise<QueryPage> {
    if (!opts.creators.length)
      throw new LedgerError(LEDGER_ERROR.untrustedCreator, "query without a trusted creator set is forbidden");
    const predicates: Expression[] = [eq("kind", str(kind))];
    for (const [k, v] of Object.entries(where)) predicates.push(eq(k, toAttrValue(k, v)));
    const creatorPreds = opts.creators.map((c) => eq("$creator", addr(c as `0x${string}`)));
    predicates.push(creatorPreds.length === 1 ? creatorPreds[0]! : or(...creatorPreds));
    const expr = and(...predicates);

    const limit = opts.limit ?? 100;
    let page: any;
    try {
      const builder = this.pub
        .select({
          key: true,
          owner: true,
          creator: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
          creationFlags: true,
          contentType: true,
          payload: true,
          attributes: true,
        })
        .where(expr)
        .limit(limit);
      if (opts.cursor) builder.cursor(opts.cursor);
      page = await builder.fetch();
    } catch (err) {
      throw new LedgerError(LEDGER_ERROR.unavailable, `arkiv query failed: ${(err as Error).message}`);
    }
    const items: LedgerEntity[] = page.entities.map((e: any) => this.toLedgerEntity(e));
    // Defence in depth: drop anything whose creator is not trusted.
    const trusted = new Set(opts.creators.map((c) => c.toLowerCase()));
    const filtered = items.filter((i) => trusted.has(i.creator.toLowerCase()));
    const out: QueryPage = { items: filtered };
    if (page.hasNextPage()) out.next = page.cursor;
    return out;
  }

  async extendRetention(entityKey: string, extraSeconds: number): Promise<void> {
    const seconds = Math.max(2, Math.ceil(extraSeconds / 2) * 2);
    try {
      await this.wallet.extendEntity({
        entityKey: entityKey as `0x${string}`,
        expires: ExpirationTime.fromSeconds(seconds),
      });
    } catch (err) {
      throw new LedgerError(LEDGER_ERROR.unavailable, `arkiv extendEntity failed: ${(err as Error).message}`);
    }
  }

  async transferOwnership(entityKey: string, newOwner: string): Promise<void> {
    try {
      // viem requires an EIP-55 checksummed address; normalise any casing the
      // caller supplies (same tolerance as the private-key handling above).
      await this.wallet.changeOwnership({
        entityKey: entityKey as `0x${string}`,
        newOwner: getAddress(newOwner.toLowerCase()),
      });
    } catch (err) {
      throw new LedgerError(LEDGER_ERROR.unavailable, `arkiv changeOwnership failed: ${(err as Error).message}`);
    }
  }

  /** Retried background transfer of every owned entity to the auditor. */
  async transferToAuditorIfConfigured(entityKey: string): Promise<boolean> {
    if (!this.auditor) return false;
    await this.transferOwnership(entityKey, this.auditor);
    return true;
  }

  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    const t0 = Date.now();
    try {
      await this.pub.getBlockNumber();
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch {
      return { ok: false, latencyMs: Date.now() - t0 };
    }
  }
}
