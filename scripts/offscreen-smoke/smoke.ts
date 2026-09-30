import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { IndependentRenderer } from '../../src/offscreen/renderer';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { renderFrameBatch } from '../../src/offscreen/plan';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
async function run(){
 const logs=[];const assert=(ok,msg)=>{if(!ok)throw Error(msg);logs.push('PASS '+msg);document.querySelector('pre').textContent=logs.join('\n');};
 const config={...DEFAULT_SETTINGS,transparentOutput:true,batchWireframeVariants:true,wireframeWidth:.5,wireframeColor:'#00ff00',wireframeOpacity:1};
 const scene=new THREE.Scene();const geometry=new THREE.BoxGeometry(1,2,1);const material=new THREE.MeshStandardMaterial({color:0xd03020});
 const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);scene.add(new THREE.HemisphereLight(0xffffff,0x444444,2));
 const camera=new THREE.PerspectiveCamera(35,1,.01,100);camera.position.set(0,.2,5);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const oldPosition=camera.position.toArray().join(',');const native=new THREE.WebGLRenderer({alpha:true});
 const shaderEngine=new IndependentRenderer(128,config as any);
 const shaderScene=new THREE.Scene();
 const texture=new THREE.DataTexture(new Uint8Array([240,30,10,255]),1,1);texture.needsUpdate=true;
 const shader=new THREE.ShaderMaterial({
  uniforms:{surface:{value:{map:texture}}},
  vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'struct Surface { sampler2D map; }; uniform Surface surface; varying vec2 vUv; void main(){gl_FragColor=texture2D(surface.map,vUv);}',
 });
 const shaderMesh=new THREE.Mesh(geometry,shader);shaderScene.add(shaderMesh);
 const gpu=new THREE.WebGLRenderTarget(1,1);
 const helperShader=new THREE.ShaderMaterial({uniforms:{gpu:{value:gpu.texture}}});
 const hidden=new THREE.Group();hidden.visible=false;hidden.add(new THREE.Mesh(geometry,helperShader));shaderScene.add(hidden);
 const wireShader=new THREE.ShaderMaterial({uniforms:{gpu:{value:gpu.texture}}});wireShader.userData.wireframe=true;
 shaderScene.add(new THREE.Mesh(geometry,wireShader));
 let sourceDisposed=0;for(const resource of [texture,shader,geometry])resource.addEventListener('dispose',()=>sourceDisposed++);
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
  const pixels=(canvas:HTMLCanvasElement)=>{
   const gl=canvas.getContext('webgl2') as WebGL2RenderingContext;
   const data=new Uint8Array(128*128*4);
   gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,data);
   return data;
  };
  const changedPixels=(base:Uint8Array,wire:Uint8Array)=>{
   let count=0;for(let i=0;i<base.length;i+=4)if(wire[i+1]>base[i+1]+2)count++;
   return count;
  };
  engine.pose(1);engine.render('pbr',false);
  const base=pixels(engine.renderer.domElement);
  engine.render('pbr',true);
  const thinCount=changedPixels(base,pixels(engine.renderer.domElement));
  const thickEngine=new IndependentRenderer(128,{...config,wireframeWidth:4} as any);
  try{
   thickEngine.snapshot({scene,camera,renderer:native},[0,0,0]);
   thickEngine.pose(1);thickEngine.render('pbr',true);
   const thickCount=changedPixels(base,pixels(thickEngine.renderer.domElement));
   assert(thinCount>0&&thickCount>thinCount*1.5,`wireframe width changes exported pixels (${thinCount} vs ${thickCount})`);
  }finally{thickEngine.dispose();}
  assert(camera.position.toArray().join(',')===oldPosition&&mesh.material===material&&mesh.children.length===0,'source camera/material/children untouched');
  const data=await new GLTFExporter().parseAsync(scene,{binary:true});
  await loaded.load(new File([data as ArrayBuffer],'fixture.glb'),new AbortController().signal);
  loaded.render('pbr',false);assert(loaded.camera.position.length()>0,'embedded GLB parsed and auto-framed');
  shaderEngine.snapshot({scene:shaderScene,camera,renderer:native},[0,0,0]);
  const shaderHashes=[];
  for(const mode of ['pbr','solid','normal']){
   shaderEngine.render(mode as any,false);
   const gl=shaderEngine.renderer.getContext(),bytes=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
   const center=(64*128+64)*4;
   assert(bytes[center+3]>0,'custom shader '+mode+' has visible center');
   if(mode==='pbr')assert(bytes[center]>bytes[center+1]*3,'nested shader texture survives snapshot with red pixels');
   assert(bytes[3]===0,'custom shader '+mode+' ignores hidden and wire helpers');
   shaderHashes.push(bytes.reduce((sum,x,i)=>(sum+x*(i%31+1))%1000000007,0));
  }
  assert(new Set(shaderHashes).size===3,'custom shader supports three distinct passes');
  const rawEngine=new IndependentRenderer(128,config as any);
  const raw=new THREE.RawShaderMaterial({uniforms:shader.uniforms,
   vertexShader:'precision highp float; attribute vec3 position; attribute vec2 uv; uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix; '+shader.vertexShader,
   fragmentShader:'precision highp float; '+shader.fragmentShader});
  try{
   shaderMesh.material=raw as any;rawEngine.snapshot({scene:shaderScene,camera,renderer:native},[0,0,0]);rawEngine.render('pbr',false);
   const gl=rawEngine.renderer.getContext(),pixel=new Uint8Array(4);gl.readPixels(64,64,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
   assert(pixel[0]>pixel[1]*3&&pixel[3]>0,'RawShaderMaterial renders nested texture');
  }finally{rawEngine.dispose();raw.dispose();shaderMesh.material=shader;}
  const targets=[new ArrayBufferTarget(),new ArrayBufferTarget(),new ArrayBufferTarget()];
  const muxers=targets.map(target=>new Muxer({target,video:{codec:'avc',width:128,height:128,frameRate:30},fastStart:'in-memory'}));
  const counts=[0,0,0];let error;
  const encoders=muxers.map((mux,i)=>new VideoEncoder({output(c,m){counts[i]++;mux.addVideoChunk(c,m);},error(e){error=e;}}));
  for(const encoder of encoders)encoder.configure({codec:'avc1.42001f',width:128,height:128,bitrate:1000000,framerate:30,avc:{format:'avc'}});
  await renderFrameBatch([0,.2,.4,.6],['pbr','solid','normal'],{check(){},pose:a=>shaderEngine.pose(a),async capture(mode,index){
   const canvas=shaderEngine.render(mode as any,false);const i=['pbr','solid','normal'].indexOf(mode);
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
  shaderEngine.dispose();
  assert(sourceDisposed===0&&shaderMesh.material===shader&&shader.uniforms.surface.value.map===texture,'shader disposal leaves source resources untouched');
 } finally{shaderEngine.dispose();engine.dispose();loaded.dispose();native.dispose();geometry.dispose();material.dispose();shader.dispose();texture.dispose();helperShader.dispose();wireShader.dispose();gpu.dispose();}
 assert(mesh.geometry===geometry&&mesh.material===material,'snapshot disposal leaves source ownership intact');
 document.title='PASS — Offscreen smoke';
}
run().catch(e=>{document.title='FAIL — Offscreen smoke';document.querySelector('pre').textContent+='\nFAIL '+e.stack;});
