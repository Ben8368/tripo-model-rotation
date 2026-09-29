/** Tripo Studio auth SDK contract, inspected on 2026-09-29. */
export interface StudioAuth {
  login: { submitPassword(input: { email: string; password: string }): Promise<unknown> };
  token: { refresh(): Promise<string | undefined> };
}

export type AuthFailure = 'unavailable' | 'invalid-input' | 'busy' | 'login-failed' | 'refresh-failed';
export class AuthActionError extends Error {
  constructor(readonly code: AuthFailure) {
    const messages: Record<AuthFailure, string> = {
      unavailable: '站点登录模块尚未就绪或接口已变更，请使用网站原生登录。',
      'invalid-input': '请输入有效邮箱和密码。',
      busy: '已有账号请求正在进行，请稍候。',
      'login-failed': '登录未完成，请在网站原生登录中检查密码、网络或验证提示。',
      'refresh-failed': '未能刷新访问令牌，请检查网络，或使用网站原生登录重新认证。',
    };
    super(messages[code]);
    this.name = 'AuthActionError';
  }
}

/** Reuse the live SDK: do not copy cookies, tokens, CSRF values or device identifiers. */
export function findStudioAuth(doc: Document = document): StudioAuth | null {
  const root = doc.querySelector('#__nuxt') as Element & {
    __vue_app__?: { $nuxt?: { $auth?: StudioAuth } };
  };
  const auth = root?.__vue_app__?.$nuxt?.$auth;
  return typeof auth?.login?.submitPassword === 'function' && typeof auth?.token?.refresh === 'function'
    ? auth : null;
}

export function createAuthActions(resolve: () => StudioAuth | null = findStudioAuth) {
  let pending = false;
  async function run(code: 'login-failed' | 'refresh-failed', action: (auth: StudioAuth) => Promise<void>) {
    if (pending) throw new AuthActionError('busy');
    pending = true;
    try {
      const auth = resolve();
      if (!auth) throw new AuthActionError('unavailable');
      await action(auth);
    } catch (error) {
      // SDK errors can contain request data. Never propagate their message, body or cause.
      if (error instanceof AuthActionError) throw error;
      throw new AuthActionError(code);
    } finally {
      pending = false;
    }
  }
  return {
    get busy() { return pending; },
    async login(email: string, password: string): Promise<void> {
      const identifier = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) || !password) {
        throw new AuthActionError('invalid-input');
      }
      try {
        await run('login-failed', async auth => {
          // The SDK also publishes the native login signal consumed by Studio.
          await auth.login.submitPassword({ email: identifier, password });
        });
      } finally {
        password = '';
      }
    },
    async refresh(): Promise<void> {
      await run('refresh-failed', async auth => {
        const token = await auth.token.refresh();
        if (typeof token !== 'string' || !token) throw new AuthActionError('refresh-failed');
        // The SDK updates its own token cache. Do not return or persist the JWT.
      });
    },
  };
}
