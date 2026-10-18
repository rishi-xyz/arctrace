/**
 * Contract test suite for LedgerAdapter. Runs against the MockAdapter always,
 * and against the real Arkiv testnet when ARKIV_E2E=1 and ARKIV_PRIVATE_KEY is
 * set with a funded wallet (spec.md section 4.1: one suite for both adapters).
 */
import { describe, expect, it } from "vitest";
import { canonicalize, sha256Hex } from "@arctrace/crypto";
import { MockAdapter } from "../src/mock.js";
import type { LedgerAdapter } from "../src/types.js";

const RETENTION = 3600; // 1h
const payloadFor = (tag: string) => canonicalize({ schema: "arctrace.test/1", tag });

function adapters(): Array<{ name: string; make: () => Promise<LedgerAdapter> }> {
  const list: Array<{ name: string; make: () => Promise<LedgerAdapter> }> = [
    { name: "mock", make: async () => new MockAdapter() },
  ];
  if (process.env.ARKIV_E2E === "1" && process.env.ARKIV_PRIVATE_KEY) {
    list.push({
      name: "arkiv",
      make: async () => {
        const { ArkivAdapter } = await import("../src/arkiv.js");
        return new ArkivAdapter({
          privateKey: process.env.ARKIV_PRIVATE_KEY as `0x${string}`,
          rpcUrl: process.env.ARKIV_RPC_URL,
        });
      },
    });
  }
  return list;
}

for (const { name, make } of adapters()) {
  describe(`LedgerAdapter contract [${name}]`, () => {
    it("commits, reads back, and reports a trusted creator", async () => {
      const a = await make();
      const payload = payloadFor("basic");
      const ref = await a.commit({
        kind: "decryption_event",
        attributes: {
          schema: "arctrace.decryption/1",
          org_id: "6f0a5b3e-0f0f-4a4a-9c9c-0a0a0a0a0a0a",
          doc_id: "11111111-1111-4111-8111-111111111111",
          doc_hash: "a".repeat(64),
          recipient_id: "22222222-2222-4222-8222-222222222222",
          wm_code: "d".repeat(16),
          session_id: "c".repeat(32),
          seq: 0,
        },
        payload,
        retentionSeconds: RETENTION,
        readOnly: true,
        payloadMode: "plain",
        idempotencyKey: `basic-${name}`,
      });
      expect(ref.entityKey).toBeTruthy();

      const e = await a.getByKey(ref.entityKey);
      expect(e).not.toBeNull();
      expect(e!.creator.toLowerCase()).toBe(a.trustedWriters()[0]!.toLowerCase());
      expect(e!.readOnly).toBe(true);
      expect(e!.attributes.wm_code).toBe("d".repeat(16));
      expect(sha256Hex(e!.payload)).toBe(sha256Hex(payload));
    });

    it("is idempotent on the idempotency key", async () => {
      const a = await make();
      const input = {
        kind: "decryption_event" as const,
        attributes: { schema: "arctrace.decryption/1", wm_code: "e".repeat(16), seq: 0 },
        payload: payloadFor("idem"),
        retentionSeconds: RETENTION,
        readOnly: true,
        payloadMode: "plain" as const,
        idempotencyKey: `idem-${name}`,
      };
      const r1 = await a.commit(input);
      const r2 = await a.commit(input);
      expect(r2.entityKey).toBe(r1.entityKey);
    });

    it("queries by attribute AND $creator together", async () => {
      const a = await make();
      const wm = (Math.floor(Math.random() * 1e9) + 1e9).toString(16).padStart(16, "f");
      await a.commit({
        kind: "decryption_event",
        attributes: { schema: "arctrace.decryption/1", wm_code: wm, seq: 0 },
        payload: payloadFor(`q-${wm}`),
        retentionSeconds: RETENTION,
        readOnly: true,
        payloadMode: "plain",
        idempotencyKey: `q-${wm}`,
      });
      const page = await a.query("decryption_event", { wm_code: wm }, { creators: a.trustedWriters() });
      expect(page.items.length).toBe(1);
      expect(page.items[0]!.attributes.wm_code).toBe(wm);
    });

    it("ignores planted records from an untrusted wallet", async () => {
      const a = await make();
      const wm = (Math.floor(Math.random() * 1e9) + 2e9).toString(16).padStart(16, "e");
      // trusted record
      await a.commit({
        kind: "decryption_event",
        attributes: { schema: "arctrace.decryption/1", wm_code: wm, seq: 0 },
        payload: payloadFor(`planted-real-${wm}`),
        retentionSeconds: RETENTION,
        readOnly: true,
        payloadMode: "plain",
        idempotencyKey: `planted-real-${wm}`,
      });
      // planted record with the SAME wmCode, from a second wallet (same store)
      if (name === "mock") {
        const attacker = a as MockAdapter;
        await attacker.commitAs("0x00000000000000000000000000000000000000B2", {
          kind: "decryption_event",
          attributes: { schema: "arctrace.decryption/1", wm_code: wm, seq: 0 },
          payload: payloadFor(`planted-fake-${wm}`),
          retentionSeconds: RETENTION,
          readOnly: true,
          payloadMode: "plain",
          idempotencyKey: `planted-fake-${wm}`,
        });
      } else if (process.env.ARKIV_ATTACKER_KEY) {
        // real planted record from a genuinely untrusted, funded wallet
        const { ArkivAdapter } = await import("../src/arkiv.js");
        const attacker = await new ArkivAdapter({
          privateKey: process.env.ARKIV_ATTACKER_KEY as `0x${string}`,
          rpcUrl: process.env.ARKIV_RPC_URL,
        });
        await attacker.commit({
          kind: "decryption_event",
          attributes: { schema: "arctrace.decryption/1", wm_code: wm, seq: 0 },
          payload: payloadFor(`planted-fake-${wm}`),
          retentionSeconds: RETENTION,
          readOnly: true,
          payloadMode: "plain",
          idempotencyKey: `planted-fake-${wm}`,
        });
      }
      const page = await a.query("decryption_event", { wm_code: wm }, { creators: a.trustedWriters() });
      expect(page.items.length).toBe(1);
      expect(sha256Hex(page.items[0]!.payload)).toBe(sha256Hex(payloadFor(`planted-real-${wm}`)));
    });

    it("refuses a query with an empty creator set", async () => {
      const a = await make();
      await expect(
        a.query("decryption_event", { wm_code: "00" }, { creators: [] }),
      ).rejects.toThrow();
    });

    it("enforces the public attribute allow-list", async () => {
      const a = await make();
      await expect(
        a.commit({
          kind: "decryption_event",
          attributes: { schema: "arctrace.decryption/1", file_name: "secret.pdf" },
          payload: payloadFor("bad-attr"),
          retentionSeconds: RETENTION,
          readOnly: true,
          payloadMode: "plain",
          idempotencyKey: `bad-attr-${name}`,
        }),
      ).rejects.toThrow(/allow-list/);
    });

    it("extends retention", async () => {
      const a = await make();
      const ref = await a.commit({
        kind: "anchor",
        attributes: { schema: "arctrace.anchor/1", org_id: "6f0a5b3e-0f0f-4a4a-9c9c-0a0a0a0a0a0a", from_seq: 0, to_seq: 1 },
        payload: payloadFor(`extend-${name}`),
        retentionSeconds: RETENTION,
        readOnly: true,
        payloadMode: "plain",
        idempotencyKey: `extend-${name}`,
      });
      const before = await a.getByKey(ref.entityKey);
      await a.extendRetention(ref.entityKey, 7200);
      const after = await a.getByKey(ref.entityKey);
      expect(after!.expiresAt > before!.expiresAt).toBe(true);
    });

    it("transfers ownership without changing the creator", async () => {
      const a = await make();
      const ref = await a.commit({
        kind: "doc_manifest",
        attributes: { schema: "arctrace.manifest/1", org_id: "6f0a5b3e-0f0f-4a4a-9c9c-0a0a0a0a0a0a", doc_id: "33333333-3333-4333-8333-333333333333", ts: 1760000000000 },
        payload: payloadFor(`transfer-${name}`),
        retentionSeconds: RETENTION,
        readOnly: true,
        payloadMode: "plain",
        idempotencyKey: `transfer-${name}`,
      });
      const creatorBefore = (await a.getByKey(ref.entityKey))!.creator;
      const newOwner = name === "mock"
        ? "0x00000000000000000000000000000000000000AD"
        : "0x00000000000000000000000000000000000000AD";
      await a.transferOwnership(ref.entityKey, newOwner);
      const after = await a.getByKey(ref.entityKey);
      expect(after!.owner.toLowerCase()).toBe(newOwner.toLowerCase());
      expect(after!.creator).toBe(creatorBefore); // $creator is immutable
      // the creator-filtered query still finds it after the transfer
      const page = await a.query("doc_manifest", { doc_id: "33333333-3333-4333-8333-333333333333" }, { creators: a.trustedWriters() });
      expect(page.items.length).toBeGreaterThanOrEqual(1);
    });

    it("reports health", async () => {
      const a = await make();
      const h = await a.health();
      expect(h.ok).toBe(true);
    });
  });
}

describe("MockAdapter readonly semantics (mirror of Arkiv S1 findings)", () => {
  it("blocks a patch on a readonly entity", async () => {
    const m = new MockAdapter();
    const ref = await m.commit({
      kind: "decryption_event",
      attributes: { schema: "arctrace.decryption/1", wm_code: "11".repeat(8), seq: 0 },
      payload: payloadFor("ro"),
      retentionSeconds: RETENTION,
      readOnly: true,
      payloadMode: "plain",
      idempotencyKey: "ro-1",
    });
    await expect(m.patchForTest(ref.entityKey, { seq: 1 })).rejects.toThrow(/readonly/);
  });

  it("allows extension and deletion of a readonly entity (Arkiv semantics)", async () => {
    const m = new MockAdapter();
    const ref = await m.commit({
      kind: "decryption_event",
      attributes: { schema: "arctrace.decryption/1", wm_code: "22".repeat(8), seq: 0 },
      payload: payloadFor("ro2"),
      retentionSeconds: RETENTION,
      readOnly: true,
      payloadMode: "plain",
      idempotencyKey: "ro-2",
    });
    await m.extendRetention(ref.entityKey, 7200);
    await m.deleteForTest(ref.entityKey);
    expect(await m.getByKey(ref.entityKey)).toBeNull();
  });
});

describe("Merkle", () => {
  it("builds and verifies proofs; any tamper fails", async () => {
    const { buildTree, leafHash, proof, verifyProof } = await import("../src/merkle.js");
    const leaves = [0, 1, 2, 3, 4].map((i) =>
      leafHash(`0xkey${i}`, hexToHexBytes(i)),
    );
    const tree = buildTree(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const p = proof(tree, i);
      expect(verifyProof(leaves[i]!, p, tree.root)).toBe(true);
      expect(verifyProof(leafHash("0xevil", hexToHexBytes(9)), p, tree.root)).toBe(false);
    }
  });
});

function hexToHexBytes(i: number): Uint8Array {
  return new Uint8Array(32).fill(i);
}
