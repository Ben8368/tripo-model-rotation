export interface AccountConfig {
  email: string;
  password: string;
  enabled: boolean;
}
export interface KeepAliveState {
  nextAt: number;
  failures: number;
  loginPending: boolean;
}
export const ACCOUNT_KEY = 'tripo-rotation-assistant:account:v1';
export const KEEP_ALIVE_KEY = 'tripo-rotation-assistant:keep-alive:v1';
const EMPTY: AccountConfig = { email: '', password: '', enabled: false };

/** Opt-in plaintext storage. Never include this data in export settings or logs. */
export function createAccountStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  return {
    read(): AccountConfig {
      const raw = storage.getItem(ACCOUNT_KEY);
      if (!raw) return { ...EMPTY };
      const value = JSON.parse(raw);
      if (!value || typeof value.email !== 'string' || typeof value.password !== 'string' ||
          typeof value.enabled !== 'boolean') throw Error('Invalid account settings');
      return { email: value.email, password: value.password, enabled: value.enabled };
    },
    save(config: AccountConfig) { storage.setItem(ACCOUNT_KEY, JSON.stringify(config)); },
    clear() { storage.removeItem(ACCOUNT_KEY); storage.removeItem(KEEP_ALIVE_KEY); },
    state(): KeepAliveState {
      const raw = storage.getItem(KEEP_ALIVE_KEY);
      if (!raw) return { nextAt: 0, failures: 0, loginPending: false };
      const value = JSON.parse(raw);
      if (!value || !Number.isFinite(value.nextAt) || value.nextAt < 0 ||
          !Number.isInteger(value.failures) || value.failures < 0 || typeof value.loginPending !== 'boolean') {
        throw Error('Invalid keep-alive state');
      }
      return value;
    },
    saveState(state: KeepAliveState) { storage.setItem(KEEP_ALIVE_KEY, JSON.stringify(state)); },
  };
}
export type AccountStore = ReturnType<typeof createAccountStore>;
