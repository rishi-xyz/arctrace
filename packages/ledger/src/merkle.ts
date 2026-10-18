/**
 * Binary Merkle tree (spec.md section 4.2).
 * Leaves: sha256(entityKey || sha256(payload)), ordered by (kind, seq).
 */
import { sha256 } from "@noble/hashes/sha2.js";

export function leafHash(entityKey: string, payload: Uint8Array): Uint8Array {
  const inner = sha256(payload);
  const keyBytes = new TextEncoder().encode(entityKey);
  const buf = new Uint8Array(keyBytes.length + inner.length);
  buf.set(keyBytes, 0);
  buf.set(inner, keyBytes.length);
  return sha256(buf);
}

function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set(a, 0);
  buf.set(b, 32);
  return sha256(buf);
}

export interface MerkleTree {
  root: Uint8Array;
  leaves: Uint8Array[];
  /** levels[0] = leaves, levels[last] = [root] */
  levels: Uint8Array[][];
}

export function buildTree(leaves: Uint8Array[]): MerkleTree {
  if (leaves.length === 0) throw new Error("empty tree");
  const levels: Uint8Array[][] = [leaves];
  let cur = leaves;
  while (cur.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      const l = cur[i]!;
      const r = cur[i + 1] ?? l; // duplicate last leaf on odd count
      next.push(hashPair(l, r));
    }
    levels.push(next);
    cur = next;
  }
  return { root: cur[0]!, leaves, levels };
}

export interface MerkleProof {
  leafIndex: number;
  /** sibling hash + side per level from leaf to root */
  path: Array<{ hash: Uint8Array; side: "L" | "R" }>;
}

export function proof(tree: MerkleTree, leafIndex: number): MerkleProof {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) throw new Error("leaf out of range");
  const path: MerkleProof["path"] = [];
  let idx = leafIndex;
  for (let l = 0; l < tree.levels.length - 1; l++) {
    const level = tree.levels[l]!;
    const sibling = idx ^ 1;
    if (sibling < level.length) {
      path.push({ hash: level[sibling]!, side: sibling > idx ? "R" : "L" });
    } else {
      path.push({ hash: level[idx]!, side: "L" }); // duplicated leaf
    }
    idx = idx >> 1;
  }
  return { leafIndex, path };
}

export function verifyProof(leaf: Uint8Array, p: MerkleProof, root: Uint8Array): boolean {
  let cur = leaf;
  for (const step of p.path) {
    cur = step.side === "L" ? hashPair(step.hash, cur) : hashPair(cur, step.hash);
  }
  return Buffer.compare(cur, root) === 0;
}
