import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

for (const minify of [false, true]) {
  const result = await build({ entryPoints: ['src/auth/studio-auth.ts'], bundle: true, write: false, format: 'esm', minify });
  const { createAuthActions, findStudioAuth } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const label = minify ? 'minified' : 'source';

  test(`${label}: native SDK login keeps password exact and trims only email`, async () => {
    const calls = [];
    const auth = { login: { async submitPassword(input) { calls.push(input); } }, token: { async refresh() { throw Error('must not duplicate SDK refresh'); } } };
    const actions = createAuthActions(() => auth);
    assert.equal(await actions.login(' person@example.test ', ' p a s s '), undefined);
    assert.deepEqual(calls, [{ email: 'person@example.test', password: ' p a s s ' }]);
    assert.equal(actions.busy, false);
  });
  test(`${label}: invalid credentials and unavailable SDK do not submit`, async () => {
    let resolves = 0;
    const actions = createAuthActions(() => { resolves++; return null; });
    await assert.rejects(actions.login('invalid', 'secret'), { code: 'invalid-input' });
    await assert.rejects(actions.login('person@example.test', ''), { code: 'invalid-input' });
    assert.equal(resolves, 0);
    await assert.rejects(actions.login('person@example.test', 'secret'), { code: 'unavailable' });
    assert.equal(actions.busy, false);
  });
  test(`${label}: busy actions never duplicate password submissions and recover after failure`, async () => {
    let rejectRequest;
    let calls = 0;
    const auth = { login: { submitPassword() { calls++; return new Promise((_, reject) => { rejectRequest = reject; }); } }, token: { async refresh() { return 'private-jwt'; } } };
    const actions = createAuthActions(() => auth);
    const first = actions.login('person@example.test', 'secret');
    assert.equal(actions.busy, true);
    await assert.rejects(actions.login('person@example.test', 'secret'), { code: 'busy' });
    await assert.rejects(actions.refresh(), { code: 'busy' });
    rejectRequest(new Error('private-password secret; private-jwt'));
    await assert.rejects(first, error => error.code === 'login-failed' && !error.message.includes('secret') && !error.cause);
    assert.equal(calls, 1);
    assert.equal(actions.busy, false);
    assert.equal(await actions.refresh(), undefined);
  });
  test(`${label}: refresh does not leak tokens or treat an empty result as success`, async () => {
    let result = 'private-jwt';
    const actions = createAuthActions(() => ({ login: { async submitPassword() {} }, token: { async refresh() { return result; } } }));
    assert.equal(await actions.refresh(), undefined);
    result = undefined;
    await assert.rejects(actions.refresh(), { code: 'refresh-failed' });
    const failing = createAuthActions(() => ({ login: { async submitPassword() {} }, token: { async refresh() { throw Error('private-jwt'); } } }));
    await assert.rejects(failing.refresh(), error => error.code === 'refresh-failed' && !error.message.includes('private-jwt') && !error.cause);
  });
  test(`${label}: native Nuxt discovery checks SDK methods and returns no fallback credentials`, () => {
    const auth = { login: { submitPassword() {} }, token: { refresh() {} } };
    const doc = value => ({ querySelector(selector) { assert.equal(selector, '#__nuxt'); return value; } });
    assert.equal(findStudioAuth(doc(null)), null);
    assert.equal(findStudioAuth(doc({ __vue_app__: { $nuxt: { $auth: {} } } })), null);
    assert.equal(findStudioAuth(doc({ __vue_app__: { $nuxt: { $auth: auth } } })), auth);
  });
}

const controlsBuild = await build({ entryPoints: ['src/auth/controls.ts'], bundle: true, write: false, format: 'esm' });
const { mountAuthControls } = await import(`data:text/javascript;base64,${Buffer.from(controlsBuild.outputFiles[0].text).toString('base64')}`);

function panelHarness(auth, blocked = () => false) {
  const elements = new Map();
  const shadow = { querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', textContent: '', disabled: false, open: false, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
    });
    return elements.get(selector);
  } };
  globalThis.document = { querySelector: () => ({ __vue_app__: { $nuxt: { $auth: auth } } }) };
  mountAuthControls(shadow, blocked);
  return selector => shadow.querySelector(selector);
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('account panel clears the password immediately, blocks repeated submit and restores buttons', async () => {
  let finish;
  let calls = 0;
  const $ = panelHarness({ login: { submitPassword(input) {
    calls++;
    assert.equal(input.password, 'secret');
    return new Promise(resolve => { finish = resolve; });
  } }, token: { async refresh() { return 'jwt'; } } });
  try {
    $('#accountEmail').value = 'person@example.test';
    $('#accountPassword').value = 'secret';
    $('#accountForm').listeners.submit({ preventDefault() {} });
    assert.equal($('#accountPassword').value, '');
    assert.equal($('#accountLogin').disabled, true);
    $('#accountForm').listeners.submit({ preventDefault() {} });
    assert.equal(calls, 1);
    finish();
    await settle();
    assert.equal($('#accountLogin').disabled, false);
    assert.match($('#accountStatus').textContent, /成功/);
    $('#accountPassword').value = 'another-secret';
    $('#accountDetails').listeners.toggle();
    assert.equal($('#accountPassword').value, '');
  } finally { delete globalThis.document; }
});

test('account panel makes no request on mount or while export is busy and sanitizes failures', async () => {
  let calls = 0;
  let blocked = true;
  const $ = panelHarness({ login: { async submitPassword() { calls++; } }, token: { async refresh() { calls++; throw Error('private-token'); } } }, () => blocked);
  try {
    assert.equal(calls, 0);
    $('#accountRefresh').listeners.click();
    assert.equal(calls, 0);
    assert.match($('#accountStatus').textContent, /导出或保存/);
    blocked = false;
    $('#accountRefresh').listeners.click();
    await settle();
    assert.equal(calls, 1);
    assert.equal($('#accountRefresh').disabled, false);
    assert(!$('#accountStatus').textContent.includes('private-token'));
  } finally { delete globalThis.document; }
});

test('saved account restores without filling password and native logout stops future keep-alive', async () => {
  const descriptors = new Map(['window','navigator','localStorage'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const values = new Map();
  const intervals=[];
  let logout, refreshes=0;
  const auth = {login:{async submitPassword(){}},token:{async refresh(){refreshes++;return 'jwt';}},signal:{onLogout(callback){logout=callback;}}};
  try {
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true,locks:{request:async(name,options,callback)=>callback({name})}}});
    Object.defineProperty(globalThis,'window',{configurable:true,value:{setInterval:callback=>intervals.push(callback),addEventListener(){}}});
    // panelHarness installs the SDK document before mount.
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis,'document');
    Object.defineProperty(globalThis,'document',{configurable:true,set(value){value.addEventListener=()=>{};Object.defineProperty(globalThis,'document',{value,writable:true,configurable:true});}});
    const $=panelHarness(auth);
    assert.equal(refreshes,0);
    $('#accountEmail').value='test@example.test';$('#accountPassword').value='secret';
    $('#accountRemember').checked=true;$('#accountKeepAlive').checked=true;
    $('#accountSave').listeners.click();await settle();
    assert.equal(refreshes,1);assert.equal($('#accountPassword').value,'');
    assert.equal(JSON.parse(values.get('tripo-rotation-assistant:account:v1')).password,'secret');
    assert.equal(typeof logout,'function');
    logout();await settle();
    assert.equal(JSON.parse(values.get('tripo-rotation-assistant:account:v1')).enabled,false);
    intervals[0]();await settle();assert.equal(refreshes,1);
    $('#accountClear').listeners.click();
    assert.equal(values.has('tripo-rotation-assistant:account:v1'),false);
    if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);
  } finally {
    for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    delete globalThis.document;
  }
});
