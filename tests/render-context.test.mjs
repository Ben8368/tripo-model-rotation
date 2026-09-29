import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

for (const minify of [false, true]) {
  const result = await build({ entryPoints: ['src/rotation/render-context.ts'], bundle: true,
    write: false, minify, format: 'esm', target: ['chrome109'] });
  const { resolveRenderContext, FrameEntryError, activeCamera, controlsCamera, nativeObject } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const variant = minify ? 'minified' : 'unminified';
  const ref = value => ({ __v_isRef: true, value });
  function fixture() {
    const canvas = { parentElement: null };
    const camera = { isCamera: true };
    const controls = { camera };
    for (const name of ['rotateTo','getSpherical','getPosition','getTarget','getFocalOffset',
      'setLookAt','setFocalOffset','zoomTo','update','stop']) controls[name] = () => {};
    const manager = { instance: ref({ domElement: canvas, render() {} }), invalidate() {},
      onRender() {}, loop: { onBeforeLoop() {} }, mode: 'always' };
    const context = { renderer: ref(manager), scene: ref({ isScene: true }),
      camera: { activeCamera: ref(camera) }, controls: ref(controls) };
    return { canvas, camera, controls, manager, context };
  }
  test(`${variant}: finds production container vnode across nested fragment arrays`, () => {
    const f = fixture();
    f.canvas.parentElement = { __vue_app__: { _instance: null }, _vnode: {
      component: { subTree: { children: [[{ component: { provides: { [Symbol()]: f.context } } }]] } },
    } };
    assert.equal(resolveRenderContext(f.canvas).context, f.context);
  });
  test(`${variant}: resolves inherited symbol injection and ref camera manager`, () => {
    const f = fixture();
    const provider = { [Symbol('TresContext')]: ref(f.context) };
    const provides = Object.create(Object.create(provider));
    f.canvas.__vueParentComponent = { provides };
    f.context.camera = ref(f.context.camera);
    assert.equal(resolveRenderContext(f.canvas).camera, f.camera);
    assert.equal(activeCamera(f.context), f.camera);
    const replacement = { isCamera: true };
    f.context.camera.value.activeCamera.value = replacement;
    assert.equal(activeCamera(f.context), replacement);
  });
  test(`${variant}: follows an incomplete candidate to a complete exposed context`, () => {
    const f = fixture();
    const stale = { ...f.context, controls: null, exposed: { live: f.context } };
    f.canvas.__vueParentComponent = { provides: { [Symbol()]: stale } };
    assert.equal(resolveRenderContext(f.canvas).controls, f.controls);
  });
  test(`${variant}: handles throwing getters, graph cycles and unrelated renderer safely`, () => {
    const f = fixture(); const other = fixture();
    const bag = { other: other.context, live: ref(f.context) };
    Object.defineProperty(bag, 'broken', { get() { throw Error('unmounted'); } });
    const component = { provides: bag }; component.parent = component;
    f.canvas.__vueParentComponent = component;
    Object.defineProperty(f.context, 'assets', { get() { throw Error('must not read assets'); } });
    assert.equal(resolveRenderContext(f.canvas).renderer.domElement, f.canvas);
  });
  test(`${variant}: rejects mismatched camera and missing native frame hooks with diagnostics`, () => {
    const f = fixture();
    f.canvas.__vueParentComponent = { provides: { ctx: f.context } };
    f.controls.camera = { isCamera: true };
    delete f.manager.onRender;
    assert.throws(() => resolveRenderContext(f.canvas), error => {
      assert(error instanceof FrameEntryError);
      assert.equal(error.diagnostics.matchingCanvas, 1);
      assert.equal(error.diagnostics.cameraBinding, 'different-camera');
      assert(error.diagnostics.missing.includes('渲染完成回调'));
      assert(!error.message.includes('请点击'));
      return true;
    });
  });
  test(`${variant}: validates every recording operation and manual rendering`, () => {
    const f = fixture(); f.canvas.__vueParentComponent = { context: f.context };
    f.manager.mode = 'manual'; delete f.controls.setLookAt;
    assert.throws(() => resolveRenderContext(f.canvas), error => {
      assert(error.diagnostics.missing.includes('controls.setLookAt'));
      assert(error.diagnostics.missing.includes('手动重绘入口'));
      return true;
    });
  });
  test(`${variant}: distinguishes unavailable Vue roots from a different canvas`, () => {
    const f = fixture();
    assert.throws(() => resolveRenderContext(f.canvas), error => {
      assert.equal(error.diagnostics.vueRoots, 0); return true;
    });
    f.canvas.__vueParentComponent = { provides: { context: fixture().context } };
    assert.throws(() => resolveRenderContext(f.canvas), error => {
      assert.equal(error.diagnostics.contexts, 1);
      assert.equal(error.diagnostics.matchingCanvas, 0); return true;
    });
  });
  const proxy = target => new Proxy(target, {
    get(target, key, receiver) { return key === '__v_raw' ? target : Reflect.get(target, key, receiver); },
  });
  test(`${variant}: proxy and raw camera resolve to the same native instance`, () => {
    for (const wrapControls of [false, true]) {
      const f = fixture();
      const rawControls = f.controls;
      f.context.camera.activeCamera = ref(proxy(proxy(f.camera)));
      f.controls.camera = ref(proxy(f.camera));
      f.context.controls = ref(wrapControls ? proxy(rawControls) : rawControls);
      f.context.scene = ref(proxy(f.context.scene.value));
      f.manager.instance = ref(proxy(f.manager.instance.value));
      f.canvas.__vueParentComponent = { context: f.context };
      const binding = resolveRenderContext(f.canvas);
      assert.equal(binding.camera, f.camera);
      assert.equal(binding.controls, rawControls);
      assert.equal(controlsCamera(binding.controls), f.camera);
      assert.equal(nativeObject(binding.scene), binding.scene);
      assert.equal(nativeObject(binding.renderer), binding.renderer);
    }
  });
  test(`${variant}: uses camera-controls backing field only without a public camera`, () => {
    const f = fixture();
    f.controls._camera = proxy(f.camera);
    delete f.controls.camera;
    f.canvas.__vueParentComponent = { context: f.context };
    assert.equal(resolveRenderContext(f.canvas).camera, f.camera);
    f.controls.camera = { isCamera: true };
    assert.throws(() => resolveRenderContext(f.canvas), error => {
      assert.equal(error.diagnostics.cameraBinding, 'different-camera');
      assert.equal(error.diagnostics.cameraAccessor, 'camera'); return true;
    });
  });
  test(`${variant}: different cameras remain rejected even with identical UUID and matrices`, () => {
    const f = fixture(); f.camera.uuid = 'same'; f.camera.matrixWorld = { elements: [1] };
    f.controls.camera = proxy({ ...f.camera });
    f.context.camera.activeCamera = ref(proxy(f.camera));
    f.canvas.__vueParentComponent = { context: f.context };
    assert.throws(() => resolveRenderContext(f.canvas), error => {
      assert.equal(error.diagnostics.cameraBinding, 'different-camera'); return true;
    });
  });
  test(`${variant}: reports unreadable controller camera and bounds malformed proxy chains`, () => {
    const f = fixture(); delete f.controls.camera;
    f.canvas.__vueParentComponent = { context: f.context };
    assert.throws(() => resolveRenderContext(f.canvas), error => {
      assert.equal(error.diagnostics.cameraBinding, 'missing');
      assert.equal(error.diagnostics.cameraAccessor, 'none'); return true;
    });
    const cycle = {}; cycle.__v_raw = cycle;
    assert.equal(nativeObject(cycle), undefined);
  });
  test(`${variant}: bounds cyclic and oversized injection graphs`, () => {
    const f = fixture(); let node = {};
    f.canvas.__vueParentComponent = node;
    for (let i = 0; i < 31000; i++) { node.parent = {}; node = node.parent; }
    assert.throws(() => resolveRenderContext(f.canvas), error => {
      assert.equal(error.diagnostics.searchLimited, true);
      assert.equal(error.diagnostics.visited, 30000); return true;
    });
  });
}
