/** Discover only Vue-owned graph edges; never scan window, assets or WebGL internals. */
export function unref(value: any): any {
  return value?.__v_isRef ? value.value : value;
}

export function activeCamera(context: any): any {
  return unref(unref(context?.camera)?.activeCamera);
}

export interface EntryDiagnostics {
  visited: number;
  vueRoots: number;
  contexts: number;
  matchingCanvas: number;
  searchLimited: boolean;
  missing: string[];
}

export class FrameEntryError extends Error {
  constructor(readonly diagnostics: EntryDiagnostics) {
    const reason = diagnostics.vueRoots === 0
      ? '当前画布未暴露 Vue 入口，请等待模型加载完成；若仍失败，请检查脚本是否在页面环境运行'
      : diagnostics.matchingCanvas === 0
        ? '未找到与当前画布关联的 Tres 渲染上下文，页面入口可能已变更'
        : `已找到当前画布的渲染器，但缺少：${diagnostics.missing.join('、')}`;
    super(`${reason}${diagnostics.searchLimited ? '（入口搜索已达上限）' : ''}。已停止逐帧录制；控制台包含入口诊断`);
    this.name = 'FrameEntryError';
  }
}

const CONTROL_METHODS = ['rotateTo', 'getSpherical', 'getPosition', 'getTarget',
  'getFocalOffset', 'setLookAt', 'setFocalOffset', 'zoomTo', 'update', 'stop'];
const MAX_VISITS = 30000;

export function resolveRenderContext(canvas: any) {
  const diagnostics: EntryDiagnostics = {
    visited: 0, vueRoots: 0, contexts: 0, matchingCanvas: 0, searchLimited: false, missing: [],
  };
  const queue: any[] = [];
  const queued = new Set<any>();
  const bagSeen = new Set<any>();
  // Bound enqueuing as well as traversal, including Vue provides prototype chains.
  let edges = 0;
  const push = (value: any) => {
    if (++edges > MAX_VISITS * 10) { diagnostics.searchLimited = true; return; }
    try { value = unref(value); } catch { return; }
    if (!value || typeof value !== 'object' || queued.has(value)) return;
    if (queue.length >= MAX_VISITS) { diagnostics.searchLimited = true; return; }
    queued.add(value);
    queue.push(value);
  };
  const read = (value: any, key: PropertyKey) => {
    try { return value?.[key]; } catch { return undefined; }
  };
  const addBag = (bag: any, inherited = false) => {
    try {
      for (let depth = 0; bag && bag !== Object.prototype && depth < 100; depth += 1) {
        if (bagSeen.has(bag)) break;
        bagSeen.add(bag);
        for (const key of Reflect.ownKeys(bag)) {
          push(read(bag, key));
          if (edges > MAX_VISITS * 10) break;
        }
        if (!inherited || edges > MAX_VISITS * 10) break;
        bag = Object.getPrototypeOf(bag);
        if (depth === 99 && bag && bag !== Object.prototype) diagnostics.searchLimited = true;
      }
    } catch { /* stale Vue proxy */ }
  };
  const elements = new Set();
  for (let element = canvas; element && !elements.has(element); element = element.parentElement) {
    elements.add(element);
    // In production Vue, app._instance and DOM __vueParentComponent may be absent.
    // The mounted container's _vnode still links to the component tree.
    const app = read(element, '__vue_app__');
    for (const root of [read(element, '__vueParentComponent'), read(element, '_vnode'),
      read(app, '_instance')]) {
      if (root) { diagnostics.vueRoots += 1; push(root); }
    }
    const provides = read(read(app, '_context'), 'provides');
    if (provides) { diagnostics.vueRoots += 1; addBag(provides, true); }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const value = queue[index];
    diagnostics.visited += 1;
    try {
      const manager = unref(value.renderer);
      const renderer = unref(manager?.instance);
      if (renderer?.domElement) diagnostics.contexts += 1;
      if (renderer?.domElement === canvas) {
        diagnostics.matchingCanvas += 1;
        const scene = unref(value.scene);
        const camera = activeCamera(value);
        const controls = unref(value.controls);
        const missing: string[] = [];
        if (!scene?.isScene) missing.push('场景');
        if (!camera?.isCamera) missing.push('活动相机');
        if (!controls || controls.camera !== camera || !camera) missing.push('绑定活动相机的控制器');
        for (const method of CONTROL_METHODS) {
          if (typeof controls?.[method] !== 'function') missing.push(`controls.${method}`);
        }
        if (typeof renderer.render !== 'function') missing.push('renderer.render');
        if (typeof manager.onRender !== 'function') missing.push('渲染完成回调');
        if (typeof manager.loop?.onBeforeLoop !== 'function') missing.push('渲染前回调');
        if (typeof manager.invalidate !== 'function') missing.push('重绘入口');
        if (manager.mode === 'manual' && typeof manager.advance !== 'function') missing.push('手动重绘入口');
        if (!missing.length) return { context: value, manager, renderer, scene, camera, controls, canvas };
        if (!diagnostics.missing.length || missing.length < diagnostics.missing.length) diagnostics.missing = missing;
        // An incomplete candidate can still expose the live context below it.
      }
    } catch { /* A rejected candidate must not hide its other Vue edges. */ }
    if (Array.isArray(value)) {
      for (const child of value) {
        push(child);
        if (edges > MAX_VISITS * 10) break;
      }
      continue;
    }
    for (const key of ['component', 'subTree', 'parent', 'exposed', 'context', 'ctx', 'setupState', 'refs']) {
      push(read(value, key));
    }
    const children = read(value, 'children');
    if (Array.isArray(children)) push(children);
    push(read(read(value, 'suspense'), 'activeBranch'));
    for (const key of ['exposed', 'setupState', 'refs']) addBag(read(value, key));
    // Vue uses Object.create(parent.provides); injection symbols can be inherited.
    addBag(read(value, 'provides'), true);
  }
  throw new FrameEntryError(diagnostics);
}
