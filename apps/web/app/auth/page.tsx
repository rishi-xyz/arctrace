'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthScreen } from '../../components/workspace';
import { api } from '../../lib/api';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [faucet, setFaucet] = useState<{ ledgerMode: string; ledgerOnline: boolean; writerAddress: string | null; glmBalance: string | null; explorerUrl: string } | null>(null);

  useEffect(() => {
    setMode(new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login');
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 700;
    const warm = async () => {
      try {
        const status = await api<typeof faucet>('/public/status');
        if (!stopped) setFaucet(status);
      } catch {
        if (!stopped) timer = setTimeout(warm, delay);
        delay = Math.min(delay * 1.7, 5000);
      }
    };
    void warm();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  return <><AuthScreen mode={mode} setMode={setMode} onSignedIn={() => router.push('/dashboard')} error={error} setError={setError} />{faucet && <aside className="fixed bottom-3 left-3 right-3 mx-auto max-w-2xl rounded-lg border border-line bg-white/95 p-3 text-[11px] text-[#748078] shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span>Arkiv Tiramisu · {faucet.ledgerOnline ? 'online' : 'unavailable'} · {faucet.glmBalance === null ? 'GLM balance unavailable' : `${Number(faucet.glmBalance).toFixed(4)} GLM`}</span>{faucet.writerAddress && <span className="break-all font-mono">Writer: {faucet.writerAddress} · <a className="font-sans text-moss underline" href="https://hub.arkiv.network/faucet" target="_blank" rel="noreferrer">Get GLM</a></span>}</div></aside>}</>;
}
