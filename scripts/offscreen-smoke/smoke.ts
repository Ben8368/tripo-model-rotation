import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { IndependentRenderer } from '../../src/offscreen/renderer';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { renderFrameBatch } from '../../src/offscreen/plan';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
async function run(){
 const logs=[];const assert=(ok,msg)=>{if(!ok)throw Error(msg);logs.push('PASS '+msg);document.querySelector('pre').textContent=logs.join('\n');};
 const config={...DEFAULT_SETTINGS,transparentOutput:true,batchWireframeVariants:true};
 const scene=new THREE.Scene();const geometry=new THREE.BoxGeometry(1,2,1);const material=new THREE.MeshStandardMaterial({color:0xd03020});
 const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);scene.add(new THREE.HemisphereLight(0xffffff,0x444444,2));
 const camera=new THREE.PerspectiveCamera(35,1,.01,100);camera.position.set(0,.2,5);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const oldPosition=camera.position.toArray().join(',');const native=new THREE.WebGLRenderer({alpha:true});
 const engine=new IndependentRenderer(128,config as any);const loaded=new IndependentRenderer(128,config as any);
 try {
  const originalClone=scene.clone;
  // Model the page incompatibility reported by users; snapshot must not call this method.
  (scene as any).clone=()=>undefined;
  try { engine.snapshot({scene,camera,renderer:native},[0,0,0]); }
  finally { scene.clone=originalClone; }
  assert(true,'snapshot bypasses page clone returning undefined');
  const hashes=[];
  for(const mode of ['pbr','solid','normal']){
   const canvas=engine.render(mode as any,false);const gl=engine.renderer.getContext();const bytes=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
   assert(bytes[3]===0,mode+' transparent background');assert(bytes.some((x,i)=>i%4===3&&x>0),mode+' visible geometry');
   hashes.push(bytes.reduce((sum,x,i)=>(sum+x*(i%31+1))%1000000007,0));
   const image=new Image();image.src=canvas.toDataURL();document.querySelector('#frames').append(image);
  }
  assert(new Set(hashes).size===3,'three distinct material passes');
  engine.pose(1);engine.render('pbr',true);
  assert(camera.position.toArray().join(',')===oldPosition&&mesh.material===material&&mesh.children.length===0,'source camera/material/children untouched');
  const data=await new GLTFExporter().parseAsync(scene,{binary:true});
  await loaded.load(new File([data as ArrayBuffer],'fixture.glb'),new AbortController().signal);
  loaded.render('pbr',false);assert(loaded.camera.position.length()>0,'embedded GLB parsed and auto-framed');
  const targets=[new ArrayBufferTarget(),new ArrayBufferTarget(),new ArrayBufferTarget()];
  const muxers=targets.map(target=>new Muxer({target,video:{codec:'avc',width:128,height:128,frameRate:30},fastStart:'in-memory'}));
  const counts=[0,0,0];let error;
  const encoders=muxers.map((mux,i)=>new VideoEncoder({output(c,m){counts[i]++;mux.addVideoChunk(c,m);},error(e){error=e;}}));
  for(const encoder of encoders)encoder.configure({codec:'avc1.42001f',width:128,height:128,bitrate:1000000,framerate:30,avc:{format:'avc'}});
  await renderFrameBatch([0,.2,.4,.6],['pbr','solid','normal'],{check(){},pose:a=>loaded.pose(a),async capture(mode,index){
   const canvas=loaded.render(mode as any,false);const i=['pbr','solid','normal'].indexOf(mode);
   const frame=new VideoFrame(canvas,{timestamp:Math.round(index*1e6/30),duration:Math.round((index+1)*1e6/30)-Math.round(index*1e6/30)});
   try{encoders[i].encode(frame,{keyFrame:index===0});}finally{frame.close();}
  },async progress(){}});
  await Promise.all(encoders.map(e=>e.flush()));if(error)throw error;encoders.forEach(e=>e.close());muxers.forEach(m=>m.finalize());
  assert(counts.every(x=>x===4)&&targets.every(t=>t.buffer.byteLength>1024),'three real H.264 MP4 streams, four frames each');
  for(const target of targets){
   const video=document.createElement('video');video.muted=true;video.src=URL.createObjectURL(new Blob([target.buffer],{type:'video/mp4'}));
   await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});
   assert(video.videoWidth===128&&Math.abs(video.duration-4/30)<.02,'MP4 decodes with correct dimensions/duration');URL.revokeObjectURL(video.src);
  }
 } finally{engine.dispose();loaded.dispose();native.dispose();geometry.dispose();material.dispose();}
 assert(mesh.geometry===geometry&&mesh.material===material,'snapshot disposal leaves source ownership intact');
 document.title='PASS — Offscreen smoke';
}
run().catch(e=>{document.title='FAIL — Offscreen smoke';document.querySelector('pre').textContent+='\nFAIL '+e.stack;});
