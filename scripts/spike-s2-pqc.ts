/**
 * Spike S2: PQC measurements (checklist Phase 0 S2).
 * Prints key/signature sizes, argument orders verified by round trip, and
 * timing. Results are pasted into docs/decisions.md by the agent.
 */
import { performance } from "node:perf_hooks";
import { DOMAIN } from "@arctrace/shared";
import {
  generateKemKeyPair,
  generateSigKeyPair,
  kemDecapsulate,
  kemEncapsulate,
  sign,
  SIZE,
  verify,
} from "@arctrace/crypto";

function time<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  const out = fn();
  console.log(`  ${label}: ${(performance.now() - t0).toFixed(1)} ms`);
  return out;
}

console.log("S2 PQC spike (@noble/post-quantum)");
const kem = time("ML-KEM-768 keygen", () => generateKemKeyPair());
const { cipherText, sharedSecret } = time("ML-KEM-768 encapsulate", () =>
  kemEncapsulate(kem.publicKey),
);
const ss2 = time("ML-KEM-768 decapsulate", () => kemDecapsulate(cipherText, kem.secretKey));
console.log(`  kem pk/sk/ct/ss: ${kem.publicKey.length}/${kem.secretKey.length}/${cipherText.length}/${ss2.length}`);
console.log(`  decapsulate matches: ${Buffer.compare(ss2, sharedSecret) === 0}`);
console.log(`  constants match: ${kem.publicKey.length === SIZE.kemPk && cipherText.length === SIZE.kemCt}`);

const dsa = time("ML-DSA-65 keygen", () => generateSigKeyPair());
const msg = new TextEncoder().encode(JSON.stringify({ hello: "arctrace", seq: 1 }));
const sig = time("ML-DSA-65 sign", () => sign(DOMAIN.decryption, msg, dsa.secretKey));
console.log(`  dsa pk/sk/sig: ${dsa.publicKey.length}/${dsa.secretKey.length}/${sig.length}`);
console.log(`  verify ok: ${verify(DOMAIN.decryption, msg, sig, dsa.publicKey)}`);
console.log(`  wrong domain fails: ${!verify(DOMAIN.trace, msg, sig, dsa.publicKey)}`);
console.log(`  constants match: ${sig.length === SIZE.dsaSig && dsa.publicKey.length === SIZE.dsaPk}`);
console.log("\nArgument orders (0.7.1): ml_dsa65.sign(msg, sk) / ml_dsa65.verify(sig, msg, pk)");
