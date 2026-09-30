import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require=createRequire(import.meta.url);
const THREE=require('three');
for(const minify of [false,true]){
  const output=await build({entryPoints:['src/offscreen/scene-copy.ts'],bundle:true,write:false,format:'cjs',external:['three'],minify});
  const context=vm.createContext({require,module:{exports:{}},exports:{}});
  vm.runInContext(output.outputFiles[0].text,context);
  const {copyPageScene}=context.module.exports;
  const variant=minify?'minified':'source';
  test(variant+': reconstructs a scene with patched clone/traverse without calling page methods',()=>{
    const scene=new THREE.Scene(),group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
    group.position.set(1,2,3);group.visible=false;group.add(mesh);scene.add(group);scene.updateMatrixWorld(true);
    scene.clone=()=>undefined;
    assert.throws(()=>scene.clone().traverse(()=>{}),/traverse/);
    // The old whole-scene clone ends with undefined.traverse even for an empty Scene.
    scene.traverse=()=>{throw Error('page traverse must not execute');};
    group.clone=()=>{throw Error('page clone must not execute');};
    const circular={};circular.self=circular;mesh.userData=circular;
    const root=copyPageScene({__v_isRef:true,value:scene},x=>x);
    assert(root instanceof THREE.Scene);assert(root.children[0] instanceof THREE.Group);
    assert.notEqual(root,scene);assert.notEqual(root.children[0],group);
    assert.equal(root.children[0].visible,false);assert.deepEqual(root.children[0].position.toArray(),[1,2,3]);
    assert.equal(root.children[0].children[0].geometry,mesh.geometry);
    assert.equal(root.children[0].children[0].material,mesh.material);
    assert.equal(scene.children[0],group);assert.equal(group.children[0],mesh);
  });
  test(variant+': rebinds skinned meshes to copied bones and never shares skeleton disposal',()=>{
    const scene=new THREE.Scene(),bone=new THREE.Bone(),skin=new THREE.SkinnedMesh();scene.add(bone,skin);
    skin.bind(new THREE.Skeleton([bone]));scene.updateMatrixWorld(true);
    const resources=[];const root=copyPageScene(scene,x=>{resources.push(x);return x;});
    const copied=root.children[1];assert(copied instanceof THREE.SkinnedMesh);
    assert.notEqual(copied.skeleton,skin.skeleton);assert.equal(copied.skeleton.bones[0],root.children[0]);
    assert.notEqual(copied.skeleton.boneInverses[0],skin.skeleton.boneInverses[0]);
    assert(resources.includes(copied.skeleton));assert(!resources.includes(skin.skeleton));
    resources.forEach(x=>x.dispose());assert.equal(skin.skeleton.bones[0],bone);
  });
  test(variant+': copies instances and directional targets without source hierarchy mutation',()=>{
    const scene=new THREE.Scene();const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),2);
    mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(2,0,0));
    const light=new THREE.DirectionalLight();light.target.position.set(0,1,2);scene.add(mesh,light,light.target);scene.updateMatrixWorld(true);
    const root=copyPageScene(scene,x=>x);
    assert(root.children[0] instanceof THREE.InstancedMesh);
    assert.notEqual(root.children[0].instanceMatrix.array,mesh.instanceMatrix.array);
    assert.deepEqual([...root.children[0].instanceMatrix.array],[...mesh.instanceMatrix.array]);
    assert.equal(root.children[1].target,root.children[2]);assert.equal(light.target,scene.children[2]);
  });
  test(variant+': missing scene, invalid children, cycles and missing bones produce actionable errors',()=>{
    assert.throws(()=>copyPageScene(undefined,x=>x),/场景尚未就绪/);
    const scene=new THREE.Scene();scene.children.push(undefined);
    assert.throws(()=>copyPageScene(scene,x=>x),/无效场景节点/);
    scene.children=[scene];assert.throws(()=>copyPageScene(scene,x=>x),/循环/);
    const skin=new THREE.SkinnedMesh();skin.bind(new THREE.Skeleton([new THREE.Bone()]));scene.children=[skin];
    assert.throws(()=>copyPageScene(scene,x=>x),/骨骼不在场景内/);
  });
}
