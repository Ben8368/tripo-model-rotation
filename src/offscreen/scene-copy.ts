import * as THREE from 'three';
import { nativeObject } from '../rotation/render-context';

/** Build our own hierarchy without invoking application-patched clone/copy/traverse methods. */
export function copyPageScene(input: unknown, own: <T extends { dispose(): void }>(value: T) => T): THREE.Scene {
  const source = nativeObject(input);
  if (!source?.isScene || !Array.isArray(source.children)) throw new Error('当前模型场景尚未就绪，请等待加载完成后重试');
  const mapping = new Map<any, THREE.Object3D>();
  const skins: Array<[any, THREE.SkinnedMesh]> = [];
  const lights: Array<[any, any]> = [];
  const copy = (value: any): THREE.Object3D => {
    const node = nativeObject(value);
    if (!node?.isObject3D || !Array.isArray(node.children)) throw new Error('当前模型包含无效场景节点，请重新加载模型');
    if (mapping.has(node)) throw new Error('当前模型场景节点重复或存在循环引用');
    if (node.isBatchedMesh) throw new Error('当前模型的 BatchedMesh 暂不支持离屏复制');
    let result: any;
    if (node.isScene) result = new THREE.Scene();
    else if (node.isSkinnedMesh) result = new THREE.SkinnedMesh();
    else if (node.isInstancedMesh) result = own(new THREE.InstancedMesh(node.geometry, node.material, node.count));
    else if (node.isMesh) result = new THREE.Mesh();
    else if (node.isBone) result = new THREE.Bone();
    else if (node.isDirectionalLight) result = new THREE.DirectionalLight();
    else if (node.isSpotLight) result = new THREE.SpotLight();
    else if (node.isPointLight) result = new THREE.PointLight();
    else if (node.isHemisphereLight) result = new THREE.HemisphereLight();
    else if (node.isAmbientLight) result = new THREE.AmbientLight();
    else if (node.isRectAreaLight) result = new THREE.RectAreaLight();
    else if (node.isLineSegments) result = new THREE.LineSegments();
    else if (node.isLineLoop) result = new THREE.LineLoop();
    else if (node.isLine) result = new THREE.Line();
    else if (node.isPoints) result = new THREE.Points();
    else if (node.isSprite) result = new THREE.Sprite();
    else result = new THREE.Group();
    mapping.set(node, result);
    result.name = node.name;
    for (const key of ['position', 'quaternion', 'scale', 'up', 'matrix', 'matrixWorld']) result[key].copy(node[key]);
    for (const key of ['visible', 'matrixAutoUpdate', 'matrixWorldAutoUpdate', 'frustumCulled', 'renderOrder']) {
      if (node[key] !== undefined) result[key] = node[key];
    }
    result.layers.mask = node.layers.mask;
    if (node.geometry) result.geometry = nativeObject(node.geometry);
    if (node.material) result.material = Array.isArray(node.material) ? node.material.map(nativeObject) : nativeObject(node.material);
    if (node.morphTargetInfluences) result.morphTargetInfluences = [...node.morphTargetInfluences];
    if (node.morphTargetDictionary) result.morphTargetDictionary = { ...node.morphTargetDictionary };
    if (node.isSkinnedMesh) skins.push([node, result]);
    if (node.isInstancedMesh) {
      result.instanceMatrix.copy(node.instanceMatrix);
      if (node.instanceColor) result.instanceColor = node.instanceColor.clone();
      if (node.morphTexture) result.morphTexture = own(node.morphTexture.clone());
    }
    if (node.isLight && result.isLight) {
      result.color.copy(node.color); result.intensity = node.intensity;
      if (node.groundColor) result.groundColor.copy(node.groundColor);
      for (const key of ['distance', 'decay', 'angle', 'penumbra', 'width', 'height']) if (node[key] !== undefined) result[key] = node[key];
      if (node.target) lights.push([node, result]);
    }
    for (const child of node.children) result.add(copy(child));
    return result;
  };
  const root = copy(source) as THREE.Scene;
  for (const [node, mesh] of skins) {
    const skeleton = nativeObject(node.skeleton);
    if (!skeleton?.bones?.length) throw new Error('当前蒙皮模型缺少骨骼数据');
    const bones = skeleton.bones.map((bone: any) => {
      const cloned = mapping.get(nativeObject(bone));
      if (!(cloned as any)?.isBone) throw new Error('当前蒙皮模型骨骼不在场景内，无法完整复制');
      return cloned as THREE.Bone;
    });
    mesh.skeleton = own(new THREE.Skeleton(bones, skeleton.boneInverses.map((matrix: any) => new THREE.Matrix4().copy(matrix))));
    mesh.bindMode = node.bindMode;
    mesh.bindMatrix.copy(node.bindMatrix);
    mesh.bindMatrixInverse.copy(node.bindMatrixInverse);
  }
  for (const [node, light] of lights) {
    const target = nativeObject(node.target);
    light.target = mapping.get(target) || new THREE.Object3D();
    if (!mapping.has(target)) {
      light.target.position.setFromMatrixPosition(target.matrixWorld);
      root.add(light.target);
    }
  }
  root.updateMatrixWorld(true);
  return root;
}
