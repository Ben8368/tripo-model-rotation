import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url), THREE=require('three');
for(const minify of [false,true]) {
  const {outputFiles}=await build({stdin:{contents:"export * from './src/offscreen/resource-copy'; export * from './src/offscreen/scene-copy';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',external:['three'],minify});
  const context=vm.createContext({require,module:{exports:{}},exports:{}});
  vm.runInContext(outputFiles[0].text,context);
  const {copyPageResources,copyPageScene}=context.module.exports;
  const variant=minify?'minified':'source';
  const copy=(scene,camera=new THREE.PerspectiveCamera())=>{
    const owned=new Set();const own=x=>{owned.add(x);return x;};
    const root=copyPageScene(scene,own);copyPageResources(root,camera,own);return {root,owned};
  };
  test(`${variant}: visible ShaderMaterial and RawShaderMaterial retain code, uniforms and source ownership`,()=>{
    for(const Type of [THREE.ShaderMaterial,THREE.RawShaderMaterial]) {
      const tex=new THREE.DataTexture(new Uint8Array([255,0,0,255]),1,1);tex.needsUpdate=true;
      const shared={map:tex,tint:new THREE.Color('red'),offset:new THREE.Vector3(1,2,3),weights:new Float32Array([.2,.8])};
      const source=new Type({uniforms:{map:{value:tex},nested:{value:[shared,shared]}},defines:{CUSTOM:1},vertexShader:'vertex test',fragmentShader:'fragment test'});
      source.defaultAttributeValues.extra=[1,2];source.index0AttributeName='position';
      source.userData.self=source.userData;source.clone=()=>{throw Error('do not call page shader clone');};
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(),source),scene=new THREE.Scene();scene.add(mesh);
      let sourceDisposals=0;for(const x of [tex,source,mesh.geometry])x.addEventListener('dispose',()=>sourceDisposals++);
      const {root,owned}=copy(scene);const target=root.children[0].material;
      assert.equal(target.isRawShaderMaterial,source.isRawShaderMaterial);assert.equal(target.fragmentShader,source.fragmentShader);
      assert.equal(target.index0AttributeName,'position');assert.notEqual(target.defaultAttributeValues.extra,source.defaultAttributeValues.extra);
      assert.deepEqual([...target.defaultAttributeValues.extra],[1,2]);
      assert.equal(target.vertexShader,source.vertexShader);assert.equal(target.defines.CUSTOM,1);
      const nested=target.uniforms.nested.value;
      assert.notEqual(target,source);assert.notEqual(target.uniforms.map.value,tex);
      assert.equal(nested[0],nested[1]);assert.equal(nested[0].map,target.uniforms.map.value);
      assert.notEqual(nested[0].tint,shared.tint);assert.notEqual(nested[0].offset,shared.offset);assert.notEqual(nested[0].weights,shared.weights);
      assert.deepEqual([...nested[0].weights],[...shared.weights]);
      assert.equal(target.uniforms.map.value.image,tex.image);assert(owned.has(target.uniforms.map.value));
      for(const x of owned)x.dispose();assert.equal(sourceDisposals,0);
      assert.equal(mesh.material,source);assert.equal(source.uniforms.map.value,tex);
    }
  });
  test(`${variant}: hidden ancestors, camera layers and explicit wire helpers cannot block normal model`,()=>{
    const scene=new THREE.Scene(),gpu=new THREE.WebGLRenderTarget(1,1);
    const shader=new THREE.ShaderMaterial({uniforms:{map:{value:gpu.texture}}});
    const hidden=new THREE.Group();hidden.visible=false;hidden.add(new THREE.Mesh(new THREE.BoxGeometry(),shader));scene.add(hidden);
    const excluded=new THREE.Mesh(new THREE.BoxGeometry(),shader);excluded.layers.set(2);scene.add(excluded);
    const wire=new THREE.ShaderMaterial({uniforms:{map:{value:gpu.texture}}});wire.userData.wireframe=true;scene.add(new THREE.Mesh(new THREE.BoxGeometry(),wire));
    const invisible=new THREE.ShaderMaterial({uniforms:{map:{value:gpu.texture}}});invisible.visible=false;scene.add(new THREE.Mesh(new THREE.BoxGeometry(),invisible));
    const normal=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());scene.add(normal);
    const {root,owned}=copy(scene);
    assert.equal(root.children[0].visible,false);
    for(const i of [1,2,3])assert.equal(root.children[i].material.visible,false);
    assert.notEqual(root.children[4].material,normal.material);assert(!owned.has(gpu.texture));
    gpu.dispose();
  });
  test(`${variant}: shared textures deduplicate across standard maps and nested shader uniforms`,()=>{
    const scene=new THREE.Scene(),texture=new THREE.Texture();
    const standard=new THREE.MeshStandardMaterial({map:texture,normalMap:texture});
    const shader=new THREE.ShaderMaterial({uniforms:{surface:{value:{maps:[texture]}}}});
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(),standard),new THREE.Mesh(new THREE.BoxGeometry(),shader));
    const {root,owned}=copy(scene);const a=root.children[0].material,b=root.children[1].material;
    assert.equal(a.map,a.normalMap);assert.equal(a.map,b.uniforms.surface.value.maps[0]);
    assert.equal([...owned].filter(x=>x.isTexture).length,1);
  });
  test(`${variant}: visible GPU-only shader texture reports node, material and uniform path`,()=>{
    const scene=new THREE.Scene(),gpu=new THREE.WebGLRenderTarget(1,1);
    const mat=new THREE.ShaderMaterial({uniforms:{surface:{value:{map:gpu.texture}}}});mat.name='surface';
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(),mat);mesh.name='model';scene.add(mesh);
    assert.throws(()=>copy(scene),/model.*surface.*uniforms.surface.value.map.*GPU/);gpu.dispose();
  });
  test(`${variant}: standard material GPU envMap is regenerated rather than copied`,()=>{
    const scene=new THREE.Scene(),gpu=new THREE.WebGLRenderTarget(1,1);
    const mat=new THREE.MeshStandardMaterial({envMap:gpu.texture});scene.add(new THREE.Mesh(new THREE.BoxGeometry(),mat));
    const {root}=copy(scene);assert.equal(root.children[0].material.envMap,null);assert.equal(mat.envMap,gpu.texture);gpu.dispose();
  });
  test(`${variant}: uniform blocks and material arrays receive independent owned values`,()=>{
    const scene=new THREE.Scene(),mat=new THREE.ShaderMaterial();
    const group=new THREE.UniformsGroup().setName('Settings').add(new THREE.Uniform(new THREE.Vector3(1,2,3)));
    mat.uniformsGroups=[group];scene.add(new THREE.Mesh(new THREE.BoxGeometry(),[mat,mat]));
    const {root,owned}=copy(scene),materials=root.children[0].material,clone=materials[0].uniformsGroups[0];
    assert.equal(materials[0],materials[1]);assert.notEqual(clone,group);assert(owned.has(clone));
    clone.uniforms[0].value.x=20;assert.equal(group.uniforms[0].value.x,1);
  });
}

const rendererBuild=await build({entryPoints:['src/offscreen/renderer.ts'],bundle:true,write:false,format:'cjs',external:['three','three/*']});
const rendererContext=vm.createContext({require,module:{exports:{}},exports:{},console});
vm.runInContext(rendererBuild.outputFiles[0].text,rendererContext);
const {IndependentRenderer}=rendererContext.module.exports;
test('wireframe overlay uses the configured pixel width and a separate triangle geometry',()=>{
  const engine=Object.create(IndependentRenderer.prototype);
  Object.assign(engine,{scene:new THREE.Scene(),owned:new Set(),meshes:[],wires:[],
    config:{batchWireframeVariants:true,wireframeWidth:.5,wireframeColor:'#123456',wireframeOpacity:.7}});
  const source=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
  const a=new THREE.Mesh(source,material),b=new THREE.Mesh(source,material);
  engine.scene.add(a,b);engine.configureMeshes();
  assert.equal(engine.wires.length,2);
  const wire=engine.wires[0],shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>'};
  wire.material.onBeforeCompile(shader,{});
  assert.equal(shader.uniforms.wireWidth.value,.5);
  assert.match(shader.fragmentShader,/fwidth\(vWireBarycentric\)/);
  assert.equal(wire.material.wireframe,false);
  assert.equal(wire.material.opacity,.7);
  assert.equal(wire.geometry,engine.wires[1].geometry);
  assert.notEqual(wire.geometry,source);
  assert.equal(wire.geometry.index,null);
  assert.equal(wire.geometry.getAttribute('wireBarycentric').count,wire.geometry.getAttribute('position').count);
  assert.equal(source.getAttribute('wireBarycentric'),undefined);
  for(const item of engine.owned)item.dispose();source.dispose();material.dispose();
});
test('snapshot integration preserves visible shader and hides auxiliary material slots in all passes',()=>{
  const engine=Object.create(IndependentRenderer.prototype);
  Object.assign(engine,{scene:new THREE.Scene(),owned:new Set(),meshes:[],wires:[],target:new THREE.Vector3(),startOffset:new THREE.Vector3(),startQuaternion:new THREE.Quaternion(),config:{batchWireframeVariants:true,wireframeWidth:2,wireframeColor:'#ffffff',wireframeOpacity:.5},renderer:{getContext:()=>({isContextLost:()=>false}),render(){},domElement:{}},studio(){}});
  const scene=new THREE.Scene(),shader=new THREE.ShaderMaterial(),helper=new THREE.ShaderMaterial();helper.userData.wireframe=true;
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),[shader,helper]);scene.add(mesh);
  const hidden=new THREE.Group();hidden.visible=false;hidden.add(new THREE.Mesh(new THREE.BoxGeometry(),helper));scene.add(hidden);
  const camera=new THREE.PerspectiveCamera();camera.position.z=5;camera.updateMatrixWorld();
  engine.snapshot({scene,camera,renderer:{toneMapping:THREE.NoToneMapping,toneMappingExposure:1}},[0,0,0]);
  const copy=engine.scene.children[0].children[0];
  assert.equal(engine.meshes.length,1);assert.equal(engine.wires.length,1);
  for(const mode of ['pbr','solid','normal']){
    engine.pose(.5);engine.render(mode,true);
    assert.equal(copy.material[0].visible,true);assert.equal(copy.material[1].visible,false);
    assert.equal(copy.children[0].material[1].visible,false);
    if(mode==='pbr')assert.equal(copy.material[0].isShaderMaterial,true);
  }
  assert.equal(mesh.material[0],shader);assert.equal(mesh.children.length,0);assert.equal(camera.position.x,0);
  for(const item of engine.owned)item.dispose();
});
