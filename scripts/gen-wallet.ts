/**
 * Generate an Arkiv writer wallet and write it to .env (never committed).
 * Prints the address to fund at https://hub.arkiv.network/faucet
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = new URL("../.env", import.meta.url).pathname;
const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

let env = "";
if (existsSync(envPath)) {
  env = readFileSync(envPath, "utf8");
  if (env.includes("ARKIV_PRIVATE_KEY=")) {
    console.error("ARKIV_PRIVATE_KEY already set in .env — refusing to overwrite.");
    console.error("Delete the line manually if you really want a new wallet.");
    process.exit(1);
  }
}
env += `\n# ArcTrace writer wallet (testnet). NEVER commit this file.\nARKIV_PRIVATE_KEY=${pk}\n`;
writeFileSync(envPath, env, { mode: 0o600 });

console.log("Writer wallet generated.");
console.log(`  Address: ${account.address}`);
console.log(`  Fund it: https://hub.arkiv.network/faucet (paste the address, complete sign-in)`);
console.log(`  Then:    pnpm spike:s1`);
