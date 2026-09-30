import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({entryPoints:['src/offscreen/plan.ts'], bundle:true, write:false, format:'esm'});
const api = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
function glb(json) {
  const text = Buffer.from(JSON.stringify(json));
  const length = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(20 + length); bytes.fill(32,20);
  const view = new DataView(bytes.buffer);
  [0x46546c67,2,bytes.length,length,0x4e4f534a].forEach((n,i)=>view.setUint32(i*4,n,true));
  bytes.set(text,20); return bytes.buffer;
}
test('GLB validation accepts embedded resources and Meshopt but rejects truncation and sidecars',()=>{
  api.inspectGlb(glb({asset:{version:'2.0'},buffers:[{byteLength:0}],images:[{uri:'data:image/png;base64,AA=='}],extensionsUsed:['EXT_meshopt_compression']}));
  assert.throws(()=>api.inspectGlb(new ArrayBuffer(8)),/GLB/);
  const truncated=glb({});new DataView(truncated).setUint32(12,99999,true);
  assert.throws(()=>api.inspectGlb(truncated),/不完整/);
  for (const entry of [{images:[{uri:'https://example.com/p.png'}]},{buffers:[{uri:'../model.bin'}]},
    {extensionsUsed:['KHR_draco_mesh_compression']},{extensionsUsed:['KHR_texture_basisu']}]) {
    assert.throws(()=>api.inspectGlb(glb(entry)));
  }
});
test('remote source validation preserves signed HTTPS URLs and rejects credentials and unsafe schemes',()=>{
  assert.equal(api.glbUrl(' https://example.com/a.glb?signature=123 '),'https://example.com/a.glb?signature=123');
  for (const url of ['http://example.com/a.glb','file:///C:/a.glb','javascript:alert(1)','https://user:secret@example.com']) assert.throws(()=>api.glbUrl(url));
});
test('groups all selected jobs once, keeps trajectories separate and bounds encoder concurrency',()=>{
  const jobs=['uniform','transition','screenshot'].flatMap(kind=>['pbr','solid','normal'].flatMap(material=>[false,true].map(wireframe=>({kind,material,wireframe}))));
  const groups=api.groupOffscreenJobs(jobs);
  assert.equal(groups.length,6);
  assert.equal(new Set(groups.flat()).size,jobs.length);
  assert(groups.every(g=>g.length<=3&&g.every(j=>j.kind===g[0].kind)));
  assert(api.groupOffscreenJobs(jobs,1).every(g=>g.length===1));
  assert.throws(()=>api.groupOffscreenJobs(jobs,0));
});
test('one camera update per angle, awaited capture per material, and identical frame indices',async()=>{
  const events=[];
  await api.renderFrameBatch([0,1,2],['pbr','solid','normal'],{
    check(){},pose(a){events.push(['pose',a]);},async capture(m,i){await Promise.resolve();events.push([m,i]);},async progress(i){events.push(['progress',i]);},
  });
  assert.deepEqual(events,[0,1,2].flatMap(i=>[['pose',i],['pbr',i],['solid',i],['normal',i],['progress',i]]));
});
test('cancelling or failing a material does not render or save later passes',async()=>{
  let cancelled=false;const captured=[];
  await assert.rejects(api.renderFrameBatch([0,1],['pbr','solid'],{
    check(){if(cancelled)throw Error('cancelled');},pose(){},async capture(m){captured.push(m);cancelled=true;},async progress(){},
  }),/cancelled/);
  assert.deepEqual(captured,['pbr']);
  let poses=0;
  await assert.rejects(api.renderFrameBatch([0,1],['pbr'],{
    check(){},pose(){poses++;},async capture(){throw Error('GPU lost');},async progress(){},
  }),/GPU lost/);
  assert.equal(poses,1);
});
