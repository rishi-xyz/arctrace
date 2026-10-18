import { establishWalletSession, api, type SessionUser } from './api';

type InjectedWallet = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global { interface Window { ethereum?: InjectedWallet } }

const CHAIN_ID = 7_738_577;
const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;
const RPC_URL = 'https://rpc.tiramisu.db-chain.testnet.arkiv.network';

export async function signInWithWallet(displayName: string, role: 'sender' | 'recipient' | 'investigator', createAccount: boolean): Promise<SessionUser> {
  const wallet = window.ethereum;
  if (!wallet) throw new Error('No injected Ethereum wallet found. Install MetaMask or another browser wallet.');
  const accounts = await wallet.request({ method: 'eth_requestAccounts' }) as string[];
  const address = accounts[0];
  if (!address) throw new Error('The wallet did not provide an account.');

  let chainId = BigInt(await wallet.request({ method: 'eth_chainId' }) as string);
  if (chainId !== BigInt(CHAIN_ID)) {
    try {
      await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
    } catch {
      await wallet.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN_HEX,
          chainName: 'Tiramisu Testnet',
          nativeCurrency: { name: 'GLM', symbol: 'GLM', decimals: 18 },
          rpcUrls: [RPC_URL],
        }],
      });
    }
    chainId = BigInt(await wallet.request({ method: 'eth_chainId' }) as string);
    if (chainId !== BigInt(CHAIN_ID)) throw new Error('Switch your wallet to the Arkiv Tiramisu testnet and try again.');
  }

  const challenge = await api<{ message: string }>('/auth/wallet/nonce', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
  const signature = await wallet.request({ method: 'personal_sign', params: [challenge.message, address] }) as string;
  return establishWalletSession({ address, message: challenge.message, signature, displayName, role, createAccount });
}
