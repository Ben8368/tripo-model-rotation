import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const loaderFile = new URL('../tripo-model-rotation.user.js', import.meta.url);
const coreFile = new URL('../dist/tripo-core.min.js', import.meta.url);
const standaloneFile = new URL('../dist/tripo-model-rotation.standalone.user.js', import.meta.url);

test('installable loader points to the immutable GitHub release tag',async()=>{
  const code=await readFile(loaderFile,'utf8');
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert(code.startsWith('// ==UserScript==\n'));
  assert(code.includes(`// @version      ${pkg.version}\n`));
  assert(code.includes(`// @require      https://raw.githubusercontent.com/Ben8368/tripo-model-rotation/v${pkg.version}/dist/tripo-core.min.js\n`));
  assert(code.includes('// ==/UserScript==\n'));
  assert(!code.includes('Copyright (c) 2023 Vanilagy'));
  assert(!code.includes('sourceMappingURL'));assert(!code.includes('sourcesContent'));
  assert(!code.includes('function stopRotation('));
  assert(!code.includes('__SCRIPT_VERSION__'));
  new vm.Script(code);
});

test('remote core has its license, no metadata or source map, and valid syntax',async()=>{
  const code=await readFile(coreFile,'utf8');
  assert(code.includes('Copyright (c) 2023 Vanilagy'));
  assert(!code.includes('// ==UserScript=='));
  assert(!code.includes('sourceMappingURL'));assert(!code.includes('sourcesContent'));
  assert(!code.includes('function stopRotation('));
  assert(!code.includes('__SCRIPT_VERSION__'));
  new vm.Script(code);
});

test('remote core mounts its UI and registers shortcuts in a simulated page',async()=>{
  const code=await readFile(coreFile,'utf8');const elements=new Map(),listeners=new Map();
  function element() {return {style:{},dataset:{},value:'',hidden:false,checked:false,
    setAttribute(){},addEventListener(){},append(){},appendChild(){},querySelectorAll:()=>[]};}
  const shadow={querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},
    querySelectorAll:()=>[],addEventListener(){}};
  let mounted=false;
  const document={createElement:()=>({...element(),attachShadow:()=>shadow}),
    createTextNode:text=>({textContent:text}),documentElement:{appendChild(){mounted=true;}},
    querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set(name,fn)};
  const context=vm.createContext({document,window:{setInterval(){},addEventListener(){},setTimeout(){return 0;},clearTimeout(){}},
    localStorage:{getItem:()=>null},location:{pathname:'/workspace/generate'},
    fetch:async()=>({ok:true,json:async()=>({service:'tripo-model-rotation',enabled:true})}),
    AbortController:class { constructor(){this.signal={};} abort(){} },
    console:{info(){},warn(){},error(...args){console.error('artifact core error',...args);}},URL});
  await vm.runInContext(code,context);
  await new Promise(resolve => setImmediate(resolve));
  assert(mounted);assert(shadow.innerHTML.includes('3.9.5'));assert(listeners.has('keydown'));
  assert.equal(elements.get('.status').textContent,'等待模型预览器加载…');
});

test('remote core does not mount when GitHub Raw is unavailable',async()=>{
  const code=await readFile(coreFile,'utf8');let mounted=false;
  const document={createElement:()=>({attachShadow:()=>({})}),documentElement:{appendChild(){mounted=true;}}};
  const context=vm.createContext({document,window:{setTimeout,clearTimeout},fetch:async()=>({ok:false}),
    console:{info(){},warn(){},error(){}},URL});
  await vm.runInContext(code,context);
  assert.equal(mounted,false);
});

test('standalone fallback embeds core without a remote dependency',async()=>{
  const code=await readFile(standaloneFile,'utf8');
  assert(code.startsWith('// ==UserScript==\n'));
  assert(!code.includes('// @require'));
  assert(code.includes('Copyright (c) 2023 Vanilagy'));
  new vm.Script(code);
});

test('rebuilding with locked dependencies is byte-for-byte deterministic',async()=>{
  const before=await Promise.all([loaderFile,coreFile,standaloneFile].map(file=>readFile(file)));
  execFileSync(process.execPath,['scripts/build.mjs'],{cwd:new URL('..',import.meta.url),stdio:'pipe'});
  const after=await Promise.all([loaderFile,coreFile,standaloneFile].map(file=>readFile(file)));
  assert.deepEqual(after,before);
});
