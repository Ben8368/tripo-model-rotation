import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({ stdin: {
  contents: `export * from './account-store'; export * from './keep-alive'; export * from './session';`,
  resolveDir: fileURLToPath(new URL('../src/auth/', import.meta.url)),
}, bundle: true, write: false, format: 'esm' });
const { createAccountStore, createKeepAlive, probeStudioSession, REFRESH_INTERVAL } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

function fixture() {
  const values = new Map();
  const store = createAccountStore({ getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) });
  const calls = [];
  let now = 100_000;
  const deps = {
    store, now: () => now, ready: () => true, blocked: () => false, online: () => true,
    lock: async task => { await task(); return true; },
    refresh: async () => { calls.push('refresh'); },
    probe: async () => { calls.push('probe'); return 'expired'; },
    login: async (email,password) => { calls.push(['login',email,password]); },
    report: message => { calls.push(['status',message]); },
  };
  store.save({ email:'test@example.test',password:'secret',enabled:true });
  return { store, values, calls, deps, advance: ms => { now += ms; } };
}

test('keep-alive is opt-in, avoids requests while offline/exporting and persists its refresh deadline', async () => {
  const f=fixture(); const engine=createKeepAlive(f.deps);
  f.store.save({...f.store.read(),enabled:false});
  await engine.tick(); assert.equal(f.calls.length,0);
  f.store.save({...f.store.read(),enabled:true});
  f.deps.online=()=>false; await engine.tick(); assert.equal(f.calls.length,0);
  f.deps.online=()=>true; f.deps.blocked=()=>true; await engine.tick(); assert.equal(f.calls.length,0);
  f.deps.blocked=()=>false;
  await engine.tick(); assert.equal(f.calls.filter(x=>x==='refresh').length,1);
  // A reloaded page or second tab sees the same nextAt.
  await createKeepAlive(f.deps).tick(); assert.equal(f.calls.filter(x=>x==='refresh').length,1);
  f.advance(REFRESH_INTERVAL); await engine.tick(); assert.equal(f.calls.filter(x=>x==='refresh').length,2);
  assert(!f.calls.includes('probe'));
});

test('only confirmed expired sessions trigger a single re-login followed by token refresh', async () => {
  const f=fixture(); let count=0;
  f.deps.refresh=async()=>{f.calls.push('refresh'); if(count++===0)throw Error('expired');};
  await createKeepAlive(f.deps).tick();
  assert.deepEqual(f.calls.filter(x=>!Array.isArray(x)||x[0]!=='status'),['refresh','probe',['login','test@example.test','secret'],'refresh']);
  assert.equal(f.store.state().loginPending,false);
  assert.equal(f.store.read().enabled,true);
});

for (const session of ['unknown','active']) test(`refresh failure with ${session} session backs off without sending a password`, async () => {
  const f=fixture(); f.deps.refresh=async()=>{throw Error('network');}; f.deps.probe=async()=>session;
  const engine=createKeepAlive(f.deps); await engine.tick();
  assert.equal(f.store.state().failures,1);
  f.advance(REFRESH_INTERVAL); await engine.tick();
  assert.equal(f.store.state().failures,2);
  assert.equal(f.store.state().nextAt-f.deps.now(),2*REFRESH_INTERVAL);
  assert(!f.calls.some(x=>x[0]==='login'));
});

test('wrong password pauses persistently and does not retry across reloads', async () => {
  const f=fixture(); f.deps.refresh=async()=>{throw Error('expired');}; let logins=0;
  f.deps.login=async()=>{logins++;throw Error('secret-password');};
  await createKeepAlive(f.deps).tick();
  assert.equal(logins,1); assert.equal(f.store.read().enabled,false);
  f.advance(3600_000); await createKeepAlive(f.deps).tick(); assert.equal(logins,1);
  assert(!JSON.stringify(f.calls).includes('secret-password'));
});

test('interrupted password attempt stops after a page reload', async () => {
  const f=fixture(); f.store.saveState({nextAt:0,failures:0,loginPending:true});
  await createKeepAlive(f.deps).tick();
  assert.equal(f.store.read().enabled,false);
  assert(!f.calls.includes('refresh'));
});

test('turning off, changing account or clearing credentials in flight prevents auto login', async () => {
  for(const change of ['disable','replace','clear','stop']) {
    const f=fixture(); let finish;
    f.deps.refresh=()=>new Promise((_,reject)=>{finish=()=>reject(Error('expired'));});
    const engine=createKeepAlive(f.deps);const work=engine.tick();
    if(change==='disable')f.store.save({...f.store.read(),enabled:false});
    if(change==='replace')f.store.save({...f.store.read(),email:'other@example.test'});
    if(change==='clear')f.store.clear();
    if(change==='stop')engine.stop();
    finish(); await work;
    assert(!f.calls.includes('probe')); assert(!f.calls.some(x=>x[0]==='login'));
  }
});

test('multi-tab lock and per-controller busy state prevent overlapping authentication', async () => {
  const f=fixture();let locked=false,finish;
  f.deps.lock=async task=>{if(locked)return false;locked=true;try{await task();return true;}finally{locked=false;}};
  f.deps.refresh=()=>{f.calls.push('refresh');return new Promise(resolve=>{finish=resolve;});};
  const first=createKeepAlive(f.deps),second=createKeepAlive(f.deps);
  const work=first.tick();await first.tick();await second.tick();
  assert.equal(f.calls.filter(x=>x==='refresh').length,1);
  finish();await work;await second.tick();
  assert.equal(f.calls.filter(x=>x==='refresh').length,1);
});

test('storage failure stops before authentication and plaintext credentials are cleared explicitly', async () => {
  const f=fixture(); assert.equal(f.store.read().password,'secret');
  f.store.clear();assert.deepEqual(f.store.read(),{email:'',password:'',enabled:false});
  f.store.save({email:'test@example.test',password:'secret',enabled:true});
  f.store.saveState=()=>{throw Error('quota');};
  await createKeepAlive(f.deps).tick(); assert(!f.calls.includes('refresh'));
});

test('session probe uses runtime auth URL, cookies and a separate 401 check; never trusts failures as expiry', async () => {
  const doc=base=>({querySelector:()=>({__vue_app__:{$nuxt:{$config:{public:{authUrl:base}}}}})});
  for(const [status,body,expected] of [[401,{},'expired'],[403,{},'unknown'],[429,{},'unknown'],[500,{},'unknown'],[200,{active:true},'active'],[200,{active:false},'unknown']]) {
    const state=await probeStudioSession(doc('https://auth.tripo3d.ai/prefix'),async(url,init)=>{
      assert.equal(url,'https://auth.tripo3d.ai/prefix/sessions/whoami');
      assert.equal(init.credentials,'include');assert.equal(init.redirect,'error');
      return {status,ok:status===200,json:async()=>body};
    }); assert.equal(state,expected);
  }
  for(const base of ['https://evil.test','http://auth.tripo3d.ai','https://tripo3d.ai.evil.test','invalid']) {
    assert.equal(await probeStudioSession(doc(base),async()=>{throw Error('must not fetch');}),'unknown');
  }
  assert.equal(await probeStudioSession(doc('https://auth.tripo3d.ai'),async()=>{throw Error('offline');}),'unknown');
});

test('logout subscription readiness is checked on restored pages before the next network deadline', async () => {
  const f=fixture();f.store.saveState({nextAt:f.deps.now()+REFRESH_INTERVAL,failures:0,loginPending:false});
  let ready=0;f.deps.ready=()=>{ready++;return true;};
  await createKeepAlive(f.deps).tick();
  assert.equal(ready,1);assert(!f.calls.includes('refresh'));
});
