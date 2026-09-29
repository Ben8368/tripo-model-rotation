import type { AccountStore } from './account-store';
import type { SessionState } from './session';

export const REFRESH_INTERVAL = 5 * 60_000;
export const AUTH_LOCK = 'tripo-rotation-assistant:auth';
export interface KeepAliveDependencies {
  store: AccountStore;
  now(): number;
  ready(): boolean;
  blocked(): boolean;
  online(): boolean;
  lock(task: () => Promise<void>): Promise<boolean>;
  refresh(): Promise<void>;
  probe(): Promise<SessionState>;
  login(email: string, password: string): Promise<void>;
  report(message: string): void;
}

/** Timers only wake this controller; persisted deadlines and a Web Lock coordinate tabs. */
export function createKeepAlive(deps: KeepAliveDependencies) {
  let busy = false;
  let stopped = false;
  let revision = 0;
  const { store } = deps;
  function stop() { stopped = true; revision++; }
  function start() { stopped = false; revision++; }
  async function tick(): Promise<void> {
    if (busy || stopped || !deps.online() || deps.blocked()) return;
    busy = true;
    const generation = revision;
    try {
      const config = store.read();
      if (!config.enabled || !config.email || !config.password) return;
      const allowed = () => {
        const latest = store.read();
        return !stopped && revision === generation && latest.enabled && latest.email === config.email &&
          latest.password === config.password && !deps.blocked() && deps.online();
      };
      const acquired = await deps.lock(async () => {
        if (!allowed()) return;
        const state = store.state();
        if (state.loginPending) {
          store.save({ ...config, enabled: false });
          deps.report('上次自动登录未完成，已暂停保活；请手动登录后重新开启。');
          return;
        }
        if (!deps.ready()) { deps.report('等待网站登录模块就绪或退出登录事件支持…'); return; }
        if (state.nextAt > deps.now()) return;
        // Persist the attempt before making a request, including across page reloads.
        store.saveState({ ...state, nextAt: deps.now() + REFRESH_INTERVAL });
        try {
          await deps.refresh();
          if (!allowed()) return;
          store.saveState({ nextAt: deps.now() + REFRESH_INTERVAL, failures: 0, loginPending: false });
          deps.report('自动保活运行中：访问令牌已刷新，约 5 分钟后再检查。');
          return;
        } catch { /* Only a separate 401 session check authorizes reauthentication. */ }
        if (!allowed()) return;
        const session = await deps.probe();
        if (!allowed()) return;
        if (session !== 'expired') {
          const failures = Math.min(state.failures + 1, 10);
          const delay = Math.min(30 * 60_000, REFRESH_INTERVAL * 2 ** (failures - 1));
          store.saveState({ nextAt: deps.now() + delay, failures, loginPending: false });
          deps.report(`会话刷新暂未完成，约 ${delay / 60_000} 分钟后重试；不会因此重复提交密码。`);
          return;
        }
        // A failed or interrupted password attempt requires user intervention, not a loop.
        store.saveState({ nextAt: deps.now() + REFRESH_INTERVAL, failures: 0, loginPending: true });
        deps.report('登录会话已失效，正在用已保存的账号重新登录…');
        try {
          await deps.login(config.email, config.password);
          if (!allowed()) return;
          await deps.refresh();
          if (!allowed()) return;
          store.saveState({ nextAt: deps.now() + REFRESH_INTERVAL, failures: 0, loginPending: false });
          deps.report('已自动重新登录并刷新会话。');
        } catch {
          if (!allowed()) return;
          store.save({ ...config, enabled: false });
          store.saveState({ nextAt: 0, failures: 0, loginPending: false });
          deps.report('自动登录未完成，已暂停保活；请检查密码或在网站完成验证后重新开启。');
        }
      });
      if (!acquired) deps.report('另一标签页正在处理账号请求，稍后检查。');
    } catch {
      stopped = true;
      deps.report('账号存储或自动保活不可用，已停止；请重新保存设置。');
    } finally { busy = false; }
  }
  return { tick, stop, start, get busy() { return busy; } };
}
