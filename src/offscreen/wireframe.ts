import * as THREE from 'three';

/** Triangle barycentrics let the fragment shader measure edge distance in output pixels. */
export function wireframeGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const count = geometry.getAttribute('position').count;
  const barycentrics = new Float32Array(count * 3);
  for (let vertex = 0; vertex + 2 < count; vertex += 3) {
    barycentrics[vertex * 3] = 1;
    barycentrics[(vertex + 1) * 3 + 1] = 1;
    barycentrics[(vertex + 2) * 3 + 2] = 1;
  }
  geometry.setAttribute('wireBarycentric', new THREE.BufferAttribute(barycentrics, 3));
  return geometry;
}

export function wireframeMaterial(original: THREE.Material, width: number, color: string, opacity: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color, visible: original.visible, side: original.side,
    transparent: true, opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.wireWidth = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 wireBarycentric;\nvarying vec3 vWireBarycentric;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWireBarycentric = wireBarycentric;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float wireWidth;\nvarying vec3 vWireBarycentric;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 edgePixels = vWireBarycentric / max(fwidth(vWireBarycentric), vec3(0.000001));
        float edgeDistance = min(edgePixels.x, min(edgePixels.y, edgePixels.z));
        float halfWidth = max(wireWidth, 1.0) * 0.5;
        float coverage = 1.0 - smoothstep(max(halfWidth - 0.5, 0.0), halfWidth + 0.5, edgeDistance);
        diffuseColor.a *= coverage * min(wireWidth, 1.0);
        if (diffuseColor.a <= 0.0) discard;`);
  };
  return material;
}
