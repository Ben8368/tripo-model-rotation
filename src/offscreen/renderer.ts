import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { copyPageScene } from './scene-copy';
import { copyPageResources } from './resource-copy';
import { nativeObject } from '../rotation/render-context';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { inspectGlb, glbUrl } from './plan';
import type { MaterialId, Settings } from '../types/settings';

const MAX_GLB_BYTES = 256 * 1024 * 1024;
export async function readGlb(input: File | string, signal: AbortSignal): Promise<ArrayBuffer> {
  let data: ArrayBuffer;
  if (typeof input === 'string') {
    const response = await fetch(glbUrl(input), { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`GLB 下载失败（HTTP ${response.status}）`);
    if (Number(response.headers.get('content-length')) > MAX_GLB_BYTES) throw new Error('GLB 超过 256MB 上限');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('浏览器不支持流式下载');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_GLB_BYTES) throw new Error('GLB 超过 256MB 上限');
        chunks.push(value as Uint8Array<ArrayBuffer>);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    data = await new Blob(chunks).arrayBuffer();
  } else {
    if (input.size > MAX_GLB_BYTES) throw new Error('GLB 超过 256MB 上限');
    data = await input.arrayBuffer();
  }
  signal.throwIfAborted();
  inspectGlb(data);
  return data;
}

/** CPU resources may originate on the page; only clones are uploaded/disposed here. */
export class IndependentRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly target = new THREE.Vector3();
  private startOffset = new THREE.Vector3();
  private startQuaternion = new THREE.Quaternion();
  private owned = new Set<{ dispose(): void }>();
  private images = new Set<ImageBitmap>();
  private meshes: { mesh: THREE.Mesh; pbr: THREE.Material | THREE.Material[];
    solid: THREE.Material | THREE.Material[]; normal: THREE.Material | THREE.Material[] }[] = [];
  private wires: THREE.Mesh[] = [];
  private disposed = false;

  constructor(readonly size: number, readonly config: Settings) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    // Three normally logs shader compile failures and continues with blank output.
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      console.error('[Tripo Rotation] 离屏着色器编译失败', {
        program: gl.getProgramInfoLog(program), vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment),
      });
      throw new Error('自定义着色器在离屏上下文编译失败，可能依赖网页专属的着色器扩展');
    };
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = config.lightingExposure;
    this.renderer.setClearColor(0x24262b, config.transparentOutput ? 0 : 1);
  }

  private own<T extends { dispose(): void }>(value: T): T { this.owned.add(value); return value; }

  async load(input: File | string, signal: AbortSignal): Promise<void> {
    const data = await readGlb(input, signal);
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      if (!/^(blob:|data:)/i.test(url)) throw new Error('GLB 包含外部依赖，请先内嵌全部资源');
      return url;
    });
    const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(data, '');
    // Take ownership before checking cancellation, so decoded resources always get cleaned up.
    for (const scene of gltf.scenes) scene.traverse((node: any) => {
      if (node.geometry) this.own(node.geometry);
      if (node.skeleton) this.own(node.skeleton);
      if (node.isInstancedMesh) this.own(node);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!material) continue;
        this.own(material);
        for (const value of Object.values(material) as any[]) if (value?.isTexture) {
          this.own(value);
          if (typeof ImageBitmap !== 'undefined' && value.image instanceof ImageBitmap) this.images.add(value.image);
        }
      }
    });
    signal.throwIfAborted();
    this.scene.add(gltf.scene);
    this.configureMeshes();
    this.fitCamera();
    this.studio();
  }

  snapshot(binding: any, target: number[]): void {
    const scene = nativeObject(binding?.scene);
    const camera = nativeObject(binding?.camera);
    if (!camera?.isCamera || !binding?.renderer) throw new Error('当前模型相机或渲染器尚未就绪');
    const root = copyPageScene(scene, value => this.own(value));
    copyPageResources(root, camera, value => this.own(value));
    // A separate Scene owns the environment/background; the source scene is never mutated.
    root.background = null;
    root.environment = null;
    this.scene.add(root);
    // Page PMREM textures can exist only on its GPU context; regenerate our own environment.
    // Copying their Texture wrappers would produce an uninitialized texture in this context.
    this.renderer.toneMapping = binding.renderer.toneMapping;
    this.renderer.toneMappingExposure = binding.renderer.toneMappingExposure;
    this.camera = camera.isPerspectiveCamera ? new THREE.PerspectiveCamera() : new THREE.OrthographicCamera();
    this.camera.copy(camera, false);
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.camera.position);
    camera.getWorldQuaternion(this.camera.quaternion);
    if (this.camera instanceof THREE.PerspectiveCamera) this.camera.aspect = 1;
    else {
      const halfHeight = (this.camera.top - this.camera.bottom) / 2;
      const center = (this.camera.left + this.camera.right) / 2;
      this.camera.left = center - halfHeight; this.camera.right = center + halfHeight;
    }
    this.camera.updateProjectionMatrix();
    this.target.fromArray(target);
    this.startOffset.copy(this.camera.position).sub(this.target);
    this.startQuaternion.copy(this.camera.quaternion);
    this.configureMeshes();
    this.studio();
  }

  private configureMeshes(): void {
    const nodes: THREE.Mesh[] = [];
    this.scene.traverseVisible((node: any) => {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (node.isMesh && (!this.camera || node.layers.test(this.camera.layers)) && materials.some(m => m?.visible)) nodes.push(node);
    });
    for (const mesh of nodes) {
      const pbr = mesh.material;
      const variant = (material: THREE.Material, normal: boolean) => {
        const original = material as THREE.MeshStandardMaterial;
        const output = normal ? new THREE.MeshNormalMaterial() : new THREE.MeshStandardMaterial({
          color: this.config.brightSolid ? 0xffffff : 0xd9d9d9, roughness: 0.8, metalness: 0,
        });
        output.visible = original.visible;
        output.side = original.side;
        output.flatShading = original.flatShading;
        // Retain silhouette cutouts but not the PBR normal map: this pass shows geometric normals.
        output.alphaTest = original.alphaTest;
        if (!normal) {
          (output as THREE.MeshStandardMaterial).alphaMap = original.alphaMap;
        }
        return this.own(output);
      };
      const map = (normal: boolean) => Array.isArray(pbr) ? pbr.map(m => variant(m, normal)) : variant(pbr, normal);
      this.meshes.push({ mesh, pbr, solid: map(false), normal: map(true) });
      if (this.config.batchWireframeVariants) {
        const wireVariant = (original: THREE.Material) => this.own(new THREE.MeshBasicMaterial({ color: this.config.wireframeColor,
          visible: original.visible, side: original.side,
          wireframe: true, transparent: true, opacity: this.config.wireframeOpacity,
          depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
        const wireMaterial = Array.isArray(pbr) ? pbr.map(wireVariant) : wireVariant(pbr);
        // A shallow clone retains skinning/morph/instancing behavior and shares owned geometry.
        const wire = mesh.clone(false);
        wire.position.set(0, 0, 0); wire.quaternion.identity(); wire.scale.set(1, 1, 1);
        wire.matrix.identity(); wire.matrixAutoUpdate = true;
        wire.material = wireMaterial; wire.visible = false;
        if ((wire as any).isInstancedMesh) this.own(wire as any);
        mesh.add(wire); this.wires.push(wire);
      }
    }
    if (!nodes.length) throw new Error('模型中没有可渲染的网格');
  }

  private fitCamera(): void {
    this.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.scene);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) throw new Error('模型尺寸无效');
    this.target.copy(sphere.center);
    const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(35 / 2)) * 1.12;
    this.camera = new THREE.PerspectiveCamera(35, 1, Math.max(sphere.radius / 1000, 0.00001), distance + sphere.radius * 10);
    this.startOffset.set(0, sphere.radius * 0.15, distance);
    this.camera.position.copy(this.startOffset).add(this.target);
    this.camera.lookAt(this.target);
    this.startQuaternion.copy(this.camera.quaternion);
    this.pose(0);
  }

  private studio(): void {
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(this.renderer);
    try {
      this.scene.environment = this.own(generator.fromScene(room, 0.04)).texture;
      this.scene.environmentIntensity = this.config.lightingEnvironment;
    } finally { room.dispose(); generator.dispose(); }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x646779, this.config.lightingDirect));
  }

  pose(angle: number): void {
    this.camera.position.copy(this.startOffset).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(this.target);
    this.camera.quaternion.copy(this.startQuaternion).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
    this.camera.updateMatrixWorld(true);
  }

  render(material: MaterialId, wireframe: boolean): HTMLCanvasElement {
    if (this.disposed || this.renderer.getContext().isContextLost()) throw new Error('离屏 WebGL 上下文已丢失，请降低分辨率重试');
    for (const entry of this.meshes) entry.mesh.material = entry[material];
    for (const wire of this.wires) wire.visible = wireframe;
    try { this.renderer.render(this.scene, this.camera); }
    catch (error) { throw new Error('离屏画面渲染失败：' + error.message, { cause: error }); }
    return this.renderer.domElement;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const resource of this.owned) resource.dispose();
    for (const image of this.images) image.close();
    this.owned.clear(); this.images.clear(); this.meshes.length = 0; this.wires.length = 0;
    this.scene.clear(); this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}
