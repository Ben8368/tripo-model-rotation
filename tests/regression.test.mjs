import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8').then(text => text.replace(/\r\n/g, '\n'));
const harnessSource = source.replace("import type { Settings } from './types/settings';\n", '');
const names = ['runExportAction','animateDrag','stopRotation','throwIfCancelled','nextRenderedFrame','sleep',
  'exportAll','takeScreenshot','startRotation','hideAxisOverlay','createCanvasFrameSource','createFrameLock',
  'switchMaterial','switchWireframe','waitForTabFrame','createTabCapture','handleScreenshotClick',
  'saveBlob','resumePendingSave','discardPendingSave','handleBeforeUnload'];
const overrides = ['setStatus','sanitizeSettingsFromUI','requestProjectName','plannedExportItems',
  'currentMaterial','toggleIsOn','findWireframeButton','findViewerCanvas','snapshotView','findRenderContext',
  'showPanel','switchMaterial','switchWireframe','buildOutputFilename','takeScreenshot','applyView',
  'dispatchPointer','scheduleAutoShow','finalizeRecording','applySolidLook','findAxisOverlay',
  'createViewerBackgroundCanvas','createFrameLock','createCanvasFrameSource','saveBlob','chooseSingleFile',
  'requestBatchCaptureStart','createTabCapture'];
// Transitional JS integration harness. TS modules are tested via exports in logic.test.mjs.
assert(harnessSource.includes("  const host = document.createElement('div');"));
assert(harnessSource.includes('export function startApp(version) {'));
const harness = harnessSource.slice(0, harnessSource.indexOf("  const host = document.createElement('div');"))
  .replace('export function startApp(version) {', 'function startApp(version) {') + `
  ui = {saveRecoveryModal:{hidden:true}, saveRecoveryInfo:{}, saveRetry:{}, saveAs:{}, saveDiscard:{}};
  globalThis.api = { ${names.join(',')},
    get busy() { return exportBusy; }, get run() { return activeRun; },
    set run(value) { activeRun = value; }, get task() { return activeTask; },
    get config() { return settings; },
    get saving() { return activeSaves; }, get pending() { return pendingSave; },
    override(o) { ${overrides.map(n=>`if (o.${n}) ${n} = o.${n};`).join('\n')} }
  };
}
startApp("test");`;
const buildHarness = async minify => (await build({
  stdin: { contents: harness, resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, minify, format: 'iife', target: ['chrome109'],
  define: { __SCRIPT_VERSION__: '"test"' },
})).outputFiles[0].text;
const compiled = await buildHarness(true);
const plain = await buildHarness(false);

function setup(code) {
  const raf = new Map(); let id=0;
  const context = vm.createContext({console:{info(){},warn(){},error(){}},DOMException,
    performance, Blob, URL, setTimeout, clearTimeout,
    window:{setTimeout, clearTimeout}, document:{hidden:false},
    localStorage:{getItem:()=>null}, navigator:{},
    requestAnimationFrame(cb){raf.set(++id,cb);return id;},
    cancelAnimationFrame(i){raf.delete(i);},
  });
  vm.runInContext(code,context);
  const api=context.api;
  api.override({setStatus(){},dispatchPointer(){},scheduleAutoShow(){},finalizeRecording:async()=>null});
  return {api,context,raf};
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('operation did not settle')),1000);
  })]); } finally {clearTimeout(timer);}
}

for (const [variant, code] of [['unminified',plain],['minified',compiled]]) {

  function unloadPrevented(api) {
    let prevented=false;const event={preventDefault(){prevented=true;}};
    api.handleBeforeUnload(event);
    if(prevented)assert.equal(event.returnValue,'');
    return prevented;
  }
  test(`${variant}: screenshot save protects unload throughout write and close, then releases`,async()=>{
    const {api}=setup(code);let finishWrite,finishClose;
    const enteredWrite=Promise.withResolvers(),enteredClose=Promise.withResolvers();
    const blob=new Blob(['png']);
    const handle={name:'image.png',async createWritable(){return {
      write(){enteredWrite.resolve();return new Promise(resolve=>{finishWrite=resolve;});},
      close(){enteredClose.resolve();return new Promise(resolve=>{finishClose=resolve;});},abort(){},
    };},async getFile(){return {size:blob.size};}};
    assert.equal(unloadPrevented(api),false);
    const saved=api.saveBlob(blob,'image.png',{kind:'file',handle});
    assert.equal(api.run,null);assert.equal(api.pending,null);assert.equal(api.saving,1);
    assert.equal(unloadPrevented(api),true);
    await bounded(enteredWrite.promise);assert.equal(unloadPrevented(api),true);
    finishWrite();await bounded(enteredClose.promise);assert.equal(unloadPrevented(api),true);
    finishClose();assert.equal(await bounded(saved),'image.png');
    assert.equal(api.saving,0);assert.equal(unloadPrevented(api),false);
  });
  test(`${variant}: recovery retains unload protection through failed retry and save-as cancellation`,async()=>{
    const {api}=setup(code);const blob=new Blob(['png']);let fail=true;
    const handle={name:'image.png',async createWritable(){if(fail)throw Error('disk error');return {async write(){},async close(){}};},
      async getFile(){return {size:blob.size};}};
    const saved=api.saveBlob(blob,'image.png',{kind:'file',handle});
    await new Promise(resolve=>setImmediate(resolve));assert(api.pending);
    const job=api.pending;
    assert.equal(unloadPrevented(api),true);
    await api.resumePendingSave();assert.equal(api.pending,job);assert.equal(api.saving,1);
    api.override({chooseSingleFile:async()=>{throw new DOMException('cancelled','AbortError');}});
    await api.resumePendingSave(true);assert.equal(api.pending,job);assert.equal(unloadPrevented(api),true);
    api.stopRotation();assert.equal(api.pending,job);
    fail=false;await api.resumePendingSave();assert.equal(await bounded(saved),'image.png');
    assert.equal(api.pending,null);assert.equal(api.saving,0);assert.equal(unloadPrevented(api),false);
  });
  test(`${variant}: explicitly discarding failed save releases unload protection`,async()=>{
    const {api,context}=setup(code);
    const saved=api.saveBlob(new Blob(['png']),'image.png',{kind:'file',handle:{async createWritable(){throw Error('disk error');}}});
    const rejected=assert.rejects(saved,/用户放弃/);
    await new Promise(resolve=>setImmediate(resolve));
    context.window.confirm=()=>false;api.discardPendingSave();assert.equal(unloadPrevented(api),true);
    context.window.confirm=()=>true;api.discardPendingSave();await bounded(rejected);
    assert.equal(api.pending,null);assert.equal(api.saving,0);assert.equal(unloadPrevented(api),false);
  });
  test(`${variant}: completed video finalization still protects unload`,()=>{
    const {api}=setup(code);api.run={recording:{finalized:true}};
    assert.equal(unloadPrevented(api),true);api.run=null;assert.equal(unloadPrevented(api),false);
  });

  test(`${variant}: cancelling preview releases busy state and allows another action`, async()=>{
    const {api,raf}=setup(code);
    const action=api.runExportAction(async()=>{
      const run={canvas:{isConnected:true},timers:new Map(),recording:null,cancelled:false};
      api.run=run;
      assert.equal(await api.animateDrag(run,3000,1000,t=>t/3),false);
    });
    assert.equal(raf.size,1); api.stopRotation(); await bounded(action);
    assert.equal(raf.size,0);assert.equal(api.busy,false);assert.equal(api.run,null);
    let called=false;await api.runExportAction(async()=>{called=true;});assert.equal(called,true);
  });
  test(`${variant}: cancellation releases pending animation-frame and timer waits`,async()=>{
    const {api,raf}=setup(code);
    const action=api.runExportAction(()=>api.nextRenderedFrame());
    api.stopRotation();await bounded(action);assert.equal(raf.size,0);assert.equal(api.busy,false);
    const timerAction=api.runExportAction(async()=>{await api.sleep(60000);api.throwIfCancelled();});
    api.stopRotation();await bounded(timerAction);assert.equal(api.busy,false);
  });
  test(`${variant}: batch stop prevents remaining jobs and restores original state`,async()=>{
    const {api}=setup(code);let saved=0;const restored=[];
    api.override({sanitizeSettingsFromUI(){},requestProjectName:async()=> 'demo',
      plannedExportItems:()=>[1,2,3].map(()=>({kind:'screenshot',material:{id:'pbr',label:'pbr'},wireframe:false})),
      currentMaterial:()=>({id:'solid'}),toggleIsOn:()=>true,findWireframeButton(){},
      findViewerCanvas:()=>({}),snapshotView:()=>({}),findRenderContext:()=>({}),showPanel(){},
      switchMaterial:async(m,restore)=>{if(restore)restored.push(m.id);},
      switchWireframe:async(w,restore)=>{if(restore)restored.push(w);},
      buildOutputFilename:()=> 'demo.png',applyView(){restored.push('view');},
      takeScreenshot:async()=>{saved++;api.stopRotation();return 'demo.png';},
    });
    await bounded(api.runExportAction(()=>api.exportAll()));
    assert.equal(saved,1);assert.deepEqual(restored,['solid',true,'view']);assert.equal(api.busy,false);
  });
  test(`${variant}: material switching checks cancellation before proceeding`,async()=>{
    const {api}=setup(code);let ran=false;
    await api.runExportAction(async()=>{
      api.stopRotation();await api.switchMaterial({id:'solid'});ran=true;
    });
    assert.equal(ran,false);assert.equal(api.busy,false);
  });
  test(`${variant}: DOM axis visibility restored without erasing output pixels`,()=>{
    const {api,context}=setup(code);const style=new Map([['visibility',['visible','important']]]);
    api.override({findAxisOverlay:()=>({style:{
      getPropertyValue:k=>style.get(k)?.[0]||'',getPropertyPriority:k=>style.get(k)?.[1]||'',
      setProperty:(k,v,p)=>style.set(k,[v,p]),removeProperty:k=>style.delete(k),
    }})});
    const restore=api.hideAxisOverlay({});assert.deepEqual(style.get('visibility'),['hidden','important']);
    restore();assert.deepEqual(style.get('visibility'),['visible','important']);
    api.config.showAxisInOutput=true;api.hideAxisOverlay({});
    assert.deepEqual(style.get('visibility'),['visible','important']);
    const draws=[];
    context.document.createElement=()=>({getContext:()=>({drawImage:(...args)=>draws.push(args)})});
    const background={};api.override({createViewerBackgroundCanvas:()=>background});
    const model={width:400,height:400};api.config.showAxisInOutput=false;
    api.createCanvasFrameSource(model);
    assert.equal(draws.length,2);assert.equal(draws[0][0],background);assert.equal(draws[1][0],model);
  });
  test(`${variant}: stopping a pending screenshot releases lock and skips saving`,async()=>{
    const {api}=setup(code);let rejectCapture,releaseCount=0,saves=0;
    api.override({sanitizeSettingsFromUI(){},findViewerCanvas:()=>({}),applySolidLook(){},
      createFrameLock:()=>({capture:()=>new Promise((_,reject)=>{rejectCapture=reject;}),
        release:()=>{releaseCount++;rejectCapture?.(Error('released'));}}),
      createCanvasFrameSource:()=>({cleanup(){}}),saveBlob:async()=>{saves++;},showPanel(){},
    });
    const action=api.runExportAction(()=>api.takeScreenshot({outputFilename:'x.png'}));
    api.stopRotation();await bounded(action);
    assert(releaseCount>=1);assert.equal(saves,0);assert.equal(api.busy,false);
  });
  test(`${variant}: shared frame wait is cancellable`,async()=>{
    const {api}=setup(code);let cancelled=false;
    const action=api.runExportAction(()=>api.waitForTabFrame({
      requestVideoFrameCallback:()=>1,cancelVideoFrameCallback:()=>{cancelled=true;},
    }));
    api.stopRotation();await bounded(action);assert(cancelled);assert.equal(api.busy,false);
  });
  test(`${variant}: single tab screenshot requests fresh activation and cleans up capture`,async()=>{
    const {api}=setup(code);const order=[];
    api.config.recordingScope='tab';
    api.override({sanitizeSettingsFromUI(){},requestProjectName:async()=> 'demo',
      currentMaterial:()=>({label:'pbr'}),findWireframeButton(){},toggleIsOn:()=>false,
      chooseSingleFile:async()=>{order.push('picker');return {};},
      requestBatchCaptureStart:async()=>{order.push('fresh click');return true;},
      createTabCapture:async()=>{order.push('share');return {cleanup(){order.push('cleanup');}};},
      takeScreenshot:async()=>{order.push('screenshot');},
    });
    await api.runExportAction(()=>api.handleScreenshotClick());
    assert.deepEqual(order,['picker','fresh click','share','screenshot','cleanup']);
  });
  test(`${variant}: capture playback failure stops the shared stream`,async()=>{
    const {api,context}=setup(code);let stops=0;
    const track={getSettings:()=>({displaySurface:'browser'}),stop(){stops++;}};
    context.navigator.mediaDevices={getDisplayMedia:async()=>({getVideoTracks:()=>[track],getTracks:()=>[track]})};
    context.document.createElement=()=>({play:async()=>{throw Error('play failed');},pause(){}});
    await assert.rejects(api.createTabCapture(60),/play failed/);assert.equal(stops,1);
  });
  test(`${variant}: frame lock restores DOM axes on release and failed setup`,()=>{
    const {api,context}=setup(code);let hidden=false;let off=0;
    context.document.addEventListener=()=>{};context.document.removeEventListener=()=>{};
    api.override({findAxisOverlay:()=>({style:{getPropertyValue:()=>'',getPropertyPriority:()=>'',
      setProperty(){hidden=true;},removeProperty(){hidden=false;}}})});
    const controls={enabled:true,stop(){}};const renderer={render(){}};const originalRender=renderer.render;
    const binding={controls,renderer,scene:{},camera:{},manager:{mode:'on-demand',invalidate(){},
      loop:{onBeforeLoop(){return {off(){off++;}};}},
      onRender(){return {off(){off++;}};}}};
    api.override({findRenderContext:()=>binding,applyView:()=>[1]});
    const lock=api.createFrameLock({}, {signature:[1]});assert(hidden);assert.equal(controls.enabled,false);
    const waiting=lock.capture(0,()=>{});lock.release();
    assert.equal(hidden,false);assert.equal(controls.enabled,true);assert.equal(renderer.render,originalRender);
    assert.equal(off,2);lock.release();assert.equal(off,2);
    assert.throws(()=>api.createFrameLock({}, {signature:[2]}),/不一致/);assert.equal(hidden,false);
    return assert.rejects(waiting,/取消/);
  });
  test(`${variant}: stopping during an asynchronous PNG encode skips saving`,async()=>{
    const {api}=setup(code);let callback,saves=0;
    api.override({sanitizeSettingsFromUI(){},findViewerCanvas:()=>({}),applySolidLook(){},showPanel(){},
      createFrameLock:()=>({capture:async()=>{},release(){}}),
      createCanvasFrameSource:()=>({canvas:{toBlob(cb){callback=cb;}},cleanup(){}}),
      saveBlob:async()=>{saves++;},
    });
    const action=api.runExportAction(()=>api.takeScreenshot({outputFilename:'x.png'}));
    await new Promise(resolve=>setImmediate(resolve));assert(callback);api.stopRotation();callback(new Blob(['png']));
    await bounded(action);assert.equal(saves,0);assert.equal(api.busy,false);
  });

}

