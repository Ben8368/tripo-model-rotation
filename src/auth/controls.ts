import { AuthActionError, createAuthActions, findStudioAuth } from './studio-auth';
import { ACCOUNT_KEY, KEEP_ALIVE_KEY, createAccountStore } from './account-store';
import { AUTH_LOCK, createKeepAlive } from './keep-alive';
import { assertCredentials, probeStudioSession, type LogoutAwareAuth } from './session';

export function mountAuthControls(shadow: ShadowRoot, isExportBusy: () => boolean): void {
  const actions = createAuthActions();
  const form = shadow.querySelector<HTMLFormElement>('#accountForm');
  const email = shadow.querySelector<HTMLInputElement>('#accountEmail');
  const password = shadow.querySelector<HTMLInputElement>('#accountPassword');
  const login = shadow.querySelector<HTMLButtonElement>('#accountLogin');
  const refresh = shadow.querySelector<HTMLButtonElement>('#accountRefresh');
  const status = shadow.querySelector<HTMLElement>('#accountStatus');
  const details = shadow.querySelector<HTMLDetailsElement>('#accountDetails');
  const remember = shadow.querySelector<HTMLInputElement>('#accountRemember');
  const enabled = shadow.querySelector<HTMLInputElement>('#accountKeepAlive');
  const save = shadow.querySelector<HTMLButtonElement>('#accountSave');
  const clear = shadow.querySelector<HTMLButtonElement>('#accountClear');
  const browser = typeof window !== 'undefined' ? window : null;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  // Access storage lazily so a browser policy does not prevent the rest of the assistant mounting.
  const store = createAccountStore({
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key),
  });
  let manualBusy = false;
  let logoutBound: LogoutAwareAuth | null = null;
  const report = (message: string) => { status.textContent = message; };
  const lock = async (task: () => Promise<void>) => {
    if (!locks) return false;
    return locks.request(AUTH_LOCK, { ifAvailable: true }, async held => {
      if (!held) return false;
      await task();
      return true;
    });
  };
  function syncSaved() {
    try {
      const config = store.read();
      remember.checked = Boolean(config.password);
      enabled.checked = config.enabled;
      if (config.email) email.value = config.email;
      password.placeholder = config.password ? '已保存；留空使用已保存密码' : '输入密码';
      password.required = !config.password;
    } catch { report('本地账号存储不可用；仍可输入账号密码手动登录。'); }
  }
  const keepAlive = createKeepAlive({
    store, now: () => Date.now(),
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    blocked: () => isExportBusy() || manualBusy || actions.busy,
    ready: () => {
      const auth = findStudioAuth() as LogoutAwareAuth;
      if (!auth) return false;
      if (auth !== logoutBound) {
        // Do not run automatic login without an explicit native-logout stop signal.
        if (typeof auth.signal?.onLogout !== 'function') {
          report('网站退出登录事件不可用，自动保活暂不运行。');
          return false;
        }
        auth.signal.onLogout(() => {
          keepAlive.stop();
          enabled.checked = false;
          try { store.save({ ...store.read(), enabled: false }); }
          catch { report('保活已停止，但无法保存设置；请清除本地账号。'); return; }
          report('已退出登录，自动保活已暂停；重新开启后才会自动登录。');
        });
        logoutBound = auth;
      }
      return true;
    },
    lock, refresh: () => actions.refresh(), probe: () => probeStudioSession(),
    login: (identifier, secret) => actions.login(identifier, secret), report: message => { report(message); syncSaved(); },
  });
  syncSaved();

  async function perform(kind: 'login' | 'refresh') {
    if (manualBusy || actions.busy || keepAlive.busy) return;
    if (isExportBusy()) { report('请等待当前导出或保存结束后再操作账号。'); return; }
    let secret = kind === 'login' ? password.value : '';
    const identifier = email.value.trim();
    if (kind === 'login' && !secret) {
      try {
        const saved = store.read();
        if (saved.email === identifier) secret = saved.password;
      } catch { /* Manual entry works without persistence. */ }
    }
    password.value = '';
    manualBusy = true;
    login.disabled = refresh.disabled = save.disabled = true;
    report(kind === 'login' ? '正在登录…' : '正在刷新访问令牌…');
    try {
      const task = async () => {
        if (kind === 'login') {
          await actions.login(identifier, secret);
          report('登录请求已成功，网站将同步登录状态。');
        } else {
          await actions.refresh();
          report('访问令牌已刷新；这不代表登录 Cookie 的有效期已延长。');
        }
      };
      if (locks) {
        if (!await lock(task)) report('另一标签页正在处理账号请求，请稍后重试。');
      } else await task();
    } catch (error) {
      report(error instanceof AuthActionError ? error.message : '账号操作未完成，请使用网站原生登录。');
    } finally {
      secret = '';
      manualBusy = false;
      login.disabled = refresh.disabled = save.disabled = false;
    }
  }
  function saveAccount() {
    if (manualBusy || actions.busy || keepAlive.busy || isExportBusy()) {
      report('请等待当前账号请求、导出或保存结束后再保存设置。'); return;
    }
    keepAlive.stop();
    try {
      if (!remember.checked) {
        store.clear();
        enabled.checked = false;
        password.value = '';
        syncSaved();
        report('未保存密码，自动保活已关闭。');
        return;
      }
      const previous = store.read();
      const identifier = email.value.trim();
      const secret = password.value || (previous.email === identifier ? previous.password : '');
      assertCredentials(identifier, secret);
      if (enabled.checked && !locks) { report('此浏览器不支持多标签页协调，无法开启自动保活；可手动登录。'); return; }
      store.saveState({ nextAt: 0, failures: 0, loginPending: false });
      store.save({ email: identifier, password: secret, enabled: enabled.checked });
      password.value = '';
      syncSaved();
      report(enabled.checked ? '账号已保存，自动保活已开启。' : '账号已保存在本浏览器，自动保活未开启。');
      keepAlive.start();
      if (enabled.checked) void keepAlive.tick();
    } catch (error) {
      report(error instanceof AuthActionError ? error.message : '账号未能保存；自动保活未启动。');
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void perform('login'); });
  refresh.addEventListener('click', () => { void perform('refresh'); });
  save.addEventListener('click', saveAccount);
  clear.addEventListener('click', () => {
    keepAlive.stop();
    password.value = email.value = '';
    enabled.checked = remember.checked = false;
    try { store.clear(); syncSaved(); report('已清除保存的账号密码并停止保活；已经发出的请求无法撤回。'); }
    catch { report('保活已在本页停止，但本地账号清除失败，请检查浏览器存储设置。'); }
  });
  enabled.addEventListener('change', () => {
    if (enabled.checked) { report('勾选记住账号密码后，点击“保存设置”开启保活。'); return; }
    keepAlive.stop();
    try { store.save({ ...store.read(), enabled: false }); report('自动保活已关闭。'); }
    catch { report('本页保活已停止，但设置未能保存。'); }
  });
  remember.addEventListener('change', () => {
    if (remember.checked) return;
    keepAlive.stop();
    enabled.checked = false;
    try { store.clear(); syncSaved(); report('已移除保存的账号密码并关闭保活。'); }
    catch { report('本页保活已停止，但本地凭据移除失败。'); }
  });
  details.addEventListener('toggle', () => { if (!details.open) password.value = ''; });
  if (browser) {
    // Wakeups are cheap: shared deadlines avoid extra network traffic across tabs.
    browser.setInterval(() => { void keepAlive.tick(); }, 30_000);
    browser.addEventListener('online', () => { void keepAlive.tick(); });
    browser.addEventListener('pagehide', () => keepAlive.stop());
    browser.addEventListener('pageshow', () => { keepAlive.start(); void keepAlive.tick(); });
    browser.addEventListener('storage', event => {
      if (event.key !== null && event.key !== ACCOUNT_KEY && event.key !== KEEP_ALIVE_KEY) return;
      syncSaved();
      if (event.key === KEEP_ALIVE_KEY) return;
      keepAlive.stop();
      if (enabled.checked) { keepAlive.start(); void keepAlive.tick(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void keepAlive.tick(); });
    if (enabled.checked && locks) void keepAlive.tick();
  }
}
