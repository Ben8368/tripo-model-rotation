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
  'saveBlob','resumePendingSave','discardPendingSave','handleBeforeUnload','snapshotView','applyView',
  'isSolidSurfaceMaterial','patchSolidFragment','applyWireframeStyle','prepareRecording','snapshotIndependentModel','exportIndependent','handleRotationClick'];
const overrides = ['setStatus','sanitizeSettingsFromUI','requestProjectName','plannedExportItems',
  'currentMaterial','toggleIsOn','findWireframeButton','findViewerCanvas','snapshotView','findRenderContext',
  'showPanel','switchMaterial','switchWireframe','buildOutputFilename','takeScreenshot','applyView',
  'dispatchPointer','scheduleAutoShow','finalizeRecording','applySolidLook','findAxisOverlay',
  'createViewerBackgroundCanvas','createFrameLock','createCanvasFrameSource','saveBlob','chooseSingleFile',
  'createTabCapture','exportIndependent','snapshotIndependentModel','createIndependentRenderer','prepareRecording','captureDeterministicFrame','recordExportRestorePoint','sleep','chooseExportDirectory'];
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
  const context = vm.createContext({console:{info(){},warn(){},error(){}},DOMException,structuredClone,
    performance, Blob, URL, AbortController, setTimeout, clearTimeout,
    window:{setTimeout, clearTimeout}, document:{hidden:false,createElement:()=>({
      getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),fillRect(){}}),
      toBlob(callback){callback(new Blob(['background'],{type:'image/png'}));},
    })},
    location:{href:'https://studio.tripo3d.ai/workspace/generate/12345678-1234-4123-8123-123456789abc',pathname:'/workspace/generate/12345678-1234-4123-8123-123456789abc'},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}}, navigator:{},
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

  test(variant + ': independent recording uses supplied canvas and frozen config without page capture', async () => {
    const {api,context}=setup(code);
    const canvas={};const frameSource={canvas,width:128,height:128,drawFrame(){},cleanup(){}};
    api.config.recordingScope='tab';
    const transparent=await api.prepareRecording(null,{forceRecord:true,frameSource,config:{...api.config,transparentOutput:true,recordingFps:24}});
    assert.equal(transparent.canvas,canvas);assert.equal(transparent.fps,24);assert.equal(transparent.format,'mov');
    let chosen;
    context.VideoFrame=class {};
    context.VideoEncoder=class {
      static async isConfigSupported(config){return {supported:true,config};}
      configure(config){chosen=config;} close(){}
    };
    const mp4=await api.prepareRecording(null,{forceRecord:true,frameSource,config:{...api.config,transparentOutput:false,recordingFps:30}});
    assert.equal(mp4.canvas,canvas);assert.equal(mp4.fps,30);assert.equal(chosen.width,128);assert.equal(chosen.height,128);
  });

  test(variant + ': current-page offscreen copy prepares PBR then restores display before returning', async () => {
    const {api}=setup(code);const events=[];const canvas={isConnected:true};const view={target:[1,2,3]};
    const binding={};
    api.override({findViewerCanvas:()=>canvas,findRenderContext:()=>binding,snapshotView:()=>view,
      currentMaterial:()=>({id:'normal',label:'法线'}),toggleIsOn:()=>true,findWireframeButton:()=>({}),
      switchMaterial:async (m,restoring)=>events.push(['material',m.id,!!restoring]),
      switchWireframe:async (w,restoring)=>events.push(['wire',w,!!restoring]),
      createFrameLock:()=>({async capture(angle,copy){events.push(['capture',angle]);copy();},release(){events.push(['release']);}}),
      applyView:()=>events.push(['restore-view']),
    });
    await api.snapshotIndependentModel({snapshot(b,target){assert.equal(b,binding);assert.deepEqual(target,view.target);events.push(['copy']);}});
    assert.deepEqual(events,[['wire',false,false],['material','pbr',false],['capture',0],['copy'],['release'],['material','normal',true],['wire',true,true],['restore-view']]);
  });
  test(variant + ': failed or cancelled current-page copy restores the previous display', async () => {
    for (const cancel of [false,true]) {
      const {api}=setup(code);const restored=[];let copied=false;
      api.override({findViewerCanvas:()=>({isConnected:true}),findRenderContext:()=>({}),snapshotView:()=>({target:[0,0,0]}),
        currentMaterial:()=>({id:'solid'}),toggleIsOn:()=>true,findWireframeButton:()=>({}),
        switchWireframe:async (w,restore)=>{if(restore)restored.push('wire');},
        switchMaterial:async (m,restore)=>{if(restore)restored.push(m.id);else if(cancel)api.stopRotation();else throw Error('load failed');},
        applyView:()=>restored.push('view'),
      });
      await api.runExportAction(async()=>{
        await assert.rejects(api.snapshotIndependentModel({snapshot(){copied=true;}}),cancel?/停止/:/load failed/);
      });
      assert.equal(copied,false);assert.deepEqual(restored,['solid','wire','view']);
    }
  });

  test(variant + ': default rotation buttons and forced video jobs route to offscreen, without native rotation', async () => {
    const {api}=setup(code);const calls=[];
    api.override({sanitizeSettingsFromUI(){},currentMaterial:()=>({id:'normal',label:'法线'}),
      toggleIsOn:()=>true,findWireframeButton:()=>({}),exportIndependent:async (inputs,options)=>{calls.push(options);return 'saved.mp4';},
      findViewerCanvas(){throw Error('native rotation must not run');},
      requestProjectName:async()=> 'demo',recordExportRestorePoint(){},buildOutputFilename:()=> 'demo.mov',chooseExportDirectory:async()=>({kind:'directory'}),
    });
    for(const mode of ['uniform','transition'])await api.handleRotationClick(mode);
    api.config.recordEnabled=false;
    assert.equal(await api.startRotation('uniform',{forceRecord:true,outputFilename:'forced.mp4'}),'saved.mp4');
    assert.deepEqual(calls.map(o=>o.jobs[0].kind),['uniform','transition','uniform']);
    assert(calls.every(o=>o.jobs[0].material.id==='normal'&&o.jobs[0].wireframe));
    assert.equal(calls[0].outputTarget.kind,'directory');assert.equal(calls[2].outputFilename,'forced.mp4');
  });
  test(variant + ': default batch forwards all selected jobs once and never runs native screenshot/material loops', async () => {
    const {api}=setup(code);const jobs=['solid','pbr','normal'].map(id=>({key:'uniform:'+id,kind:'uniform',material:{id,label:id},wireframe:false}));let called=0;
    api.override({sanitizeSettingsFromUI(){},requestProjectName:async()=> 'demo',plannedExportItems:()=>jobs,recordExportRestorePoint(){},
      exportIndependent:async(inputs,options)=>{called++;assert.equal(inputs,null);assert.equal(options.jobs,jobs);assert.equal(options.projectName,'demo');return 'last.mp4';},
      switchMaterial(){throw Error('native material loop');},takeScreenshot(){throw Error('native capture');},
    });
    await api.runExportAction(()=>api.exportAll());assert.equal(called,1);assert.equal(api.busy,false);
  });
  test(variant + ': grouped offscreen export copies once, checkpoints ordered files, and disposes on failure', async () => {
    for(const fail of [false,true]){
      const {api}=setup(code);let copies=0,disposed=0,poses=0;const saves=[];const outputs=[];const backgrounds=[];
      const jobs=['pbr','solid','normal'].map(id=>({key:'uniform:'+id,kind:'uniform',material:{id,label:id},wireframe:false}));
      api.override({findViewerCanvas:()=>({}),createIndependentRenderer:async()=>({renderer:{domElement:{}},pose(){poses++;},render(){},dispose(){disposed++;}}),
        snapshotIndependentModel:async()=>{copies++;},prepareRecording:async(c,o)=>({frameIndex:0,outputFilename:o.outputFilename,cleanup(){}}),
        captureDeterministicFrame:async(session)=>{if(fail)throw Error('encode failed');session.frameIndex++;},
        finalizeRecording:async(session)=>{outputs.push(session.frameIndex);return session.outputFilename;},sleep:async()=>{},
        saveBlob:async(blob,name)=>{backgrounds.push(name);return name;},
      });
      const options={jobs,config:{...api.config,uniformDuration:.5,recordingFps:15,settleDuration:0},size:512,
        projectName:'test',outputTarget:{kind:'directory'},checkpointOrder:true,onSaved:name=>saves.push(name)};
      if(fail)await assert.rejects(api.exportIndependent(null,options),/encode failed/);
      else {await api.exportIndependent(null,options);assert.equal(saves.length,3);assert.deepEqual(outputs,[8,8,8]);assert.equal(poses,24);}
      assert.equal(copies,1);assert.equal(disposed,1);
      assert.deepEqual(backgrounds,['test-灰色渐变背景.png']);
      if(fail)assert.equal(saves.length,0);
    }
  });
  test(`${variant}: single screenshot saves a transparent offscreen PNG and its background`,async()=>{
    const {api}=setup(code);const saved=[];
    api.override({sanitizeSettingsFromUI(){},findViewerCanvas:()=>({}),snapshotIndependentModel:async()=>{},
      createIndependentRenderer:async()=>({pose(){},render(){return {toBlob(callback){callback(new Blob(['model'],{type:'image/png'}));}};},dispose(){}}),
      saveBlob:async(blob,name)=>{saved.push([name,blob.type]);return name;},sleep:async()=>{},
    });
    await api.exportIndependent(null,{projectName:'demo',size:512,outputTarget:{kind:'directory'},
      jobs:[{kind:'screenshot',key:'screenshot:pbr',material:{id:'pbr',label:'贴图'},wireframe:false}]});
    assert.deepEqual(saved,[['demo-灰色渐变背景.png','image/png'],['demo-单帧-贴图.png','image/png']]);
  });

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
  test(`${variant}: batch stop cancels the shared offscreen task`,async()=>{
    const {api}=setup(code);let called=0;
    api.override({sanitizeSettingsFromUI(){},requestProjectName:async()=> 'demo',recordExportRestorePoint(){},
      plannedExportItems:()=>[1,2,3].map(()=>({kind:'screenshot',material:{id:'pbr',label:'pbr'},wireframe:false})),
      exportIndependent:async()=>{called++;api.stopRotation();api.throwIfCancelled();},
    });
    await bounded(api.runExportAction(()=>api.exportAll()));
    assert.equal(called,1);assert.equal(api.busy,false);
  });
  test(`${variant}: material switching checks cancellation before proceeding`,async()=>{
    const {api}=setup(code);let ran=false;
    await api.runExportAction(async()=>{
      api.stopRotation();await api.switchMaterial({id:'solid'});ran=true;
    });
    assert.equal(ran,false);assert.equal(api.busy,false);
  });
  test(`${variant}: pale linear white and custom shaders remain eligible for solid brightening`,()=>{
    const {api}=setup(code);
    const pale={isMeshPhysicalMaterial:true,color:{r:0.6,g:0.6,b:0.6},clone(){}};
    assert.equal(api.isSolidSurfaceMaterial(pale),true);
    assert.equal(api.isSolidSurfaceMaterial({...pale,userData:{wireframe:true}}),false);
    assert.equal(api.isSolidSurfaceMaterial({...pale,color:{r:1,g:0.2,b:0.2}}),false);
    const shader='void main() { gl_FragColor = vec4(1.0); #include <dithering_fragment> }';
    assert.match(api.patchSolidFragment(shader,'0.8'),/tripoSolidBase/);
    assert.equal(api.patchSolidFragment('void main() {}','0.8'),'');
  });
  test(`${variant}: wireframe controls update shader uniforms before export`,()=>{
    const {api}=setup(code);let invalidations=0,color='#000000';
    const uniforms={linewidth:{value:1},wireframeColor:{value:{getHexString:()=>color.slice(1),set:value=>{color=value;}}},
      wireframeOpacity:{value:0.7},minAlpha:{value:0.1}};
    const binding={scene:{traverse:visit=>visit({material:{userData:{wireframe:true},uniforms}})},
      manager:{invalidate(){invalidations++;}}};
    api.override({findViewerCanvas:()=>({}),findRenderContext:()=>binding});
    api.config.wireframeWidth=2;api.config.wireframeColor='#123456';api.config.wireframeOpacity=0.05;
    assert.equal(api.applyWireframeStyle(true),1);
    assert.equal(uniforms.linewidth.value,2);assert.equal(color,'#123456');
    assert.equal(uniforms.wireframeOpacity.value,0.05);assert.equal(uniforms.minAlpha.value,0.05);
    assert.equal(invalidations,1);
    assert.equal(api.applyWireframeStyle(true),1);assert.equal(invalidations,1);
  });
  test(`${variant}: DOM axis visibility is restored after model copy`,()=>{
    const {api}=setup(code);const style=new Map([['visibility',['visible','important']]]);
    api.override({findAxisOverlay:()=>({style:{
      getPropertyValue:k=>style.get(k)?.[0]||'',getPropertyPriority:k=>style.get(k)?.[1]||'',
      setProperty:(k,v,p)=>style.set(k,[v,p]),removeProperty:k=>style.delete(k),
    }})});
    const restore=api.hideAxisOverlay({});assert.deepEqual(style.get('visibility'),['hidden','important']);
    restore();assert.deepEqual(style.get('visibility'),['visible','important']);
    api.config.showAxisInOutput=true;api.hideAxisOverlay({});
    assert.deepEqual(style.get('visibility'),['visible','important']);
  });
  test(`${variant}: shared frame wait is cancellable`,async()=>{
    const {api}=setup(code);let cancelled=false;
    const action=api.runExportAction(()=>api.waitForTabFrame({
      requestVideoFrameCallback:()=>1,cancelVideoFrameCallback:()=>{cancelled=true;},
    }));
    api.stopRotation();await bounded(action);assert(cancelled);assert.equal(api.busy,false);
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
    api.config.transparentOutput=false;
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
  test(`${variant}: native frame lock accepts Vue-wrapped render arguments and rejects camera changes`, async () => {
    const {api,context}=setup(code);
    api.config.transparentOutput=false;
    context.document.addEventListener=()=>{};context.document.removeEventListener=()=>{};
    const proxy=target=>new Proxy(target,{
      get(target,key,receiver){return key==='__v_raw'?target:Reflect.get(target,key,receiver);},
    });
    const canvas={isConnected:true,width:640,height:480};
    const camera={isCamera:true,zoom:1,matrixWorld:{elements:[0]},projectionMatrix:{elements:[1]},
      updateMatrixWorld(){}};
    const vector={toArray:()=>[0,0,0]};let theta=0;
    const controls={camera:proxy(camera),enabled:true,stop(){},
      getSpherical:()=>({theta,phi:1}),getPosition:()=>vector,getTarget:()=>vector,getFocalOffset:()=>vector,
      setLookAt(){theta=0;},setFocalOffset(){},zoomTo(){},rotateTo(angle){theta=angle;},
      update(){camera.matrixWorld.elements[0]=theta;}};
    const scene={};const renderer={render(){}};const originalRender=renderer.render;
    let before,after,off=0;
    const manager={mode:'on-demand',invalidate(){
      before();
      // A different camera, even with the same matrices, must not be captured.
      renderer.render(proxy(scene),{...camera});after();
      renderer.render(proxy(scene),proxy(camera));after();
    },loop:{onBeforeLoop(cb){before=cb;return {off(){off++;}};}},
    onRender(cb){after=cb;return {off(){off++;}};}};
    const binding={canvas,camera,controls,scene,renderer,manager,context:{
      camera:{activeCamera:{__v_isRef:true,value:proxy(camera)}},
      scene:proxy(scene),controls:proxy(controls),
    }};
    api.override({findRenderContext:()=>binding,findAxisOverlay:()=>null});
    const lock=api.createFrameLock(canvas,api.snapshotView(binding));
    let copies=0;
    const result=await bounded(lock.capture(0.5,signature=>{copies++;return [...signature];}));
    assert.deepEqual(result,[0.5,1]);assert.equal(copies,1);
    controls.camera={...camera};
    await assert.rejects(bounded(lock.capture(1,()=>{copies++;})),/相机或工程已变化/);
    assert.equal(copies,1);
    lock.release();assert.equal(controls.enabled,true);assert.equal(renderer.render,originalRender);assert.equal(off,2);
  });

}

