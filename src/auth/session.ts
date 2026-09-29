import { AuthActionError, type StudioAuth } from './studio-auth';

export type SessionState = 'active' | 'expired' | 'unknown';

/** Inspect only session status. Never export the response, cookie or identity data. */
export async function probeStudioSession(doc: Document = document, request: typeof fetch = fetch): Promise<SessionState> {
  const root = doc.querySelector('#__nuxt') as Element & {
    __vue_app__?: { $nuxt?: { $config?: { public?: { authUrl?: string } } } };
  };
  const base = root?.__vue_app__?.$nuxt?.$config?.public?.authUrl;
  if (typeof base !== 'string') return 'unknown';
  let url: URL;
  try {
    url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password ||
        !(url.hostname === 'tripo3d.ai' || url.hostname.endsWith('.tripo3d.ai'))) return 'unknown';
    url.pathname = url.pathname.replace(/\/$/, '') + '/sessions/whoami';
    url.search = '';
    url.hash = '';
  } catch { return 'unknown'; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await request(url.href, {
      method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    // A network error, 403, 429 or 5xx is not evidence of an expired login.
    if (response.status === 401) return 'expired';
    if (!response.ok) return 'unknown';
    const body = await response.json();
    return body?.active === true ? 'active' : 'unknown';
  } catch { return 'unknown'; }
  finally { clearTimeout(timer); }
}

export function assertCredentials(email: string, password: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !password) {
    throw new AuthActionError('invalid-input');
  }
}

export type LogoutAwareAuth = StudioAuth & {
  signal?: { onLogout(callback: () => void): unknown };
};
