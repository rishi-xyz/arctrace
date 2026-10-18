'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthScreen } from '../../components/workspace';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');

  useEffect(() => {
    setMode(new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login');
  }, []);

  return <AuthScreen mode={mode} setMode={setMode} onSignedIn={() => router.push('/dashboard')} error={error} setError={setError} />;
}
