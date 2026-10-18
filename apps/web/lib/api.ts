const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';
let csrfToken = '';

export type SessionUser = {
  id: string;
  email: string | null;
  walletAddress: string | null;
  displayName: string;
  role: 'sender' | 'recipient' | 'investigator' | 'admin';
  orgId: string;
  hasKeys: boolean;
  createdAt: string;
};

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method ?? 'GET')) {
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'Request failed. Please try again.');
  return data as T;
}

export async function establishSession(path: '/auth/login' | '/auth/register', body: unknown) {
  const response = await api<{ user: SessionUser; csrfToken: string }>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  csrfToken = response.csrfToken;
  return response.user;
}

export async function establishWalletSession(body: unknown) {
  const response = await api<{ user: SessionUser; csrfToken: string }>('/auth/wallet/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  csrfToken = response.csrfToken;
  return response.user;
}

export async function restoreSession() {
  const response = await api<{ user: SessionUser; csrfToken: string }>('/me');
  csrfToken = response.csrfToken;
  return response.user;
}

export function forgetCsrf() { csrfToken = ''; }
