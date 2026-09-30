import { groupOffscreenJobs, renderFrameBatch, glbUrl } from './offscreen/plan';
import { mountAuthControls } from './auth/controls';
import * as Mp4Muxer from 'mp4-muxer';
import { DEFAULT_SETTINGS as DEFAULTS, normalizeSettings } from './settings/settings';
import { MATERIALS, EXPORT_KINDS, EXPORT_ITEMS } from './settings/catalog';
import { makeFramePlan, transitionProgress } from './rotation/frame-plan';
import { resolveRenderContext, activeCamera, controlsCamera, nativeObject, unref, FrameEntryError } from './rotation/render-context';
import { clamp } from './utils/numbers';
import { safeFilenamePart, formatOutputFilename } from './utils/filename';
import { validProjectUrl } from './projects/project-url';
import type { Settings } from './types/settings';
import { planBatchJobs, selectedBatchItems } from './batch/plan';
import { createProjectStorage, projectNameFor, rememberProject } from './storage/project-library';
import { createMultiProjectSession, flattenRestorePoints, parseMultiProjectSession,
  parseRestorePoints, parseSelectedAssets, planMultiProjectJobs, restorePointsForWrite,
  preserveCheckboxState, cancelMultiProjectSession, completeMultiProjectSession,
  runRestoreTransaction } from './batch/multi-project';
import type { ExportRestorePoint, MultiProjectBatchSession, SelectedProjectAsset } from './types/settings';

/** @param {string} version */
export function startApp(version) {
  'use strict';

  const SCRIPT_VERSION = version;

  const SCRIPT_ID = 'tripo-rotation-assistant';
  const STORAGE_KEY = `${SCRIPT_ID}:settings:v1`;
  const PROJECT_NAMES_KEY = `${SCRIPT_ID}:project-names:v1`;
  const PROJECT_LIBRARY_KEY = `${SCRIPT_ID}:project-library:v1`;
  const RESTORE_POINTS_KEY = `${SCRIPT_ID}:export-restore-points:v1`;
  const ASSET_SELECTION_KEY = `${SCRIPT_ID}:asset-selection:v1`;
  const MULTI_BATCH_KEY = `${SCRIPT_ID}:multi-model-batch:v1`;
  const POINTER_ID = 731945;
  const projectStorage = createProjectStorage(readStorage, writeStorage, PROJECT_NAMES_KEY, PROJECT_LIBRARY_KEY);
  let settings: Settings = loadSettings() as Settings;
  let panelVisible = false;
  let visibilityRevision = 0;
  let activeRun = null;
  let canvasStatusTimer = 0;
  let pendingProjectName = null;
  let pendingBatchStart = null;
  let batchRunning = false;
  let exportBusy = false;
  let activeTask = null;
  let pendingSave = null;
  let activeSaves = 0;
  let statusIsSticky = false;
  let lightingSnapshot = null;
  let solidLookSnapshot = null;
  let zoomState = null;
  let zoomDragging = false;
  let wireframeStyleState = null;
  let ui = null;
  let multiBatchResumeStarted = false;
  let multiBatchNavigating = false;
  const cleanedMultiBatchIds = new Set<string>();

  function loadRestorePoints(): Record<string, ExportRestorePoint[]> {
    return parseRestorePoints(readStorage(RESTORE_POINTS_KEY));
  }

  function saveRestorePoints(store: Record<string, ExportRestorePoint[]>): boolean {
    return writeStorage(RESTORE_POINTS_KEY, JSON.stringify(store));
  }

  function loadRestorePointsForWrite(): Record<string, ExportRestorePoint[]> {
    return restorePointsForWrite(readStorage(RESTORE_POINTS_KEY));
  }

  function loadSelectedAssets(): SelectedProjectAsset[] {
    return parseSelectedAssets(readStorage(ASSET_SELECTION_KEY));
  }

  function saveSelectedAssets(assets: readonly SelectedProjectAsset[]): boolean {
    return writeStorage(ASSET_SELECTION_KEY, JSON.stringify(assets));
  }

  function loadMultiBatchSession(): MultiProjectBatchSession | null {
    const raw = readStorage(MULTI_BATCH_KEY);
    if (!raw?.trim()) return null;
    const session = parseMultiProjectSession(raw);
    if (!session) throw new Error('跨工程批量任务数据无效；为避免错误续跑，已停止任务');
    return session;
  }

  function saveMultiBatchSession(session: MultiProjectBatchSession | null): boolean {
    if (!session) {
      try { localStorage.removeItem(MULTI_BATCH_KEY); return true; } catch { return false; }
    }
    return writeStorage(MULTI_BATCH_KEY, JSON.stringify(session));
  }

  function persistMultiBatchSession(session: MultiProjectBatchSession | null): void {
    if (!saveMultiBatchSession(session)) throw new Error('跨工程批量状态无法保存');
  }

  function recordExportRestorePoint(kind: ExportRestorePoint['kind'], itemCount = 1): ExportRestorePoint | null {
      const canvas = findViewerCanvas() as HTMLCanvasElement | null;
      if (!canvas) throw new Error('无法记录还原点：模型画面尚未加载');
      const binding = findRenderContext(canvas);
      const view = snapshotView(binding);
      bindZoomSlider();
      const metric = zoomState?.canvas === canvas ? zoomMetric(zoomState) : null;
      const slider = Number.isFinite(metric) && metric > 0 ? {
        mode: zoomState.mode, baseline: zoomState.baseline,
        percent: (zoomState.mode === 'dolly' ? zoomState.baseline / metric : metric / zoomState.baseline) * 100,
        metric,
      } : null;
      const point: ExportRestorePoint = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        projectId: currentProjectId(), url: validProjectUrl(location.href, currentProjectId()) || location.href,
        projectName: getProjectName(), createdAt: new Date().toISOString(), kind, itemCount,
        cameraType: binding.camera.type, canvasCssSize: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height],
        view: view as unknown as Record<string, unknown>, slider, settings: structuredClone(settings),
      };
      const store = loadRestorePointsForWrite();
      store[point.projectId] = [point, ...(store[point.projectId] || [])].slice(0, 20);
      if (!saveRestorePoints(store)) throw new Error('还原点无法保存；已停止导出');
      renderRestorePoints();
      return point;
  }

  function recordManualRestorePoint(): void {
    if (projectSwitchBlocked()) { setStatus('导出进行中，不能记录还原点', 'warning'); return; }
    try {
      sanitizeSettingsFromUI();
      recordExportRestorePoint('manual');
      setStatus('已记录当前工程的导出还原点', 'ready', true);
    } catch (error) { setStatus(`记录导出还原点失败：${error.message}`, 'error'); }
  }

  function renderRestorePoints() {
    if (!ui?.restorePointList || typeof ui.restorePointList.replaceChildren !== 'function') return;
    const points = loadRestorePoints()[currentProjectId()] || [];
    ui.restorePointCount.textContent = `${points.length} 个`;
    ui.restorePointList.replaceChildren();
    for (const point of points) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'restore-point';
      const date = new Date(point.createdAt);
      button.textContent = `${Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '未知时间'} · ${point.kind}`;
      button.title = '点击还原当时的相机视角与导出设置';
      button.addEventListener('click', () => restoreExportPoint(point.id));
      ui.restorePointList.appendChild(button);
    }
    if (!points.length) {
      const empty = document.createElement('p'); empty.className = 'note'; empty.textContent = '暂无记录；下一次导出会自动创建。';
      ui.restorePointList.appendChild(empty);
    }
  }

  function restoreExportPoint(id: string): boolean {
    if (projectSwitchBlocked()) return false;
    let point: ExportRestorePoint;
    try { point = (loadRestorePoints()[currentProjectId()] || []).find(item => item.id === id); }
    catch (error) { setStatus(`读取还原点失败：${error.message}`, 'error'); return false; }
    if (!point) { setStatus('还原点不属于当前工程或记录已损坏', 'error'); return false; }
    let binding: any = null;
    let previousView: any = null;
    let previousStoredSettings: string | null = null;
    const previousSettings = settings;
    let settingsWritten = false;
    try {
      const canvas = findViewerCanvas() as HTMLCanvasElement | null;
      if (!canvas) throw new Error('模型画面尚未加载');
      previousStoredSettings = localStorage.getItem(STORAGE_KEY);
      binding = findRenderContext(canvas);
      previousView = snapshotView(binding);
      if (currentProjectId() !== point.projectId) throw new Error('工程编号已变化，无法还原');
      if (binding.camera.type !== point.cameraType) throw new Error('相机类型已变化，无法精确还原');
      if (canvas.width !== (point.view as any).width || canvas.height !== (point.view as any).height)
        throw new Error(`画布尺寸不同：记录为 ${(point.view as any).width}×${(point.view as any).height}，当前为 ${canvas.width}×${canvas.height}`);
      const rect = canvas.getBoundingClientRect();
      if (point.canvasCssSize && (Math.abs(rect.width - point.canvasCssSize[0]) > 0.5 || Math.abs(rect.height - point.canvasCssSize[1]) > 0.5))
        throw new Error('模型画面在页面中的尺寸已变化，无法保证完全对齐');
      binding.controls.stop?.();
      const signature = applyView(binding, point.view as any);
      assertSignature(signature, (point.view as any).signature, '还原点相机矩阵');
      const restored = normalizeSettings(point.settings);
      if (!restored || typeof restored !== 'object' || !Number.isFinite(restored.configVersion)) throw new Error('还原点设置无效');
      if (!point.settings || typeof point.settings !== 'object' || Array.isArray(point.settings) ||
          Object.keys(point.settings).some(key => key in DEFAULTS && typeof point.settings[key] !== typeof DEFAULTS[key]) ||
          !Array.isArray(point.settings.batchItems) || point.settings.batchItems.some(key => !EXPORT_ITEMS.some(item => item.key === key)))
        throw new Error('还原点设置无效');
      settings = restored;
      settingsWritten = true;
      if (!saveSettings()) throw new Error('设置无法保存');
      syncUI(); syncBatchSelection(); applyLightingPreset(); applySolidLook(); bindWireframeStyle();
      bindZoomSlider();
      if (zoomState?.canvas === canvas && point.slider?.mode === zoomState.mode &&
          Number.isFinite(point.slider.baseline) && point.slider.baseline > 0) {
        zoomState.baseline = point.slider.baseline;
        syncZoomSlider();
      }
      binding.manager.invalidate();
      setStatus('已精确还原导出视角与设置', 'ready', true);
      return true;
    } catch (error) {
      try {
        runRestoreTransaction(() => { throw error; }, () => {
          if (binding && previousView) {
            try {
              const signature = applyView(binding, previousView);
              assertSignature(signature, previousView.signature, '回滚相机矩阵');
              binding.manager.invalidate();
            } catch (rollbackError) { console.error('[Tripo Rotation] 还原失败且相机回滚失败', rollbackError); }
          }
          settings = previousSettings;
          if (settingsWritten) {
            try {
              if (previousStoredSettings === null) localStorage.removeItem(STORAGE_KEY);
              else localStorage.setItem(STORAGE_KEY, previousStoredSettings);
            } catch (rollbackError) { console.error('[Tripo Rotation] 还原失败且本地设置回滚失败', rollbackError); }
          }
          try { syncUI(); syncBatchSelection(); applyLightingPreset(); applySolidLook(); bindWireframeStyle(); syncZoomSlider(); }
          catch (rollbackError) { console.error('[Tripo Rotation] 还原失败且界面/画面回滚失败', rollbackError); }
        }, rollbackError => console.error('[Tripo Rotation] 还原失败且回滚失败', rollbackError));
      } catch (originalError) { setStatus(`还原失败：${originalError.message}`, 'error'); return false; }
      return false;
    }
  }

  function assetCards() {
    return [...document.querySelectorAll('a[href*="/workspace/generate/"]')]
      .map(link => link as HTMLAnchorElement)
      .filter(link => link.querySelector('img') && validProjectUrl(link.href, projectIdFromUrl(link.href)));
  }

  function projectIdFromUrl(value: string): string | null {
    try { return new URL(value, location.href).pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)?.[1] || null; }
    catch { return null; }
  }

  function injectAssetCheckboxes() {
    const selected = new Map(loadSelectedAssets().map(asset => [asset.projectId, asset]));
    for (const link of assetCards()) {
      const projectId = projectIdFromUrl(link.href); if (!projectId) continue;
      let checkbox = link.querySelector('input.tripo-batch-asset-check') as HTMLInputElement | null;
      if (!checkbox) {
        checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'tripo-batch-asset-check';
        checkbox.title = '加入多个项目批量导出'; checkbox.setAttribute('aria-label', '加入多个项目批量导出');
        checkbox.style.cssText = 'position:absolute;left:6px;top:6px;z-index:20;width:18px;height:18px;accent-color:#765cff;';
        checkbox.addEventListener('pointerdown', event => event.stopPropagation());
        checkbox.addEventListener('click', event => {
          const checked = checkbox.checked;
          event.preventDefault(); event.stopPropagation();
          window.setTimeout(() => preserveCheckboxState(checked, intended => {
            checkbox.checked = intended;
            const assets = loadSelectedAssets().filter(asset => asset.projectId !== projectId);
            if (intended) assets.push({ projectId, url: validProjectUrl(link.href, projectId)!, label: link.querySelector('img')?.alt || undefined });
            saveSelectedAssets(assets); renderMultiBatchStatus();
          }), 0);
        });
        link.style.position ||= 'relative'; link.appendChild(checkbox);
      }
      checkbox.checked = selected.has(projectId);
    }
  }

  function renderMultiBatchStatus() {
    if (!ui?.multiBatchStatus) return;
    let session: MultiProjectBatchSession | null;
    try { session = loadMultiBatchSession(); }
    catch (error) {
      ui.multiBatchStatus.textContent = error.message;
      if (ui.multiBatchStart) { ui.multiBatchStart.textContent = '多个项目批量导出'; ui.multiBatchStart.disabled = true; }
      if (ui.multiBatchCancel) ui.multiBatchCancel.hidden = true;
      return;
    }
    const assets = loadSelectedAssets();
    ui.multiBatchStatus.textContent = session ? `批量任务${session.status === 'running' ? '进行中' : session.status === 'paused' ? '已暂停' : '已取消'} · 第 ${session.pointIndex}/${session.points.length} 个项目 · 已保存 ${session.completedFiles} 个文件` : `已选择 ${assets.length} 个项目`;
    if (ui.multiBatchStart) ui.multiBatchStart.textContent = session ? '继续批量导出' : '多个项目批量导出';
    if (ui.multiBatchStart) ui.multiBatchStart.disabled = Boolean(session && session.status === 'running');
    if (ui.multiBatchCancel) ui.multiBatchCancel.hidden = !session || session.status === 'cancelled';
  }

  function openMultiBatchDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('当前浏览器不支持断点续跑存储')); return; }
      const request = indexedDB.open(`${SCRIPT_ID}-handles-v1`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('handles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开文件夹存储'));
    });
  }

  async function storeMultiBatchDirectory(id: string, handle?: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | undefined> {
    const db = await openMultiBatchDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('handles', handle ? 'readwrite' : 'readonly');
        const request = handle ? transaction.objectStore('handles').put(handle, id) : transaction.objectStore('handles').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('文件夹句柄读写失败'));
      });
    } finally { db.close(); }
  }

  async function removeMultiBatchDirectory(id: string): Promise<void> {
    if (cleanedMultiBatchIds.has(id)) return;
    cleanedMultiBatchIds.add(id);
    try {
      const db = await openMultiBatchDb();
      try { await new Promise<void>((resolve, reject) => {
        const request = db.transaction('handles', 'readwrite').objectStore('handles').delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('文件夹句柄清理失败'));
      }); } finally { db.close(); }
    } catch (error) { cleanedMultiBatchIds.delete(id); throw error; }
  }

  async function waitForProjectView(point: ExportRestorePoint, sessionId: string): Promise<any> {
    const deadline = Date.now() + 90_000;
    let pending = '等待模型画面';
    let layoutKey = '';
    let stableSince = 0;
    let wrongSizeSince = 0;
    const report = message => setStatus(`跨工程 ${point.projectId.slice(0, 8)} · ${message}`, 'running');
    while (Date.now() < deadline) {
      const session = loadMultiBatchSession();
      if (!session || session.id !== sessionId || session.status !== 'running') throw new Error('跨工程批量任务已取消');
      if (currentProjectId() !== point.projectId) {
        pending = '等待目标工程'; report(pending); await sleep(250, null); continue;
      }
      const canvas = findViewerCanvas() as HTMLCanvasElement | null;
      if (!canvas) { pending = '等待模型画面'; report(pending); await sleep(250, null); continue; }
      let binding;
      try { binding = findRenderContext(canvas); }
      catch (error) { pending = `等待渲染器（${error.message}）`; report(pending); await sleep(250, null); continue; }
      if (!MATERIALS.every(material => { const button = findMaterialButton(material.id); return button?.isConnected && !button.disabled; })) {
        pending = '等待模型与材质栏加载'; report(pending); await sleep(250, null); continue;
      }
      const rect = canvas.getBoundingClientRect();
      const key = [canvas.width, canvas.height, rect.width.toFixed(2), rect.height.toFixed(2), binding.camera.type].join(':');
      if (key !== layoutKey) { layoutKey = key; stableSince = Date.now(); wrongSizeSince = 0; }
      const view = point.view as any;
      if (canvas.width !== view.width || canvas.height !== view.height) {
        if (!wrongSizeSince) wrongSizeSince = Date.now();
        pending = `等待页面布局稳定（当前 ${canvas.width}×${canvas.height} → 记录 ${view.width}×${view.height}）`; report(pending);
        if (Date.now() - stableSince >= 8_000 && Date.now() - wrongSizeSince >= 8_000)
          throw new Error(`页面已加载，但画布尺寸不同：记录尺寸 ${view.width}×${view.height}，当前尺寸 ${canvas.width}×${canvas.height}`);
        await sleep(250, null); continue;
      }
      if (binding.camera.type !== point.cameraType) throw new Error(`页面已加载，但相机类型已由 ${point.cameraType} 变为 ${binding.camera.type}`);
      if (point.canvasCssSize && (Math.abs(rect.width - point.canvasCssSize[0]) > 0.5 || Math.abs(rect.height - point.canvasCssSize[1]) > 0.5))
        throw new Error(`页面已加载，但 Canvas CSS 尺寸不同：记录 ${point.canvasCssSize[0].toFixed(1)}×${point.canvasCssSize[1].toFixed(1)}，当前 ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}`);
      if (Date.now() - stableSince < 750) { pending = '画面尺寸已匹配，正在确认稳定'; report(pending); await sleep(150, null); continue; }
      report('页面已加载，正在精确还原视角');
      binding.controls.stop?.();
      const signature = applyView(binding, point.view as any);
      assertSignature(signature, (point.view as any).signature, '批量导出点相机矩阵');
      binding.manager.invalidate();
      await nextRenderedFrame();
      return { canvas, binding, view: point.view };
    }
    throw new Error(`等待页面加载超时：${pending}`);
  }

  async function startMultiProjectBatch() {
    if (batchRunning || activeRun) throw new Error('已有导出任务正在运行');
    sanitizeSettingsFromUI();
    requireCanvasRecording();
    if (typeof window.showDirectoryPicker !== 'function') throw new Error('当前浏览器不支持选择文件夹，请使用新版 Chrome 或 Edge');
    let session = loadMultiBatchSession();
    if (session) {
      const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
      await storeMultiBatchDirectory(session.id, directory);
      session.status = 'running'; session.error = ''; persistMultiBatchSession(session);
    } else {
      const assets = loadSelectedAssets();
      if (!assets.length) throw new Error('请先在资产卡片上勾选要批量导出的模型');
      loadRestorePointsForWrite();
      const allPoints = flattenRestorePoints(loadRestorePoints());
      const points = assets.map(asset => allPoints.find(point => point.projectId === asset.projectId)).filter(Boolean) as ExportRestorePoint[];
      if (points.length !== assets.length) throw new Error('部分模型没有导出还原点，请先逐个打开模型并导出一次');
      const itemKeys = settings.batchItems.length ? [...settings.batchItems] : [];
      if (!itemKeys.length) throw new Error('请先在一键导出菜单中选择文件类型');
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      session = createMultiProjectSession(id, points, itemKeys, settings, settings.batchWireframeVariants);
      const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
      await storeMultiBatchDirectory(id, directory); persistMultiBatchSession(session);
    }
    void continueMultiProjectBatch();
  }

  async function continueMultiProjectBatch() {
    if (multiBatchResumeStarted) return;
    multiBatchResumeStarted = true;
    let session: MultiProjectBatchSession | null;
    try { session = loadMultiBatchSession(); }
    catch (error) { multiBatchResumeStarted = false; setStatus(error.message, 'error'); renderMultiBatchStatus(); return; }
    if (!session || session.status !== 'running') { multiBatchResumeStarted = false; renderMultiBatchStatus(); return; }
    try {
      if (session.pointIndex >= session.points.length) {
        await completeMultiProjectSession(session, () => persistMultiBatchSession(null), removeMultiBatchDirectory);
        setStatus(`跨工程批量导出完成 · 共保存 ${session.completedFiles} 个文件`, 'ready', true);
        renderMultiBatchStatus(); multiBatchResumeStarted = false; return;
      }
      const point = session.points[session.pointIndex];
      const url = validProjectUrl(point.url, point.projectId);
      if (!url) throw new Error('批量任务中的工程网址无效');
      if (currentProjectId() !== point.projectId) {
        multiBatchNavigating = true; location.assign(url); return;
      }
      const directory = await storeMultiBatchDirectory(session.id);
      if (!directory) throw new Error('目标文件夹句柄已丢失，请重新授权');
      if (directory.queryPermission && await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('目标文件夹授权已失效，请点击继续');
      const { canvas, binding, view } = await waitForProjectView(point, session.id);
      settings = normalizeSettings(session.settings); saveSettings(); syncUI();
      const live = loadMultiBatchSession();
      if (!live || live.id !== session.id || live.status !== 'running') throw new Error('跨工程批量任务已取消');
      session = live;
      if (!session.activeJobs) {
        session.activeJobs = planMultiProjectJobs(EXPORT_ITEMS, session.itemKeys, session.includeWireframe && wireframeAvailable());
        session.jobIndex = 0;
        persistMultiBatchSession(session);
      }
      const jobs = session.activeJobs.slice(session.jobIndex).map(job => {
        const item = EXPORT_ITEMS.find(candidate => candidate.key === job.key);
        if (!item) throw new Error('批量文件配置无效');
        return { ...item, wireframe: job.wireframe };
      });
      const task = { cancelled: false, timers: new Map(), frames: new Map(), cleanups: new Set<() => void>() };
      activeTask = task;
      batchRunning = true;
      const checkSession = () => {
        throwIfCancelled(task);
        const current = loadMultiBatchSession();
        if (!current || current.id !== session.id || current.status !== 'running') throw new DOMException('跨工程批量任务已取消', 'AbortError');
        return current;
      };
      try {
        if (jobs.length) await exportIndependent(null, { jobs, config: settings, checkpointOrder: true,
          projectName: point.projectName || ('工程-' + point.projectId.slice(0, 8)),
          outputTarget: { kind: 'directory', handle: directory }, check: checkSession,
          onSaved: () => {
            session = checkSession();
            session.jobIndex += 1; session.completedFiles += 1; persistMultiBatchSession(session);
          },
        });
      } finally {
        if (activeTask === task) activeTask = null;
        batchRunning = false; showPanel(true);
      }
      const afterProject = loadMultiBatchSession();
      if (!afterProject || afterProject.id !== session.id || afterProject.status !== 'running') throw new Error('跨工程批量任务已取消');
      session = afterProject;
      session.pointIndex += 1; session.jobIndex = 0; session.activeJobs = null; persistMultiBatchSession(session);
      if (session.pointIndex >= session.points.length) {
        await completeMultiProjectSession(session, () => persistMultiBatchSession(null), removeMultiBatchDirectory);
        setStatus(`跨工程批量导出完成 · 共保存 ${session.completedFiles} 个文件`, 'ready', true);
        multiBatchResumeStarted = false; renderMultiBatchStatus(); return;
      }
      multiBatchResumeStarted = false; renderMultiBatchStatus(); void continueMultiProjectBatch();
    } catch (error) {
      try { session = loadMultiBatchSession(); }
      catch { session = null; }
      if (!session) {
        batchRunning = false; multiBatchResumeStarted = false; renderMultiBatchStatus();
        return;
      }
      if (session && session.status !== 'cancelled') { session.status = 'paused'; session.error = error.message; saveMultiBatchSession(session); }
      batchRunning = false; multiBatchResumeStarted = false; setStatus(`跨工程批量导出已暂停：${error.message}`, 'error'); renderMultiBatchStatus();
    }
  }

  async function cancelMultiProjectBatch() {
    let session: MultiProjectBatchSession | null;
    try { session = loadMultiBatchSession(); }
    catch (error) { setStatus(error.message, 'error'); renderMultiBatchStatus(); return; }
    if (!session) return;
    try {
      await cancelMultiProjectSession(session,
        cancelled => { saveMultiBatchSession(cancelled); },
        () => { if (activeRun) stopRotation('跨工程批量导出已取消'); },
        () => saveMultiBatchSession(null),
        removeMultiBatchDirectory);
      setStatus('已取消跨工程批量导出；已完成文件保留', 'warning', true);
    } catch (error) { console.error('[Tripo Rotation] 清理已取消批量任务失败', error); setStatus(`已取消任务，但文件夹句柄清理失败：${error.message}`, 'error'); }
    renderMultiBatchStatus();
  }

  // 录制只接受真实 Tres 上下文。没有入口时禁止回退到模拟鼠标。
  function findRenderContext(canvas, diagnose = false) {
    try { return resolveRenderContext(canvas); }
    catch (error) {
      if (diagnose && error instanceof FrameEntryError) {
        // Scalars only: never dump the Vue graph or account state.
        console.warn('[Tripo Rotation] 逐帧入口诊断', { version: SCRIPT_VERSION, ...error.diagnostics });
      }
      throw error;
    }
  }

  function restoreOriginalLighting() {
    const original = lightingSnapshot;
    if (!original) return;
    lightingSnapshot = null;
    original.scene.environmentIntensity = original.environmentIntensity;
    original.renderer.toneMappingExposure = original.toneMappingExposure;
    for (const [light, intensity] of original.lights) light.intensity = intensity;
    original.manager.invalidate();
  }

  function applyLightingPreset(strict = false) {
    if (!settings.studioLighting) {
      restoreOriginalLighting();
      return false;
    }
    const canvas = findViewerCanvas();
    if (!canvas) {
      if (strict) throw new Error('模型尚未加载，无法应用棚拍光照');
      return false;
    }
    let binding;
    try { binding = findRenderContext(canvas); }
    catch (error) { if (strict) throw error; return false; }
    const { scene, renderer, manager } = binding;
    if (lightingSnapshot && (lightingSnapshot.scene !== scene || lightingSnapshot.renderer !== renderer)) {
      restoreOriginalLighting();
    }
    if (!lightingSnapshot) {
      const lights = [];
      scene.traverse(object => {
        if (object.isLight && Number.isFinite(object.intensity)) lights.push([object, object.intensity]);
      });
      lightingSnapshot = { scene, renderer, manager, lights,
        environmentIntensity: scene.environmentIntensity,
        toneMappingExposure: renderer.toneMappingExposure };
    }
    const original = lightingSnapshot;
    let changed = false;
    if (Number.isFinite(original.environmentIntensity)) {
      const value = original.environmentIntensity * settings.lightingEnvironment;
      if (scene.environmentIntensity !== value) { scene.environmentIntensity = value; changed = true; }
    }
    if (Number.isFinite(original.toneMappingExposure)) {
      const value = original.toneMappingExposure * settings.lightingExposure;
      if (renderer.toneMappingExposure !== value) { renderer.toneMappingExposure = value; changed = true; }
    }
    for (const [light, intensity] of original.lights) {
      const value = intensity * settings.lightingDirect;
      if (light.intensity !== value) { light.intensity = value; changed = true; }
    }
    if (changed) manager.invalidate();
    return true;
  }

  function linearToSrgb(value) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  }

  function solidColorAcceptable(material) {
    const color = material.color;
    if (!color || ![color.r, color.g, color.b].every(Number.isFinite)) return true;
    const { r, g, b } = color;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 0.34) return false;
    const darkest = Math.min(r, g, b);
    return Math.max(darkest, linearToSrgb(darkest)) >= 0.28;
  }

  // Three's managed colors may store a pale white surface below 0.65 in linear space.
  function isSolidSurfaceMaterial(material) {
    if (!material || material.wireframe || typeof material.clone !== 'function') return false;
    if (material.userData?.wireframe || material.uniforms?.wireframeColor ||
        material.isLineBasicMaterial || material.isPointsMaterial || material.isSpriteMaterial) return false;
    const known = material.isMeshMatcapMaterial || material.isMeshStandardMaterial ||
      material.isMeshPhysicalMaterial || material.isMeshPhongMaterial ||
      material.isMeshLambertMaterial || material.isMeshToonMaterial || material.isNodeMaterial;
    const custom = material.isShaderMaterial || material.isRawShaderMaterial;
    return Boolean((known || custom) && solidColorAcceptable(material));
  }

  function patchSolidFragment(fragmentShader, strength) {
    if (!fragmentShader || fragmentShader.includes('tripoSolidBase')) return '';
    const lift = target => `vec3 tripoSolidBase = clamp(${target}.rgb, 0.0, 1.0);\n` +
      `${target}.rgb = clamp(tripoSolidBase + ${strength} * tripoSolidBase * (1.0 - tripoSolidBase), 0.0, 1.0);\n`;
    for (const anchor of ['#include <dithering_fragment>', '#include <colorspace_fragment>',
      '#include <encodings_fragment>', '#include <tonemapping_fragment>']) {
      if (fragmentShader.includes(anchor)) return fragmentShader.replace(anchor, `${lift('gl_FragColor')}${anchor}`);
    }
    const output = ['gl_FragColor', 'pc_fragColor', 'fragColor', 'outColor']
      .find(name => new RegExp(`\\b${name}\\b`).test(fragmentShader));
    const close = fragmentShader.lastIndexOf('}');
    return output && close >= 0
      ? `${fragmentShader.slice(0, close)}${lift(output)}${fragmentShader.slice(close)}` : '';
  }

  async function applySolidLookWhenReady(timeoutMs = 6000, restoring = false) {
    if (!settings.brightSolid || currentMaterial().id !== 'solid') {
      try { return applySolidLook(); }
      catch (error) { console.warn('[Tripo Rotation] 还原白膜提亮失败', error); return false; }
    }
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    do {
      if (!restoring) throwIfCancelled();
      try { if (applySolidLook()) return true; lastError = null; }
      catch (error) { lastError = error; }
      await sleep(120, restoring ? null : activeTask);
    } while (Date.now() < deadline);
    console.warn('[Tripo Rotation] 等待白膜材质就位超时，已保留原站画面继续导出', lastError);
    setStatus('白膜提亮未生效，已保留原站画面继续导出', 'warning');
    return false;
  }

  function restoreSolidLook() {
    const snapshot = solidLookSnapshot;
    if (!snapshot) return;
    solidLookSnapshot = null;
    for (const [mesh, original, adjusted] of snapshot.assignments) {
      if (mesh.material === adjusted) mesh.material = original;
    }
    for (const material of snapshot.clones) material.dispose?.();
    snapshot.manager.invalidate();
  }

  function applySolidLook(strict = false) {
    if (!settings.brightSolid || currentMaterial().id !== 'solid') {
      restoreSolidLook();
      return false;
    }
    const canvas = findViewerCanvas();
    if (!canvas) {
      if (strict) throw new Error('白膜模型尚未加载');
      return false;
    }
    let binding;
    try { binding = findRenderContext(canvas); }
    catch (error) { if (strict) throw error; return false; }
    const { scene, manager } = binding;
    const lift = settings.solidLift;
    if (solidLookSnapshot?.scene === scene && solidLookSnapshot.lift === lift) {
      const applied = new Map(solidLookSnapshot.assignments.map(([mesh, , adjusted]) => [mesh, adjusted]));
      const visibleApplied = new Set();
      let stillCurrent = true;
      const traverseCurrent = scene.traverseVisible?.bind(scene) || scene.traverse.bind(scene);
      traverseCurrent(mesh => {
        if (!mesh.isMesh || !mesh.visible) return;
        if (applied.has(mesh)) {
          visibleApplied.add(mesh);
          if (mesh.material !== applied.get(mesh)) stillCurrent = false;
        } else if (Array.isArray(mesh.material)
          ? mesh.material.some(isSolidSurfaceMaterial) : isSolidSurfaceMaterial(mesh.material)) {
          stillCurrent = false;
        }
      });
      if (stillCurrent && visibleApplied.size === applied.size) return true;
    }
    restoreSolidLook();
    // 在最终显示色彩上提亮中间调：两端（纯黑/纯白）不动，保留
    // Matcap 明暗和叠加的独立线框。旧 gamma 曲线实测默认值仅提高约 9/255。
    const strength = (lift * 1.6).toFixed(4);
    const adjustedByOriginal = new Map();
    const assignments = [];
    const clones = new Set();
    try {
      const traverse = scene.traverseVisible?.bind(scene) || scene.traverse.bind(scene);
      traverse(mesh => {
        if (!mesh.isMesh || !mesh.visible) return;
        const original = mesh.material;
        const adjust = material => {
          if (!isSolidSurfaceMaterial(material)) return material;
          if (adjustedByOriginal.has(material)) return adjustedByOriginal.get(material);
          if ((material.isShaderMaterial || material.isRawShaderMaterial) &&
              !patchSolidFragment(String(material.fragmentShader || ''), strength)) return material;
          const clone = material.clone();
          const originalCompile = material.onBeforeCompile;
          const originalProgramKey = material.customProgramCacheKey?.() || '';
          clone.onBeforeCompile = function (shader, renderer) {
            originalCompile?.call(this, shader, renderer);
            const patched = patchSolidFragment(shader.fragmentShader, strength);
            if (patched) shader.fragmentShader = patched;
          };
          clone.customProgramCacheKey = () => `${originalProgramKey}:tripo-bright-solid:${strength}`;
          clone.needsUpdate = true;
          adjustedByOriginal.set(material, clone);
          clones.add(clone);
          return clone;
        };
        const adjusted = Array.isArray(original) ? original.map(adjust) : adjust(original);
        if (Array.isArray(original) ? adjusted.some((item, index) => item !== original[index]) : adjusted !== original) {
          mesh.material = adjusted;
          assignments.push([mesh, original, adjusted]);
        }
      });
      if (!assignments.length) {
        for (const material of clones as unknown as any[]) material.dispose?.();
        if (strict) setStatus('白膜提亮未生效，已保留原站画面继续导出', 'warning');
        return false;
      }
      solidLookSnapshot = { scene, manager, lift, assignments, clones };
      manager.invalidate();
      return true;
    } catch (error) {
      for (const [mesh, original, adjusted] of assignments) {
        if (mesh.material === adjusted) mesh.material = original;
      }
      for (const material of clones as unknown as any[]) material.dispose?.();
      if (strict) throw error;
      return false;
    }
  }

  function cameraSignature(camera) {
    camera.updateMatrixWorld(true);
    return [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
  }

  function assertSignature(actual, expected, label) {
    if (!expected || actual.length !== expected.length || actual.some((value, i) =>
      !Number.isFinite(value) || !Number.isFinite(expected[i]) ||
      Math.abs(value - expected[i]) > 1e-9 * Math.max(1, Math.abs(expected[i])))) {
      throw new Error(`${label}不一致，已中止以避免导出错帧`);
    }
  }

  function snapshotView(binding) {
    const { controls, camera, canvas } = binding;
    const spherical = controls.getSpherical(undefined, false);
    return {
      position: controls.getPosition(undefined, false).toArray(),
      target: controls.getTarget(undefined, false).toArray(),
      offset: controls.getFocalOffset(undefined, false).toArray(),
      theta: spherical.theta, phi: spherical.phi, zoom: camera.zoom,
      width: canvas.width, height: canvas.height,
      signature: cameraSignature(camera),
    };
  }

  function applyView(binding, view, angle = 0) {
    const { controls, camera, canvas } = binding;
    if (!canvas.isConnected || canvas.width !== view.width || canvas.height !== view.height ||
        activeCamera(binding.context) !== camera || nativeObject(binding.context.scene) !== binding.scene ||
        nativeObject(binding.context.controls) !== controls || controlsCamera(controls) !== camera) {
      throw new Error('预览器尺寸、相机或工程已变化，请保持窗口尺寸不变后重新导出');
    }
    // All targets are absolute, transition=false. Never integrate pointer deltas
    // or wall-clock time, including when encoding/GPU work takes longer.
    controls.setLookAt(...view.position, ...view.target, false);
    controls.setFocalOffset(...view.offset, false);
    controls.zoomTo(view.zoom, false);
    controls.rotateTo(view.theta + angle, view.phi, false);
    controls.update(0);
    // camera-controls 2.10.x uses camera.matrix for screen-space focal offset.
    // Refresh that basis before applying the offset at a new absolute angle.
    camera.updateMatrixWorld(true);
    controls.update(0);
    const spherical = controls.getSpherical(undefined, false);
    if (Math.abs(spherical.theta - view.theta - angle) > 1e-8 ||
        Math.abs(spherical.phi - view.phi) > 1e-8) {
      throw new Error('相机角度受到页面限制，不能保证精确圈数');
    }
    return cameraSignature(camera);
  }

  // The current camera position is the 100% baseline for this page only.
  function zoomMetric(state) {
    return state.mode === 'dolly' ? state.controls.distance : state.camera.zoom;
  }

  function zoomLocked() {
    return Boolean(exportBusy || batchRunning || activeRun || pendingSave ||
      pendingProjectName || pendingBatchStart);
  }

  function syncZoomSlider() {
    if (!ui?.zoomRail) return;
    const state = zoomState;
    const metric = state && zoomMetric(state);
    if (!state || !state.canvas.isConnected || !Number.isFinite(metric) || metric <= 0) {
      for (const control of [ui.zoomRange, ui.zoomValue, ui.zoomIn, ui.zoomOut]) control.disabled = true;
      ui.zoomValue.value = '';
      return;
    }
    let ratio = state.mode === 'dolly' ? state.baseline / metric : metric / state.baseline;
    if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4) {
      state.baseline = metric;
      ratio = 1;
    }
    const value = String(Math.round(ratio * 1000) / 10);
    if (!zoomDragging) ui.zoomRange.value = value;
    if (shadow.activeElement !== ui.zoomValue) ui.zoomValue.value = value;
    for (const control of [ui.zoomRange, ui.zoomValue, ui.zoomIn, ui.zoomOut]) control.disabled = zoomLocked();
  }

  function bindZoomSlider() {
    if (!ui?.zoomRail) return;
    const canvas = findViewerCanvas();
    let binding = null;
    try { if (canvas) binding = findRenderContext(canvas); } catch { /* viewer not ready */ }
    const mode = binding?.camera?.isOrthographicCamera ? 'zoom'
      : binding?.camera?.isPerspectiveCamera ? 'dolly' : null;
    const supported = mode === 'zoom' ? typeof binding.controls?.zoomTo === 'function'
      : mode === 'dolly' ? typeof binding.controls?.dollyTo === 'function' : false;
    if (!supported) {
      zoomState?.renderHook?.off?.();
      zoomState = null;
      syncZoomSlider();
      return;
    }
    if (zoomState?.canvas !== canvas || zoomState?.controls !== binding.controls ||
        zoomState?.camera !== binding.camera || zoomState?.scene !== binding.scene) {
      zoomState?.renderHook?.off?.();
      const next: any = { ...binding, mode, baseline: 0, renderHook: null };
      next.baseline = zoomMetric(next);
      if (!Number.isFinite(next.baseline) || next.baseline <= 0) {
        zoomState = null;
        syncZoomSlider();
        return;
      }
      zoomState = next;
      next.renderHook = binding.manager.onRender(() => {
        if (zoomState === next && panelVisible && !zoomLocked()) syncZoomSlider();
      });
    }
    syncZoomSlider();
  }

  function setFineZoom(percent) {
    if (zoomLocked()) { syncZoomSlider(); return false; }
    const state = zoomState;
    if (!state || !state.canvas.isConnected || findViewerCanvas() !== state.canvas) {
      bindZoomSlider();
      return false;
    }
    const ratio = Math.min(4, Math.max(0.25, Number(percent) / 100));
    if (!Number.isFinite(ratio)) return false;
    const target = state.mode === 'dolly' ? state.baseline / ratio : state.baseline * ratio;
    if (state.mode === 'dolly') state.controls.dollyTo(target, false);
    else state.controls.zoomTo(target, false);
    state.controls.update(0);
    state.camera.updateMatrixWorld(true);
    state.manager.invalidate();
    syncZoomSlider();
    return true;
  }

  function stepFineZoom(delta) {
    if (zoomLocked()) return;
    const next = Math.min(400, Math.max(25, Math.round((Number(ui.zoomRange.value) + delta) * 10) / 10));
    ui.zoomRange.value = String(next);
    setFineZoom(next);
  }

  function createFrameLock(canvas, initialView = null, transparent = Boolean(settings.transparentOutput)) {
    const binding = findRenderContext(canvas, true);
    const { controls, renderer, manager, scene, camera } = binding;
    const view = initialView || snapshotView(binding);
    const originalEnabled = controls.enabled;
    const originalRender = renderer.render;
    if (transparent && renderer.getContext().getContextAttributes()?.alpha !== true) {
      throw new Error('当前模型 Canvas 不支持 Alpha，无法可靠导出透明背景；请关闭透明选项。');
    }
    const restoreAxis = hideAxisOverlay(canvas);
    const originalBackground = transparent ? scene.background : null;
    const originalClearAlpha = transparent ? renderer.getClearAlpha() : null;
    const applyTransparency = () => {
      if (!transparent) return;
      scene.background = null;
      renderer.setClearAlpha(0);
      // Preserve scene.environment: it lights the model, not the background.
    };
    let pending = null;
    let released = false;
    let backgrounded = document.hidden;
    let beforeHook, renderHook;
    const clearDeadline = (job) => {
      clearTimeout(job.timer);
      job.timer = null;
      job.timerEpoch = (job.timerEpoch || 0) + 1;
    };
    const fail = (error) => {
      if (!pending) return;
      const job = pending;
      pending = null;
      clearDeadline(job);
      job.reject(error);
    };
    const requestRender = () => {
      if (!pending || released) return;
      try {
        if (manager.mode === 'manual') manager.advance();
        else manager.invalidate();
      } catch (error) { fail(error); }
    };
    const armDeadline = () => {
      if (!pending || document.hidden) return;
      const job = pending;
      clearDeadline(job);
      const epoch = job.timerEpoch;
      job.timer = window.setTimeout(() => {
        if (pending !== job || epoch !== job.timerEpoch || released) return;
        // Visibility events and timer callbacks can be delivered in either order.
        // A hidden document must never consume the foreground render deadline.
        if (document.hidden) { visibilityChanged(); return; }
        fail(new Error('等待原生渲染完成超时（前台15秒），未生成重复帧'));
      }, 15000);
    };
    const visibilityChanged = () => {
      if (released) return;
      const wasBackgrounded = backgrounded;
      backgrounded = document.hidden;
      if (!pending) return;
      if (backgrounded) {
        clearDeadline(pending);
        if (!wasBackgrounded) setStatus('后台导出 · 有新渲染帧就继续，浏览器挂起时保留进度等待', 'warning');
      } else if (wasBackgrounded) {
        pending.armed = false;
        pending.observed = false;
        setStatus('已返回前台 · 正在继续未完成的帧', 'running');
        armDeadline();
        requestRender();
      }
    };
    const wrappedRender = function (this: any, renderScene, renderCamera, ...args) {
      if (pending?.armed && nativeObject(renderScene) === scene && nativeObject(renderCamera) === camera) {
        try {
          applyTransparency();
          assertSignature(cameraSignature(camera), pending.signature, '渲染时相机');
          pending.observed = true;
        } catch (error) { fail(error); }
      }
      return originalRender.call(this as any, renderScene, renderCamera, ...args);
    };
    const release = () => {
      if (released) return;
      released = true;
      restoreAxis();
      fail(new Error('逐帧采集已取消'));
      document.removeEventListener('visibilitychange', visibilityChanged);
      beforeHook?.off();
      renderHook?.off();
      if (renderer.render === wrappedRender) renderer.render = originalRender;
      controls.enabled = originalEnabled;
      if (transparent) {
        scene.background = originalBackground;
        renderer.setClearAlpha(originalClearAlpha);
        manager.invalidate();
      }
    };
    try {
      controls.stop();
      applyTransparency();
      controls.enabled = false;
      const startSignature = applyView(binding, view);
      assertSignature(startSignature, view.signature, '起始视角');
      renderer.render = wrappedRender;
      document.addEventListener('visibilitychange', visibilityChanged);
      beforeHook = manager.loop.onBeforeLoop(() => {
        if (!pending) return;
        try {
          pending.armed = false;
          pending.observed = false;
          applyTransparency();
          pending.signature = applyView(binding, view, pending.angle);
          pending.armed = true;
        } catch (error) { fail(error); }
      });
      renderHook = manager.onRender(() => {
        if (!pending?.armed || !pending.observed) return;
        const job = pending;
        try {
          assertSignature(cameraSignature(camera), job.signature, '取图时相机');
          // Copy *inside* the render-complete callback, before WebGL discards its
          // drawing buffer. No await, rAF or encoder backpressure before this copy.
          const result = job.copy(job.signature);
          pending = null;
          clearDeadline(job);
          job.resolve(result);
        } catch (error) { fail(error); }
      });
    } catch (error) { release(); throw error; }
    return {
      view, binding, release,
      restore() { applyView(binding, view); },
      capture(angle, copy) {
        if (released || pending) return Promise.reject(new Error('逐帧任务必须串行执行'));
        return new Promise((resolve, reject) => {
          pending = { angle, copy, resolve, reject, observed: false, armed: false,
            signature: null, timer: null, timerEpoch: 0 };
          backgrounded = document.hidden;
          armDeadline();
          requestRender();
        });
      },
    };
  }

  function requireCanvasRecording() {
    if (settings.recordingScope !== 'canvas') {
      throw new Error('严格逐帧录制目前仅支持“仅模型画面”；整标签页共享流无法确认帧与角度对应，已暂停此录制方式');
    }
  }

  function checkFrameEntry() {
    try {
      const canvas = findViewerCanvas() as HTMLElement | null;
      if (!canvas) throw new Error('请先打开一个已加载的模型');
      const binding = findRenderContext(canvas, true);
      const view = snapshotView(binding);
      setStatus(`逐帧入口可用 · ${view.width}×${view.height} · 原生相机与渲染完成回调`, 'ready', true);
      console.info('[Tripo Rotation] 逐帧入口诊断', {
        version: SCRIPT_VERSION, engine: canvas.dataset.engine, tres: canvas.dataset.tres,
        controls: canvas.dataset.cameraControlsVersion, renderMode: binding.manager.mode,
        camera: binding.camera.type, width: view.width, height: view.height,
      });
    } catch (error) {
      // Only structural counters and known capability names; no Vue state or account data.
      if (!(error instanceof FrameEntryError)) {
        console.warn('[Tripo Rotation] 逐帧入口诊断', { version: SCRIPT_VERSION, stage: '视角读取或画布检查失败' });
      }
      setStatus(`逐帧入口检查失败：${error.message}`, 'error');
    }
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn(`[Tripo Rotation] 无法读取本地设置 ${key}`, error);
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn(`[Tripo Rotation] 无法写入本地设置 ${key}`, error);
      return false;
    }
  }

  function loadSettings() {
    try {
      const stored = JSON.parse(readStorage(STORAGE_KEY) || '{}');
      return normalizeSettings(stored);
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    const saved = writeStorage(STORAGE_KEY, JSON.stringify(settings));
    if (!saved) {
      if (ui?.status) setStatus('设置无法持久化，当前会话仍会继续使用', 'warning');
    }
    return saved;
  }

  function currentProjectId() {
    const match = location.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
    return match?.[1] || location.pathname.split('/').filter(Boolean).pop() || 'unknown-project';
  }

  function getProjectName() {
    return projectNameFor(projectStorage, currentProjectId());
  }

  function saveProjectName(name) {
    const value = String(name || '').trim();
    if (!value) return false;
    const names = projectStorage.loadNames();
    names[currentProjectId()] = value;
    projectStorage.saveNames(names);
    rememberNamedProject(value);
    if (ui?.projectName) ui.projectName.value = value;
    return true;
  }

  function loadProjectLibrary() {
    return projectStorage.loadLibrary();
  }

  function rememberNamedProject(name) {
    const id = currentProjectId();
    const records = rememberProject(loadProjectLibrary(), id, name, location.href, Date.now());
    projectStorage.saveLibrary(records);
  }

  function projectSwitchBlocked() {
    return Boolean(exportBusy || batchRunning || activeRun || pendingSave || pendingProjectName || pendingBatchStart);
  }

  function switchNamedProject(id) {
    if (projectSwitchBlocked()) {
      setStatus('导出、保存或命名尚未结束，暂时不能切换工程', 'warning');
      return;
    }
    const record = loadProjectLibrary().find(item => item.id === id);
    const url = record && validProjectUrl(record.url, id);
    if (!url || id === currentProjectId()) return;
    location.assign(url);
  }

  function renderProjectLibrary() {
    const query = ui.projectSearch.value.trim().toLocaleLowerCase();
    const records = loadProjectLibrary().filter(record =>
      `${record.name} ${record.id}`.toLocaleLowerCase().includes(query));
    ui.projectList.replaceChildren();
    for (const record of records) {
      const button = document.createElement('button');
      button.className = 'project-entry';
      const name = document.createElement('span');
      name.textContent = record.name;
      const detail = document.createElement('small');
      detail.textContent = `${record.id.slice(0, 8)}${record.id === currentProjectId() ? ' · 当前项目' : ''}`;
      button.append(name, detail);
      button.disabled = projectSwitchBlocked() || record.id === currentProjectId();
      button.addEventListener('click', () => switchNamedProject(record.id));
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px';
      button.style.flex = '1';
      const remove = document.createElement('button');
      remove.textContent = '删除命名';
      remove.setAttribute('aria-label', `删除命名：${record.name}`);
      remove.disabled = projectSwitchBlocked();
      remove.addEventListener('click', () => deleteProjectName(record.id));
      row.append(button, remove);
      ui.projectList.appendChild(row);
    }
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = query ? '没有匹配的项目' : '暂无记录。新版命名或改名后，项目会显示在这里。';
      ui.projectList.appendChild(empty);
    }
  }

  function deleteProjectName(id) {
    if (projectSwitchBlocked()) return;
    if (!window.confirm('仅删除本浏览器保存的项目命名，不会删除 Tripo 工程或已导出的文件。继续？')) return;
    const names = projectStorage.loadNames();
    delete names[id];
    projectStorage.saveNames(names);
    projectStorage.saveLibrary(loadProjectLibrary().filter(record => record.id !== id));
    syncProjectNameField();
    renderProjectLibrary();
  }

  function showProjectLibrary(show) {
    if (show && projectSwitchBlocked()) {
      setStatus('请先完成或停止当前任务，再切换工程', 'warning');
      return;
    }
    ui.mainPage.hidden = show;
    ui.projectsPage.hidden = !show;
    ui.batchMenu.hidden = true;
    ui.batchToggle.setAttribute('aria-expanded', 'false');
    if (show) { renderProjectLibrary(); ui.projectSearch.focus(); }
  }

  function selectedExportItems() {
    const keys = Array.isArray(settings.batchItems) ? settings.batchItems : DEFAULTS.batchItems;
    return selectedBatchItems(EXPORT_ITEMS, keys);
  }

  function imageBasename(image) {
    const source = image?.currentSrc || image?.src || '';
    try {
      const pathname = new URL(source, location.href).pathname;
      return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)).toLowerCase();
    } catch {
      return source.split(/[?#]/, 1)[0].slice(source.lastIndexOf('/') + 1).toLowerCase();
    }
  }

  function findButtonWithIcon(icon) {
    const wanted = String(icon).toLowerCase();
    const image = [...document.querySelectorAll('button img')].find(
      item => imageBasename(item) === wanted
    );
    return image?.closest('button') || null;
  }

  function findWireframeButton() {
    return findButtonWithIcon('wireframe.png');
  }

  function toggleIsOn(button) {
    return Boolean(button && (button.getAttribute('aria-pressed') === 'true' || button.dataset.state === 'on'));
  }

  function wireframeAvailable() {
    const button = findWireframeButton();
    return Boolean(button && button.isConnected && !button.disabled);
  }

  function applyWireframeStyle(strict = false, suppliedBinding = null) {
    const canvas = suppliedBinding?.canvas || findViewerCanvas();
    if (!canvas) {
      if (strict) throw new Error('模型尚未加载，无法应用线框样式');
      return 0;
    }
    let binding = suppliedBinding;
    try { binding ||= findRenderContext(canvas); }
    catch (error) { if (strict) throw error; return 0; }
    if (typeof binding.scene?.traverse !== 'function') {
      if (strict) throw new Error('当前查看器不支持线框样式调整');
      return 0;
    }
    const color = settings.wireframeColor;
    const width = settings.wireframeWidth;
    const opacity = settings.wireframeOpacity;
    let found = 0;
    let changed = false;
    binding.scene.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const uniforms = material?.uniforms;
        if (!material?.userData?.wireframe || !uniforms?.linewidth ||
            !uniforms.wireframeColor || !uniforms.wireframeOpacity) continue;
        found += 1;
        if (uniforms.linewidth.value !== width) { uniforms.linewidth.value = width; changed = true; }
        if (uniforms.wireframeColor.value?.getHexString?.()?.toLowerCase() !== color.slice(1)) {
          uniforms.wireframeColor.value?.set?.(color);
          changed = true;
        }
        if (uniforms.wireframeOpacity.value !== opacity) {
          uniforms.wireframeOpacity.value = opacity;
          changed = true;
        }
        if (uniforms.minAlpha && uniforms.minAlpha.value !== Math.min(0.1, opacity)) {
          uniforms.minAlpha.value = Math.min(0.1, opacity);
          changed = true;
        }
      }
    });
    if (changed) binding.manager.invalidate();
    if (strict && !found) throw new Error('线框尚未完成加载，无法保证导出样式一致');
    return found;
  }

  function bindWireframeStyle() {
    const canvas = findViewerCanvas();
    let binding = null;
    try { if (canvas) binding = findRenderContext(canvas); } catch { /* viewer not ready */ }
    if (!binding || typeof binding.scene?.traverse !== 'function' ||
        typeof binding.manager?.onRender !== 'function') {
      wireframeStyleState?.renderHook?.off?.();
      wireframeStyleState = null;
      return;
    }
    if (wireframeStyleState?.canvas !== canvas || wireframeStyleState?.scene !== binding.scene ||
        wireframeStyleState?.manager !== binding.manager) {
      wireframeStyleState?.renderHook?.off?.();
      const next: any = { ...binding, renderHook: null };
      wireframeStyleState = next;
      next.renderHook = binding.manager.onRender(() => {
        if (wireframeStyleState === next) applyWireframeStyle(false, next);
      });
    }
    applyWireframeStyle(false, wireframeStyleState);
  }

  function plannedExportItems() {
    return planBatchJobs(EXPORT_ITEMS, settings, wireframeAvailable());
  }

  function syncBatchSelection() {
    const selected = selectedExportItems();
    const available = wireframeAvailable();
    const total = selected.length * (settings.batchWireframeVariants && available ? 2 : 1);
    ui.exportAll.textContent = `导出所选内容（${total} 项）`;
    ui.exportAll.disabled = !selected.length;
    for (const checkbox of ui.batchMenu.querySelectorAll('input[data-export-key]')) {
      checkbox.checked = selected.some(item => item.key === checkbox.dataset.exportKey);
    }
    if (ui.batchWireframe) {
      ui.batchWireframe.checked = Boolean(settings.batchWireframeVariants);
      ui.batchWireframe.disabled = !available || projectSwitchBlocked();
      ui.batchWireframeText.textContent = available ? '同时导出线框版本' : '当前项目未检测到线框模式';
    }
  }

  function initializeBatchMenu() {
    const wireframeLabel = document.createElement('label');
    wireframeLabel.className = 'batch-wireframe';
    const wireframeInput = document.createElement('input');
    wireframeInput.type = 'checkbox';
    wireframeInput.dataset.wireframeVariants = 'true';
    const wireframeText = document.createElement('span');
    wireframeLabel.append(wireframeInput, wireframeText);
    ui.batchMenu.appendChild(wireframeLabel);
    ui.batchWireframe = wireframeInput;
    ui.batchWireframeText = wireframeText;
    for (const kind of EXPORT_KINDS) {
      const row = document.createElement('div');
      row.className = 'batch-row';
      const title = document.createElement('span');
      title.textContent = kind.label;
      row.appendChild(title);
      for (const material of MATERIALS) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.exportKey = `${kind.id}:${material.id}`;
        input.setAttribute('aria-label', `${kind.label} · ${material.label}`);
        label.append(input, document.createTextNode(material.label));
        row.appendChild(label);
      }
      ui.batchMenu.appendChild(row);
    }
    ui.batchMenu.addEventListener('change', event => {
      if (!event.target.matches('input[data-export-key], input[data-wireframe-variants]')) return;
      if (projectSwitchBlocked()) { syncBatchSelection(); return; }
      if (event.target.matches('input[data-wireframe-variants]')) {
        settings.batchWireframeVariants = event.target.checked && wireframeAvailable();
      } else {
        settings.batchItems = [...ui.batchMenu.querySelectorAll('input[data-export-key]:checked')].map(input => input.dataset.exportKey);
      }
      saveSettings();
      syncBatchSelection();
    });
    syncBatchSelection();
  }

  function currentMaterial() {
    for (const material of MATERIALS) {
      const button = findButtonWithIcon(material.icon);
      if (button?.getAttribute('aria-pressed') === 'true' || button?.dataset.state === 'on') {
        return material;
      }
    }
    return { id: 'current', label: '当前材质', icon: '' };
  }

  function buildOutputFilename(kind, projectName, materialLabel, wireframe = false) {
    return formatOutputFilename(kind, projectName, materialLabel, settings, wireframe);
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width >= 320 && rect.height >= 240 &&
      style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity) > 0 && style.pointerEvents !== 'none';
  }

  function findViewerCanvas() {
    const preferred = [...document.querySelectorAll(
      'canvas[data-camera-controls-version][data-engine^="three.js"]'
    )].filter(isVisible);

    const candidates = preferred.length ? preferred :
      [...document.querySelectorAll('canvas')].filter(isVisible);

    return candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0] || null;
  }

  function autoBitrate(width, height, fps) {
    // 约 0.22 bit / pixel / frame；兼顾细节与 AE 后期空间。
    return Math.round(clamp(width * height * fps * 0.22, 8_000_000, 120_000_000, 40_000_000));
  }

  function timestampForFile() {
    const now = new Date();
    const two = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-` +
      `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  }

  function downloadVideo(blob, session, mode, cancelled = false) {
    const suffix = cancelled ? '-stopped' : '';
    const filename = `tripo-${mode}-${timestampForFile()}-${session.width}x${session.height}-` +
      `${session.fps}fps${suffix}.${session.format === 'mov' ? 'mov' : 'mp4'}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return filename;
  }

  function downloadScreenshot(blob, source, scope) {
    const filename = `tripo-screenshot-${timestampForFile()}-${source.width}x${source.height}-${scope}.png`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return filename;
  }

  function fallbackDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return filename;
  }

  function withStoppedSuffix(filename) {
    const dot = filename.lastIndexOf('.');
    return dot > 0
      ? `${filename.slice(0, dot)}-已停止${filename.slice(dot)}`
      : `${filename}-已停止`;
  }

  async function chooseSingleFile(filename, type) {
    if (typeof window.showSaveFilePicker !== 'function') return { kind: 'download' };
    const isPng = type === 'image/png';
    const isMov = type === 'video/quicktime';
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: isPng ? 'PNG 图片' : isMov ? '透明 MOV（无损 PNG 帧）' : 'H.264 MP4 视频',
        accept: { [type]: [isPng ? '.png' : isMov ? '.mov' : '.mp4'] },
      }],
      excludeAcceptAllOption: false,
    });
    return { kind: 'file', handle };
  }

  async function uniqueDirectoryFile(directory, filename) {
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : '';
    for (let index = 1; index < 1000; index += 1) {
      const candidate = index === 1 ? filename : `${stem}（${index}）${extension}`;
      try {
        await directory.getFileHandle(candidate);
      } catch (error) {
        if (error?.name === 'NotFoundError') {
          return {
            filename: candidate,
            handle: await directory.getFileHandle(candidate, { create: true }),
          };
        }
        throw error;
      }
    }
    throw new Error('同名文件数量过多');
  }

  async function directoryEntryNames(directory) {
    const names = new Set();
    if (typeof directory?.keys !== 'function') return names;
    for await (const name of directory.keys()) names.add(name);
    return names;
  }

  function isSwapFor(filename, name) {
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}(?:\\.\\d+)?\\.crswap$`, 'i').test(name);
  }

  async function reserveDirectoryFile(job) {
    if (job.directoryReservation) return job.directoryReservation;
    const directory = job.target.handle;
    const namesBefore = await directoryEntryNames(directory);
    const unique = await uniqueDirectoryFile(directory, job.filename);
    job.directoryReservation = {
      directory,
      filename: unique.filename,
      handle: unique.handle,
      namesBefore,
    };
    return job.directoryReservation;
  }

  async function cleanupDirectoryReservation(job, preserveTarget) {
    const reservation = job.directoryReservation;
    if (!reservation) return;
    const { directory, filename, handle, namesBefore } = reservation;
    try {
      const namesNow = await directoryEntryNames(directory);
      if (typeof directory.removeEntry === 'function') {
        for (const name of namesNow) {
          if (!namesBefore.has(name) && isSwapFor(filename, name)) {
            try { await directory.removeEntry(name); }
            catch (error) { console.warn(`[Tripo Rotation] 无法清理临时文件 ${name}`, error); }
          }
        }
        if (!preserveTarget && !namesBefore.has(filename)) {
          try {
            const file = await handle.getFile();
            // Never delete a non-empty target: another process may have replaced it.
            if (file.size === 0) await directory.removeEntry(filename);
          } catch (error) {
            if (error?.name !== 'NotFoundError') console.warn(`[Tripo Rotation] 无法清理占位文件 ${filename}`, error);
          }
        }
      }
    } finally {
      if (!preserveTarget) job.directoryReservation = null;
    }
  }

  async function writeBlobOnce(job) {
    if (!job.target || job.target.kind === 'download') {
      job.stage = '交给浏览器下载';
      return fallbackDownload(job.blob, job.filename);
    }
    let writable = null;
    let handle = job.target.handle;
    job.actualFilename = handle?.name || job.filename;
    try {
      job.stage = '取得目标文件';
      if (job.target.kind === 'directory') {
        // Reserve a unique name once. A transient close/commit failure must retry
        // this same target, otherwise every retry leaves a zero-byte file and a
        // complete .crswap behind, then unnecessarily creates “（2）”.
        const reservation = await reserveDirectoryFile(job);
        handle = reservation.handle;
        job.actualFilename = reservation.filename;
      }
      job.stage = '创建写入流';
      writable = await handle.createWritable();
      job.stage = '写入文件内容';
      await writable.write(job.blob);
      job.stage = '提交文件（关闭写入流）';
      await writable.close();
      if (typeof handle.getFile === 'function') {
        const saved = await handle.getFile();
        if (saved.size !== job.blob.size) {
          throw Object.assign(new Error(`保存后大小不一致：${saved.size}/${job.blob.size}`), { name: 'InvalidStateError' });
        }
      }
      job.stage = '保存完成';
      await cleanupDirectoryReservation(job, job.target.kind === 'directory');
      return job.actualFilename;
    } catch (error) {
      job.error = error;
      console.error(`[Tripo Rotation] 保存失败 [${job.stage}] ${job.actualFilename}`, error);
      // 失败操作已经返回后才中止并重试；绝不让两个写入流并发提交同一文件。
      if (writable) {
        try { await writable.abort(); } catch (abortError) {
          console.warn('[Tripo Rotation] 写入流已关闭或无法中止', abortError);
        }
      }
      throw error;
    }
  }

  async function attemptSave(job) {
    const transientErrors = new Set(['InvalidStateError', 'UnknownError', 'NotReadableError', 'NoModificationAllowedError']);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await writeBlobOnce(job);
      } catch (error) {
        // 单独选择的文件不自动覆盖重试，留给用户显式选择重试或另存为。
        if (job.target?.kind !== 'directory' || !transientErrors.has(error?.name) || attempt === 4) throw error;
        const delay = [1000, 2000, 4000, 8000][attempt];
        setStatus(`文件提交被占用，${delay / 1000}秒后按原文件名重试 ${attempt + 1}/4：${job.actualFilename}`, 'warning');
        await sleep(delay);
      }
    }
  }

  function showSaveRecovery(job) {
    ui.saveRecoveryModal.hidden = false;
    ui.saveRecoveryInfo.textContent = `${job.filename}\n失败阶段：${job.stage}\n${job.error?.name || 'Error'}：${job.error?.message || '未知错误'}\n已编码文件仍保留在本页内存中。保存成功后自动继续，无需重新录制。请勿刷新或关闭页面。`;
    ui.saveRetry.disabled = job.busy;
    ui.saveAs.disabled = job.busy;
    ui.saveDiscard.disabled = job.busy;
    setStatus(`导出已暂停，等待保存：${job.filename}（${job.stage}）`, 'error');
  }

  async function saveBlob(blob, filename, target = null) {
    const job = { blob, filename, target, stage: '准备保存', error: null, busy: false };
    // Keep unload protection through writes, retries and the recovery dialog.
    activeSaves += 1;
    try {
      return await attemptSave(job);
    } catch (error) {
      job.error = error;
      // 暂停原有 await 链，保留同一个 Blob；成功保存后从此处继续批量队列。
      return await new Promise((resolve, reject) => {
        (job as any).resolve = resolve;
        (job as any).reject = reject;
        pendingSave = job;
        showSaveRecovery(job);
      });
    } finally {
      activeSaves -= 1;
    }
  }

  async function resumePendingSave(saveAs = false) {
    const job = pendingSave;
    if (!job || job.busy) return;
    job.busy = true;
    showSaveRecovery(job);
    try {
      if (saveAs) {
        // 在按钮点击的用户激活期间调用系统保存框，不重新编码。
        const target = await chooseSingleFile(job.filename, job.blob.type);
        job.target = target;
      }
      const filename = await attemptSave(job);
      if (saveAs) await cleanupDirectoryReservation(job, false);
      pendingSave = null;
      ui.saveRecoveryModal.hidden = true;
      job.resolve(filename);
    } catch (error) {
      // 取消另存为只回到恢复窗口，不能取消整批任务或释放已编码数据。
      if (error?.name !== 'AbortError') job.error = error;
    } finally {
      job.busy = false;
      if (pendingSave === job) showSaveRecovery(job);
    }
  }

  function discardPendingSave() {
    const job = pendingSave;
    if (!job || job.busy) return;
    if (!window.confirm('放弃当前尚未保存的文件并终止本次导出？已保存文件不会删除。')) return;
    pendingSave = null;
    ui.saveRecoveryModal.hidden = true;
    cleanupDirectoryReservation(job, false).catch(error => console.warn('[Tripo Rotation] 清理未完成保存失败', error));
    job.reject(new Error('用户放弃当前文件，导出已终止'));
  }

  function findViewerBackground(sourceCanvas) {
    let element = sourceCanvas.parentElement;
    while (element && element !== document.body) {
      const style = getComputedStyle(element);
      if (style.backgroundImage !== 'none' ||
          (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)')) {
        return style;
      }
      element = element.parentElement;
    }
    return null;
  }

  function paintViewerBackground(context, width, height, sourceCanvas) {
    const style = findViewerBackground(sourceCanvas);
    const image = style?.backgroundImage || '';
    const colors = image.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi) || [];

    if (image.includes('radial-gradient') && colors.length >= 2) {
      const radius = Math.hypot(width / 2, height / 2);
      const gradient = context.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, radius
      );
      gradient.addColorStop(0, colors[0]);
      gradient.addColorStop(0.9, colors[colors.length - 1]);
      gradient.addColorStop(1, colors[colors.length - 1]);
      context.fillStyle = gradient;
    } else {
      const color = style?.backgroundColor;
      context.fillStyle = color && color !== 'rgba(0, 0, 0, 0)'
        ? color
        : '#0e0e10';
    }
    context.fillRect(0, 0, width, height);
  }

  function findAxisOverlay(sourceCanvas) {
    const container = sourceCanvas.parentElement;
    if (!container) return null;
    const exact = container.querySelector(
      'div[style*="height: 72px"][style*="width: 72px"][style*="right: 0px"][style*="top: 0px"]'
    );
    if (exact) return exact;

    return null;
  }

  function createViewerBackgroundCanvas(sourceCanvas) {
    const backgroundCanvas = document.createElement('canvas');
    backgroundCanvas.width = sourceCanvas.width;
    backgroundCanvas.height = sourceCanvas.height;
    paintViewerBackground(
      backgroundCanvas.getContext('2d', { alpha: false }),
      backgroundCanvas.width,
      backgroundCanvas.height,
      sourceCanvas
    );
    return backgroundCanvas;
  }

  // Never erase model pixels to hide an independent DOM overlay.
  function hideAxisOverlay(sourceCanvas) {
    if (settings.showAxisInOutput) return () => {};
    const overlay = findAxisOverlay(sourceCanvas);
    if (!overlay) return () => {};
    const value = overlay.style.getPropertyValue('visibility');
    const priority = overlay.style.getPropertyPriority('visibility');
    overlay.style.setProperty('visibility', 'hidden', 'important');
    return () => {
      if (value) overlay.style.setProperty('visibility', value, priority);
      else overlay.style.removeProperty('visibility');
    };
  }

  function createCanvasFrameSource(sourceCanvas, evenDimensions = true) {
    const transparent = Boolean(settings.transparentOutput);
    const recordingCanvas = document.createElement('canvas');
    // WebCodecs H.264 需要偶数尺寸，最多仅裁掉右侧/底部各 1 像素。
    recordingCanvas.width = evenDimensions
      ? Math.max(2, sourceCanvas.width - sourceCanvas.width % 2)
      : sourceCanvas.width;
    recordingCanvas.height = evenDimensions
      ? Math.max(2, sourceCanvas.height - sourceCanvas.height % 2)
      : sourceCanvas.height;
    const context = recordingCanvas.getContext('2d', {
      alpha: transparent,
      desynchronized: true,
    });
    const backgroundCanvas = transparent ? null : createViewerBackgroundCanvas(sourceCanvas);

    const drawFrame = () => {
      if (transparent) context.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);
      else context.drawImage(backgroundCanvas, 0, 0, recordingCanvas.width, recordingCanvas.height);
      context.drawImage(sourceCanvas, 0, 0, recordingCanvas.width, recordingCanvas.height);
      if (transparent) {
        const pixels = context.getImageData(0, 0, recordingCanvas.width, recordingCanvas.height).data;
        let hasTransparency = false, hasModel = false;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] < 255) hasTransparency = true;
          if (pixels[i] > 0) hasModel = true;
        }
        if (!hasTransparency || !hasModel) throw new Error('原生渲染没有提供有效透明模型帧（可能被后期效果填实）。已停止，避免输出伪透明文件。');
      }

    };
    // 先绘制静态首帧，避免编码器取得空白画面。
    if (!transparent) drawFrame();

    return {
      canvas: recordingCanvas,
      width: recordingCanvas.width,
      height: recordingCanvas.height,
      drawFrame,
      cleanup: () => {},
    };
  }

  async function createTabCapture(fps) {
      setStatus('请选择“当前标签页”作为画面来源…', 'countdown');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: fps, max: fps },
          cursor: 'never' as any,
        } as any,
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      } as any);
      const track = stream.getVideoTracks()[0];
      const trackSettings = track?.getSettings?.() || {};
      if (trackSettings.displaySurface && trackSettings.displaySurface !== 'browser') {
        for (const mediaTrack of stream.getTracks()) mediaTrack.stop();
        throw new Error('请选择当前浏览器标签页，不要选择窗口或整个屏幕');
      }
      if (track) track.contentHint = 'detail';
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      try {
        throwIfCancelled();
        await video.play();
        throwIfCancelled();
      } catch (error) {
        video.pause();
        video.srcObject = null;
        for (const mediaTrack of stream.getTracks()) mediaTrack.stop();
        throw error;
      }

      return {
        stream,
        video,
        trackSettings,
        cleanup: () => {
          video.pause();
          video.srcObject = null;
          for (const mediaTrack of stream.getTracks()) mediaTrack.stop();
        },
      };
  }

  async function waitForTabFrame(video) {
    throwIfCancelled();
    if (typeof video.requestVideoFrameCallback !== 'function') {
      throw new Error('当前浏览器不支持共享视频帧同步，请使用最新版 Chrome');
    }
    const task = activeTask;
    await new Promise((resolve, reject) => {
      let frame, timer;
      const finish = (error) => {
        video.cancelVideoFrameCallback(frame);
        clearTimeout(timer);
        task?.cleanups.delete(cancel);
        if (error) reject(error); else resolve(undefined);
      };
      const cancel = () => finish(new DOMException('用户已停止导出', 'AbortError'));
      task?.cleanups.add(cancel);
      timer = setTimeout(() => finish(new Error('等待共享标签页新画面超时，请回到当前标签页')), 15000);
      frame = video.requestVideoFrameCallback(() => finish(undefined));
    });
    throwIfCancelled();
  }

  async function createTabFrameSource(fps, sourceCanvas, sharedCapture = null) {
      const capture = sharedCapture || await createTabCapture(fps);
      const { video, trackSettings } = capture;

      const rawWidth = Math.floor(Number(trackSettings.width) || video.videoWidth || window.innerWidth);
      const rawHeight = Math.floor(Number(trackSettings.height) || video.videoHeight || window.innerHeight);
      const recordingCanvas = document.createElement('canvas');
      recordingCanvas.width = Math.max(2, rawWidth - rawWidth % 2);
      recordingCanvas.height = Math.max(2, rawHeight - rawHeight % 2);
      const context = recordingCanvas.getContext('2d', { alpha: false, desynchronized: true });

      const drawFrame = () => {
        context.drawImage(video, 0, 0, recordingCanvas.width, recordingCanvas.height);

      };
      return {
        canvas: recordingCanvas,
        width: recordingCanvas.width,
        height: recordingCanvas.height,
        drawFrame,
        waitForFrame: () => waitForTabFrame(video),
        cleanup: () => {
          if (!sharedCapture) capture.cleanup();
        },
      };
  }

  async function chooseH264Config(width, height, fps, bitrate) {
    const codecs = ['avc1.640033', 'avc1.4D4033', 'avc1.420033', 'avc1.42E01E'];
    const accelerationModes = ['prefer-hardware', 'no-preference', 'prefer-software'];
    for (const hardwareAcceleration of accelerationModes) {
      for (const codec of codecs) {
        const config: any = {
          codec,
          width,
          height,
          bitrate,
          framerate: fps,
          hardwareAcceleration,
          latencyMode: 'quality',
          avc: { format: 'avc' as any },
        };
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) return support.config;
      }
    }
    throw new Error('当前 Chrome 无法创建所需分辨率的 H.264 编码器');
  }

  // QuickTime PNG codec: lossless RGBA samples, one sample per planned frame.
  // No real-time recorder or wall-clock timestamp is involved in this path.
  function buildAlphaMov(samples, width, height, fps) {
    if (!samples.length || width > 65535 || height > 65535) throw new Error('MOV 尺寸或帧数无效');
    const bytes = (...parts) => {
      const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
      let offset = 0;
      for (const part of parts) { out.set(part, offset); offset += part.length; }
      return out;
    };
    const u32 = (...values) => {
      const out = new Uint8Array(values.length * 4);
      const view = new DataView(out.buffer);
      values.forEach((value, index) => view.setUint32(index * 4, value));
      return out;
    };
    const u16 = value => new Uint8Array([value >>> 8 & 255, value & 255]);
    const str = (value: string) => Uint8Array.from(value, char => char.charCodeAt(0));
    const zero = length => new Uint8Array(length);
    const atom = (type, ...parts) => {
      const data = bytes(...parts);
      return bytes(u32(data.length + 8), str(type), data);
    };
    const full = (type, ...parts) => atom(type, u32(0), ...parts);
    const matrix = u32(65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000);
    const count = samples.length;
    const total = samples.reduce((n, sample) => n + sample.size, 0);
    if (total > 1024 * 1024 * 1024) throw new Error('透明 MOV 超过 1GB 安全上限，请减少圈数或时长后重试');
    const ftyp = atom('ftyp', str('qt  '), u32(0), str('qt  '));
    const mvhd = full('mvhd', u32(0, 0, fps, count, 65536), u16(256), zero(10), matrix, zero(24), u32(2));
    const tkhd = atom('tkhd', u32(3, 0, 0, 1, 0, count), zero(8), zero(8), matrix, u32(width * 65536, height * 65536));
    const mdhd = full('mdhd', u32(0, 0, fps, count), u16(0), u16(0));
    const hdlr = full('hdlr', u32(0), str('vide'), zero(12), str('Video\0'));
    const compressor = zero(32);
    compressor.set(bytes(new Uint8Array([3]), str('PNG')));
    const entry = atom('png ', zero(6), u16(1), zero(16), u16(width), u16(height),
      u32(0x480000, 0x480000, 0), u16(1), compressor, u16(32), u16(65535));
    const stsd = full('stsd', u32(1), entry);
    const stts = full('stts', u32(1, count, 1));
    const stsc = full('stsc', u32(1, 1, count, 1));
    const sizes = new Uint8Array(count * 4);
    const sizesView = new DataView(sizes.buffer);
    samples.forEach((sample, index) => sizesView.setUint32(index * 4, sample.size));
    const stsz = full('stsz', u32(0, count), sizes);
    const stco = full('stco', u32(1, ftyp.length + 8));
    const stbl = atom('stbl', stsd, stts, stsc, stsz, stco);
    const dinf = atom('dinf', full('dref', u32(1), atom('url ', u32(1))));
    const minf = atom('minf', atom('vmhd', u32(1), zero(8)), dinf, stbl);
    const moov = atom('moov', mvhd, atom('trak', tkhd, atom('mdia', mdhd, hdlr, minf)));
    return new Blob([ftyp, u32(total + 8), str('mdat'), ...samples, moov], { type: 'video/quicktime' });
  }

  async function prepareRecording(canvas: any, options: any = {}) {
    const recordingSettings = options.config || settings;
    if (!recordingSettings.recordEnabled && !options.forceRecord) return null;
    if (!options.frameSource) requireCanvasRecording();
    if (recordingSettings.transparentOutput) {
      return {
        ...(options.frameSource || createCanvasFrameSource(canvas, false)),
        format: 'mov', samples: [], sampleBytes: 0, fps: Math.round(recordingSettings.recordingFps),
        started: false, finalized: false, frameIndex: 0,
        outputFilename: options.outputFilename || null, outputTarget: options.outputTarget || null,
      };
    }
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
      throw new Error('当前浏览器没有 WebCodecs 固定帧编码能力');
    }
    if (typeof Mp4Muxer === 'undefined') {
      throw new Error('MP4 封装组件加载失败，请检查网络后刷新页面');
    }

    const fps = Math.round(recordingSettings.recordingFps);
    const source = options.frameSource || (recordingSettings.recordingScope === 'tab'
      ? await createTabFrameSource(fps, canvas, options.tabCapture || null)
      : createCanvasFrameSource(canvas));

    const bitrate = recordingSettings.videoBitrateMbps > 0
      ? Math.round(recordingSettings.videoBitrateMbps * 1_000_000)
      : autoBitrate(source.width, source.height, fps);
    const encoderConfig = await chooseH264Config(source.width, source.height, fps, bitrate);
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: {
        codec: 'avc',
        width: source.width,
        height: source.height,
        frameRate: fps,
      },
      fastStart: 'in-memory',
    });
    const session = {
      ...source,
      target,
      muxer,
      bitrate,
      fps,
      started: false,
      finalized: false,
      frameIndex: 0,
      encoderError: null,
      outputFilename: options.outputFilename || null,
      outputTarget: options.outputTarget || null,
    };
    (session as any).encoder = new VideoEncoder({
      output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
      error: (error) => {
        session.encoderError = error;
        console.error('[Tripo Rotation] H.264 编码失败', error);
      },
    });
    (session as any).encoder.configure(encoderConfig);
    return session;
  }

  function startRecorder(session) {
    if (!session || session.started) return;
    session.started = true;
  }

  async function captureDeterministicFrame(session, alreadyCopied = false) {
    if (!session?.started || session.finalized) return;
    if (!alreadyCopied) session.drawFrame();
    if (session.format === 'mov') {
      const sample: Blob = await new Promise<Blob>((resolve, reject) => session.canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('透明 PNG 帧编码失败')), 'image/png'));
      session.sampleBytes += sample.size;
      if (session.sampleBytes > 1024 * 1024 * 1024) throw new Error('透明 MOV 超过 1GB 安全上限，请减少圈数或时长');
      session.samples.push(sample);
      session.frameIndex += 1;
      return;
    }
    const timestamp = Math.round(session.frameIndex * 1_000_000 / session.fps);
    const nextTimestamp = Math.round((session.frameIndex + 1) * 1_000_000 / session.fps);
    const frame = new VideoFrame(session.canvas, {
      timestamp,
      duration: nextTimestamp - timestamp,
      alpha: 'discard',
    });
    try {
      session.encoder.encode(frame, {
        keyFrame: session.frameIndex % Math.max(1, Math.round(session.fps)) === 0,
      });
    } finally { frame.close(); }
    session.frameIndex += 1;
    if (session.encoder.encodeQueueSize > 8) await (session as any).encoder.flush();
    if (session.encoderError) throw session.encoderError;
  }

  async function finalizeRecording(session, mode, cancelled = false) {
    if (!session || session.finalized) return null;
    session.finalized = true;
    try {
      if (!session.started) return null;
      let blob;
      if (session.format === 'mov') {
        blob = buildAlphaMov(session.samples, session.width, session.height, session.fps);
        session.samples.length = 0;
      } else {
        await session.encoder.flush();
        if (session.encoderError) throw session.encoderError;
        session.encoder.close();
        session.muxer.finalize();
        blob = new Blob([session.target.buffer], { type: 'video/mp4' });
      }
      if (blob.size < 1024) throw new Error('录制文件为空');
      const requestedFilename = session.outputFilename;
      const finalFilename = cancelled && requestedFilename
        ? withStoppedSuffix(requestedFilename)
        : requestedFilename;
      const filename = finalFilename
        ? await saveBlob(blob, finalFilename, session.outputTarget)
        : downloadVideo(blob, session, mode, cancelled);
      setStatus(`视频已保存：${filename}`, 'ready');
      return filename;
    } catch (error) {
      setStatus(`视频保存失败：${error.message}`, 'error');
      console.error('[Tripo Rotation] MP4 保存失败', error);
      return null;
    } finally {
      if (session.encoder && session.encoder.state !== 'closed') session.encoder.close();
      if (session.samples) session.samples.length = 0;
      session.cleanup();
    }
  }

  function pointerEvent(type, x, y, buttons, movementX = 0) {
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      movementX,
      movementY: 0,
      pressure: buttons ? 0.5 : 0,
      width: 1,
      height: 1,
    });
  }

  function dispatchPointer(target, type, x, y, buttons, movementX = 0) {
    target.dispatchEvent(pointerEvent(type, x, y, buttons, movementX));
  }

  function sleep(ms, run = activeTask) {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (run) run.timers.delete(timer);
        resolve(undefined);
      }, ms);
      if (run) run.timers.set(timer, resolve);
    });
  }

  function sanitizeSettingsFromUI() {
    settings.direction = Number(ui.direction.value) === 1 ? 1 : -1;
    settings.pixelsPerTurnRatio = clamp(ui.ratio.value, 0.2, 3, 1);
    settings.uniformTurns = Math.round(clamp(ui.uniformTurns.value, 1, 20, 1));
    settings.uniformDuration = clamp(ui.uniformDuration.value, 0.5, 30, 3);
    settings.transitionTurns = clamp(ui.transitionTurns.value, 0.25, 20, 4);
    settings.accelerationDuration = clamp(ui.acceleration.value, 0.05, 20, 0.65);
    settings.cruiseDuration = clamp(ui.cruise.value, 0, 60, 0.7);
    settings.decelerationDuration = clamp(ui.deceleration.value, 0.05, 20, 0.3);
    settings.countdown = clamp(ui.countdown.value, 0, 10, 2);
    settings.settleDuration = clamp(ui.settle.value, 0, 5, 0.25);
    settings.autoHide = ui.autoHide.checked;
    settings.recordEnabled = ui.recordEnabled.checked;
    settings.recordingScope = ui.recordingScope.value === 'tab' ? 'tab' : 'canvas';
    settings.recordingFps = clamp(ui.recordingFps.value, 15, 120, 60);
    settings.videoBitrateMbps = clamp(ui.videoBitrate.value, 0, 200, 0);
    settings.showAxisInOutput = ui.showAxisInOutput.checked;
    settings.transparentOutput = ui.transparentOutput.checked;
    settings.wireframeWidth = clamp(ui.wireframeWidth.value, 0.25, 8, 1);
    settings.wireframeColor = /^#[0-9a-f]{6}$/i.test(ui.wireframeColor.value)
      ? ui.wireframeColor.value.toLowerCase() : DEFAULTS.wireframeColor;
    settings.wireframeOpacity = clamp(ui.wireframeOpacity.value, 0, 100, 70) / 100;
    settings.studioLighting = ui.studioLighting.checked;
    settings.lightingEnvironment = clamp(ui.lightingEnvironment.value, 0, 3, 1.4);
    settings.lightingDirect = clamp(ui.lightingDirect.value, 0, 3, 1.2);
    settings.lightingExposure = clamp(ui.lightingExposure.value, 0.5, 2, 1.15);
    settings.brightSolid = ui.brightSolid.checked;
    settings.solidLift = clamp(ui.solidLift.value, 0, 1, 0.5);
    saveSettings();
    syncUI();
    applyLightingPreset();
    applySolidLook();
    bindWireframeStyle();
  }

  function syncUI() {
    ui.direction.value = String(settings.direction);
    ui.ratio.value = String(settings.pixelsPerTurnRatio);
    ui.uniformTurns.value = String(settings.uniformTurns);
    ui.uniformDuration.value = String(settings.uniformDuration);
    ui.transitionTurns.value = String(settings.transitionTurns);
    ui.acceleration.value = String(settings.accelerationDuration);
    ui.cruise.value = String(settings.cruiseDuration);
    ui.deceleration.value = String(settings.decelerationDuration);
    ui.countdown.value = String(settings.countdown);
    ui.settle.value = String(settings.settleDuration);
    ui.autoHide.checked = settings.autoHide;
    ui.recordEnabled.checked = settings.recordEnabled;
    ui.recordingScope.value = settings.recordingScope;
    ui.recordingFps.value = String(settings.recordingFps);
    ui.videoBitrate.value = String(settings.videoBitrateMbps);
    ui.showAxisInOutput.checked = settings.showAxisInOutput;
    ui.transparentOutput.checked = settings.transparentOutput;
    ui.wireframeWidth.value = String(settings.wireframeWidth);
    ui.wireframeColor.value = settings.wireframeColor;
    ui.wireframeOpacity.value = String(Math.round(settings.wireframeOpacity * 1000) / 10);
    ui.studioLighting.checked = settings.studioLighting;
    ui.lightingEnvironment.value = String(settings.lightingEnvironment);
    ui.lightingDirect.value = String(settings.lightingDirect);
    ui.lightingExposure.value = String(settings.lightingExposure);
    ui.brightSolid.checked = settings.brightSolid;
    ui.solidLift.value = String(settings.solidLift);
    ui.solidLift.disabled = !settings.brightSolid;
    for (const input of [ui.lightingEnvironment, ui.lightingDirect, ui.lightingExposure]) {
      input.disabled = !settings.studioLighting;
    }
    ui.videoBitrate.disabled = settings.transparentOutput;
    ui.videoBitrate.title = settings.transparentOutput ? '透明 MOV 为无损 PNG 帧，不使用 MP4 码率设置' : '';
  }

  async function takeScreenshot(options: any = {}) {
    throwIfCancelled();
    if (activeRun) {
      setStatus('请先停止当前旋转，再进行截图', 'warning');
      return;
    }
    sanitizeSettingsFromUI();
    const canvas = findViewerCanvas();
    if (!canvas) {
      setStatus('没有找到已加载的模型 Canvas', 'error');
      return;
    }

    let source = null;
    let frameLock = null;
    let restoreAxis = () => {};
    const restorePanel = panelVisible;
    try {
      setStatus('正在准备高清截图…', 'running');
      if (settings.transparentOutput && settings.recordingScope === 'tab') {
        throw new Error('透明导出仅支持“仅模型”范围，标签页录屏不保留 Alpha');
      }
      await applySolidLookWhenReady();
      throwIfCancelled();
      if (settings.recordingScope === 'tab') {
        showPanel(false);
        restoreAxis = hideAxisOverlay(canvas);
        await nextRenderedFrame();
        source = await createTabFrameSource(
          settings.recordingFps,
          canvas,
          options.tabCapture || null
        );
        await source.waitForFrame();
        source.drawFrame();
      } else {
        frameLock = createFrameLock(canvas, options.batchState?.view);
        activeTask?.cleanups.add(frameLock.release);
        source = createCanvasFrameSource(canvas, false);
        await frameLock.capture(0, (signature) => {
          verifyBatchFrame(options.batchState, 'screenshot', 0, signature);
          source.drawFrame();
        });
        frameLock.release();
      }
      throwIfCancelled();
      const blob = await new Promise((resolve, reject) => {
        source.canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error('PNG 编码失败')),
          'image/png',
          1
        );
      });
      throwIfCancelled();
      const filename = options.outputFilename
        ? await saveBlob(blob, options.outputFilename, options.outputTarget)
        : downloadScreenshot(blob, source, settings.recordingScope);
      setStatus(`截图已保存：${filename}`, 'ready');
      return filename;
    } catch (error) {
      throwIfCancelled();
      if (error?.name === 'AbortError') throw error;
      setStatus(`截图失败：${error.message}`, 'error');
      console.error('[Tripo Rotation] 截图失败', error);
      return null;
    } finally {
      if (frameLock) activeTask?.cleanups.delete(frameLock.release);
      frameLock?.release();
      restoreAxis();
      source?.cleanup?.();
      if (restorePanel) showPanel(true);
    }
  }

  function syncProjectNameField() {
    if (!ui?.projectName || shadow.activeElement === ui.projectName) return;
    ui.projectName.value = getProjectName();
    ui.projectName.placeholder = `工程 ID：${currentProjectId().slice(0, 8)}…`;
  }

  function requestProjectName(force = false) {
    const remembered = getProjectName();
    if (remembered && !force) return Promise.resolve(remembered);
    if (pendingProjectName) return pendingProjectName.promise;

    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    pendingProjectName = { promise, resolve: resolvePromise };
    ui.projectNameModal.hidden = false;
    ui.projectNameInput.value = remembered;
    window.setTimeout(() => {
      ui.projectNameInput.focus();
      ui.projectNameInput.select();
    }, 0);
    return promise;
  }

  function finishProjectName(value, skip = false) {
    if (!pendingProjectName) return;
    const pending = pendingProjectName;
    pendingProjectName = null;
    ui.projectNameModal.hidden = true;
    const name = String(value || '').trim();
    if (name && !skip) saveProjectName(name);
    pending.resolve(skip ? `工程-${currentProjectId()}` : name || null);
  }

  function requestBatchCaptureStart() {
    if (pendingBatchStart) return pendingBatchStart.promise;
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    pendingBatchStart = { promise, resolve: resolvePromise };
    ui.batchStartModal.hidden = false;
    return promise;
  }

  function finishBatchCaptureStart(confirmed) {
    if (!pendingBatchStart) return;
    const pending = pendingBatchStart;
    pendingBatchStart = null;
    ui.batchStartModal.hidden = true;
    pending.resolve(Boolean(confirmed));
  }

  function findMaterialButton(materialId) {
    const material = MATERIALS.find((item) => item.id === materialId);
    if (!material) return null;
    return findButtonWithIcon(material.icon);
  }

  async function waitForMaterialButton(material, restoring = false, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!restoring) throwIfCancelled();
      const button = findMaterialButton(material.id);
      if (button?.isConnected && !button.disabled) return button;
      await sleep(100, restoring ? null : activeTask);
    }
    throw new Error(`等待“${material.label}”显示按钮加载超时`);
  }

  async function switchMaterial(material, restoring = false) {
    if (!restoring) throwIfCancelled();
    let button = await waitForMaterialButton(material, restoring);
    if (material.id !== 'solid') restoreSolidLook();
    if (button.getAttribute('aria-pressed') !== 'true' && button.dataset.state !== 'on') {
      button.click();
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(100, restoring ? null : activeTask);
        if (!restoring) throwIfCancelled();
        button = findMaterialButton(material.id) || button;
        if (button.getAttribute('aria-pressed') === 'true' || button.dataset.state === 'on') break;
        if (attempt === 49) throw new Error(`切换到“${material.label}”超时`);
      }
    }
    if (!restoring) await nextRenderedFrame();
    if (!restoring) await nextRenderedFrame();
    await sleep(250, restoring ? null : activeTask);
    if (!restoring) throwIfCancelled();
    await applySolidLookWhenReady(6000, restoring);
    if (!restoring) throwIfCancelled();
    if (toggleIsOn(findWireframeButton())) applyWireframeStyle(true);
  }

  async function switchWireframe(enabled, restoring = false) {
    if (!restoring) throwIfCancelled();
    const button = findWireframeButton();
    if (!button || button.disabled) {
      if (enabled) throw new Error('当前项目不支持线框模式');
      return;
    }
    if (toggleIsOn(button) !== enabled) {
      button.click();
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(100, restoring ? null : activeTask);
        if (!restoring) throwIfCancelled();
        if (toggleIsOn(button) === enabled) break;
        if (attempt === 49) throw new Error(`${enabled ? '开启' : '关闭'}线框模式超时`);
      }
    }
    if (!restoring) await nextRenderedFrame();
    if (!restoring) await nextRenderedFrame();
    await sleep(250, restoring ? null : activeTask);
    if (!restoring) throwIfCancelled();
    if (enabled) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (!restoring) throwIfCancelled();
        if (applyWireframeStyle(false) > 0) { if (!restoring) await nextRenderedFrame(); return; }
        await sleep(100, restoring ? null : activeTask);
      }
      applyWireframeStyle(true);
    }
  }

  async function runExportAction(action) {
    if (exportBusy || batchRunning || activeRun || pendingSave) {
      if (pendingSave) showSaveRecovery(pendingSave);
      return;
    }
    exportBusy = true;
    const task = { cancelled: false, timers: new Map(), frames: new Map(), cleanups: new Set() };
    activeTask = task;
    if (ui.batchMenu) {
      ui.batchMenu.hidden = true;
      ui.batchToggle.setAttribute('aria-expanded', 'false');
    }
    try {
      await action();
    } catch (error) {
      if (error?.name === 'AbortError') { setStatus('已取消导出', 'warning'); return; }
      setStatus(`导出失败：${error.message}`, 'error');
      console.error('[Tripo Rotation] 导出失败', error);
    } finally {
      exportBusy = false;
      if (activeTask === task) activeTask = null;
      if (ui.projectsPage && !ui.projectsPage.hidden) renderProjectLibrary();
    }
  }

  async function handleRotationClick(mode: any) {
    sanitizeSettingsFromUI();
    if (!settings.recordEnabled) {
      await startRotation(mode);
      return;
    }
    if (settings.recordingScope === 'tab') {
      setStatus('整标签页目前仅支持截图；视频请切换为“仅模型画面”', 'warning');
      return;
    }
    const projectName = await requestProjectName();
    if (!projectName) return;
    recordExportRestorePoint(mode);
    throwIfCancelled();
    const material = currentMaterial();
    const wireframe = toggleIsOn(findWireframeButton());
    const filename = buildOutputFilename(mode, projectName, material.label, wireframe);
    try {
      const target = await chooseSingleFile(filename, settings.transparentOutput ? 'video/quicktime' : 'video/mp4');
      await startRotation(mode, { outputFilename: filename, outputTarget: target, material, wireframe });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setStatus(`无法开始导出：${error.message}`, 'error');
        console.error('[Tripo Rotation] 单项视频导出失败', error);
      } else {
        setStatus('已取消保存', 'warning');
      }
    }
  }

  async function handleScreenshotClick() {
    sanitizeSettingsFromUI();
    const projectName = await requestProjectName();
    if (!projectName) return;
    recordExportRestorePoint('screenshot');
    throwIfCancelled();
    const material = currentMaterial();
    const filename = buildOutputFilename('screenshot', projectName, material.label, toggleIsOn(findWireframeButton()));
    let tabCapture = null;
    try {
      const target = await chooseSingleFile(filename, 'image/png');
      throwIfCancelled();
      // The save picker consumes transient user activation. Obtain a fresh click
      // before requesting screen sharing instead of reusing the original click.
      if (settings.recordingScope === 'tab') {
        if (!await requestBatchCaptureStart()) return;
        throwIfCancelled();
        tabCapture = await createTabCapture(settings.recordingFps);
      }
      throwIfCancelled();
      await takeScreenshot({ outputFilename: filename, outputTarget: target, tabCapture });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setStatus(`无法开始截图：${error.message}`, 'error');
        console.error('[Tripo Rotation] 单项截图失败', error);
      } else {
        setStatus('已取消保存', 'warning');
      }
    } finally {
      tabCapture?.cleanup();
    }
  }

  async function snapshotIndependentModel(engine) {
    const projectId = currentProjectId();
    const canvas = findViewerCanvas();
    if (!canvas) throw new Error('请先打开一个已加载的模型');
    const view = snapshotView(findRenderContext(canvas, true));
    const material = currentMaterial();
    const wireframe = toggleIsOn(findWireframeButton());
    // Unknown modes cannot be restored reliably; fail before changing page state.
    if (material.id === 'current') throw new Error('尚未识别当前模型材质，请等待模型加载完成后重试');
    let lock = null;
    const cancelCopy = () => lock?.release();
    activeTask?.cleanups.add(cancelCopy);
    const sameProject = () => currentProjectId() === projectId && canvas.isConnected;
    try {
      setStatus('正在自动准备当前网页模型的贴图与几何数据…', 'running');
      await switchWireframe(false);
      throwIfCancelled();
      if (!sameProject()) throw new Error('当前工程已变化，请重新开始离屏导出');
      await switchMaterial(MATERIALS.find(item => item.id === 'pbr'));
      throwIfCancelled();
      if (!sameProject()) throw new Error('当前工程已变化，请重新开始离屏导出');
      lock = createFrameLock(canvas, view, false);
      await lock.capture(0, () => {
        throwIfCancelled();
        if (!sameProject()) throw new Error('当前工程已变化，请重新开始离屏导出');
        const binding = findRenderContext(canvas, true);
        engine.snapshot(binding, view.target);
      });
    } finally {
      activeTask?.cleanups.delete(cancelCopy);
      lock?.release();
      // Restore immediately after copying, before the independent renderer starts its trajectory.
      if (sameProject()) {
        const failures = [];
        try { await switchMaterial(material, true); } catch (error) { failures.push(error); }
        try { await switchWireframe(wireframe, true); } catch (error) { failures.push(error); }
        try { applyView(findRenderContext(canvas, true), view); } catch (error) { failures.push(error); }
        if (failures.length) throw new Error('恢复网页显示失败：' + failures.map(error => error.message).join('；'));
      }
    }
  }

  async function createIndependentRenderer(size, config) {
    const { IndependentRenderer } = await import('./offscreen/renderer');
    throwIfCancelled();
    return new IndependentRenderer(size, config);
  }

  async function exportIndependent(inputs: (File | string)[] | null = null, options: any = {}) {
    if (!options.config) sanitizeSettingsFromUI();
    const config = { ...(options.config || settings) };
    const jobs: Array<import('./types/settings').ExportItem & { wireframe: boolean }> = options.jobs || planBatchJobs(EXPORT_ITEMS, config, true);
    if (jobs.some(job => job.wireframe)) config.batchWireframeVariants = true;
    if (!jobs.length) throw new Error('请先在导出内容菜单中选择输出项目');
    const size = options.size || Number($('#offscreenSize').value);
    if (![512, 1024, 2048].includes(size)) throw new Error('请选择有效的离屏分辨率');
    const concurrency = config.transparentOutput ? 1 : 3;
    // Checkpointed batches must keep the saved job order across reloads.
    const groups: (typeof jobs)[] = options.checkpointOrder
      ? jobs.reduce((groups, job) => {
        const last = groups[groups.length - 1];
        if (last && last.length < concurrency && last[0].kind === job.kind) last.push(job);
        else groups.push([job]);
        return groups;
      }, []) : groupOffscreenJobs(jobs, concurrency);
    if (!inputs && !findViewerCanvas()) throw new Error('请先打开一个已加载的模型');
    // Request the directory while the initiating click still has user activation.
    const outputTarget = options.outputTarget || (typeof window.showDirectoryPicker === 'function'
      ? { kind: 'directory', handle: await window.showDirectoryPicker({ mode: 'readwrite' }) }
      : { kind: 'download' });
    throwIfCancelled();
    const abort = new AbortController();
    const cancel = () => abort.abort();
    activeTask?.cleanups.add(cancel);
    const sources = inputs || [null];
    let completed = 0;
    let lastFilename = null;
    const check = () => { throwIfCancelled(); options.check?.(); };
    const didSave = async (filename) => {
      if (!filename) throw new Error('离屏文件保存失败');
      check();
      lastFilename = filename;
      completed += 1;
      await options.onSaved?.(filename);
      check();
    };
    try {
      for (let modelIndex = 0; modelIndex < sources.length; modelIndex += 1) {
        throwIfCancelled();
        const source = sources[modelIndex];
        const name = source === null ? (options.projectName || getProjectName() || '当前模型')
          : typeof source === 'string' ? ('GLB-' + (modelIndex + 1)) : source.name.replace(/\.glb$/i, '');
        setStatus('离屏加载 ' + (modelIndex + 1) + '/' + sources.length + ' · ' + name, 'running');
        const engine = await createIndependentRenderer(size, config);
        try {
          check();
          if (source === null) await snapshotIndependentModel(engine);
          else await engine.load(source, abort.signal);
          throwIfCancelled();
          for (const group of groups) {
            throwIfCancelled();
            const kind = group[0].kind;
            const sessions: any[] = [];
            try {
              if (kind !== 'screenshot') {
                for (const job of group) {
                  const frameCanvas = engine.renderer.domElement;
                  const session = await prepareRecording(frameCanvas, { forceRecord: true, config,
                    outputTarget, outputFilename: options.outputFilename || formatOutputFilename(kind, name, job.material.label, config, job.wireframe),
                    frameSource: { canvas: frameCanvas, width: size, height: size, drawFrame() {}, cleanup() {} } });
                  sessions.push(session);
                  startRecorder(session);
                  throwIfCancelled();
                }
              }
              const angles = kind === 'screenshot' ? [0] : makeFramePlan(kind, config).angles;
              await renderFrameBatch(angles, group, {
                check,
                pose: angle => engine.pose(angle),
                capture: async (job, index) => {
                  const canvas = engine.render(job.material.id, job.wireframe);
                  if (kind === 'screenshot') {
                    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
                      value => value ? resolve(value) : reject(new Error('离屏 PNG 编码失败')), 'image/png'));
                    check();
                    await didSave(await saveBlob(blob, options.outputFilename || formatOutputFilename(kind, name, job.material.label, config, job.wireframe), outputTarget));
                  } else {
                    await captureDeterministicFrame(sessions[group.indexOf(job)], true);
                  }
                },
                progress: async index => {
                  if (index % 10 === 0) {
                    setStatus('离屏 ' + (modelIndex + 1) + '/' + sources.length + ' · ' + kind + ' · ' +
                      (index + 1) + '/' + angles.length + ' 帧 · 已保存 ' + completed + ' 文件', 'running');
                    // Yield to input/cancellation without waiting for the page's render loop.
                    await sleep(0);
                  }
                },
              });
              for (const session of sessions) {
                check();
                if (session.frameIndex !== angles.length) throw new Error('离屏编码帧数不完整');
                await didSave(await finalizeRecording(session, kind));
              }
            } finally {
              for (const session of sessions) {
                if (session.encoder && session.encoder.state !== 'closed') session.encoder.close();
                if (session.samples) session.samples.length = 0;
                session.cleanup();
              }
            }
          }
        } finally { engine.dispose(); }
      }
      setStatus('离屏导出完成 · 共保存 ' + completed + ' 个文件', 'ready', true);
      return lastFilename;
    } finally { activeTask?.cleanups.delete(cancel); abort.abort(); }
  }

  async function exportAll() {
    if (batchRunning || activeRun) {
      setStatus('已有导出任务正在运行', 'warning');
      return;
    }
    sanitizeSettingsFromUI();
    // Snapshot the selection once; changes must never reshape an in-flight batch.
    const jobs = plannedExportItems();
    if (!jobs.length) {
      setStatus('请先勾选至少一个导出项目', 'warning');
      return;
    }
    if (settings.recordingScope === 'tab' && jobs.some(job => job.kind !== 'screenshot')) {
      setStatus('整标签页批量导出仅支持截图；请取消勾选视频，或切换为“仅模型画面”', 'warning');
      return;
    }
    const projectName = await requestProjectName();
    if (!projectName) return;
    recordExportRestorePoint('batch', jobs.length);
    throwIfCancelled();

    if (settings.recordingScope === 'canvas') {
      batchRunning = true;
      try { return await exportIndependent(null, { jobs, projectName }); }
      finally { batchRunning = false; }
    }

    let outputTarget: any = { kind: 'download' };
    let tabCapture = null;
    let batchState = null;
    const originalMaterial = currentMaterial();
    const originalWireframe = toggleIsOn(findWireframeButton());
    const restorePanel = panelVisible;
    try {
      const canvas = findViewerCanvas();
      if (!canvas) throw new Error('请先打开一个已加载的模型');
      batchState = { view: snapshotView(findRenderContext(canvas)), signatures: new Map(),
        plans: { uniform: makeFramePlan('uniform', settings), transition: makeFramePlan('transition', settings) } };
      if (typeof window.showDirectoryPicker === 'function') {
        outputTarget = { kind: 'directory', handle: await window.showDirectoryPicker({ mode: 'readwrite' }) };
        throwIfCancelled();
      }
      if (settings.recordingScope === 'tab') {
        const confirmed = await requestBatchCaptureStart();
        if (!confirmed) return;
        throwIfCancelled();
        tabCapture = await createTabCapture(settings.recordingFps);
      }

      throwIfCancelled();
      batchRunning = true;
      showPanel(false);
      let completed = 0;
      const total = jobs.length;
      const progress = (message) => setStatus(`全导出 ${completed}/${total} · ${message}`, 'running');

      for (const { kind, material, wireframe } of jobs) {
        throwIfCancelled();
        const label = EXPORT_KINDS.find(item => item.id === kind).label;
        progress(`正在导出${material.label}${wireframe ? '线框' : ''}${label}…`);
        await switchMaterial(material);
        await switchWireframe(wireframe);
        throwIfCancelled();
        const filename = buildOutputFilename(kind, projectName, material.label, wireframe);
        const options = { forceRecord: true, outputFilename: filename, outputTarget,
          tabCapture, suppressAutoShow: true, restoreAfter: true, batchState };
        const saved = kind === 'screenshot' ? await takeScreenshot(options) : await startRotation(kind, options);
        if (!saved) throw new Error(`${material.label}${wireframe ? '线框' : ''}${label}导出失败`);
        completed += 1;
        throwIfCancelled();
      }

      setStatus(`一键导出完成 · 共保存 ${total} 个文件`, 'ready', true);
    } catch (error) {
      if (error?.name === 'AbortError') {
        setStatus('已取消一键全导出', 'warning');
      } else {
        setStatus(`一键全导出失败：${error.message}`, 'error');
        console.error('[Tripo Rotation] 一键全导出失败', error);
      }
    } finally {
      batchRunning = false;
      tabCapture?.cleanup?.();
      if (originalMaterial.id !== 'current') {
        try { await switchMaterial(originalMaterial, true); } catch (error) {
          console.warn('[Tripo Rotation] 恢复原显示模式失败', error);
        }
      }
      try { await switchWireframe(originalWireframe, true); } catch (error) {
        console.warn('[Tripo Rotation] 恢复原线框状态失败', error);
      }
      if (batchState) {
        try { applyView(findRenderContext(findViewerCanvas()), batchState.view); }
        catch (error) { console.warn('[Tripo Rotation] 恢复批量起始视角失败', error); }
      }
      if (restorePanel) showPanel(true);
    }
  }

  function setStatus(message, tone = 'normal', persistent = false) {
    statusIsSticky = persistent || tone === 'error';
    ui.status.textContent = message;
    ui.status.dataset.tone = tone;
    console.info(`[Tripo Rotation] ${message}`);
  }

  function refreshCanvasStatus() {
    syncProjectNameField();
    if (ui.exportAll && ui.batchMenu) syncBatchSelection();
    bindZoomSlider();
    bindWireframeStyle();
    if (activeRun || batchRunning || exportBusy || pendingSave) return;
    if (settings.studioLighting) applyLightingPreset();
    const solidApplied = applySolidLook();
    if (statusIsSticky) return;
    const canvas = findViewerCanvas() as HTMLElement | null;
    if (!canvas) {
      setStatus('等待模型预览器加载…', 'warning');
      return;
    }
    if (settings.brightSolid && currentMaterial().id === 'solid' && !solidApplied) {
      setStatus('当前白膜材质无法安全提亮，已保留原站画面', 'warning');
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const controls = canvas.dataset.cameraControlsVersion || '未知';
    const engine = canvas.dataset.engine || 'Canvas';
    const recording = settings.recordEnabled
      ? ` · ${settings.transparentOutput ? '透明 MOV' : 'MP4'} ${settings.recordingFps}fps`
      : ' · 不录制';
    setStatus(`已连接 · ${engine} · ${Math.round(rect.width)}×${Math.round(rect.height)}${recording}`, 'ready');
  }

  function showPanel(visible, manual = false) {
    if (manual) visibilityRevision += 1;
    panelVisible = visible;
    ui.panel.hidden = !visible;
    ui.zoomRail.hidden = !visible;
    if (visible) bindZoomSlider();
    const launcher = document.getElementById(`${SCRIPT_ID}-launcher`);
    if (launcher) {
      launcher.setAttribute('aria-expanded', String(visible));
      launcher.setAttribute('data-state', visible ? 'open' : 'closed');
    }
  }

  function ensureLauncher() {
    if (document.getElementById(`${SCRIPT_ID}-launcher`)) return;
    const dcc = [...document.querySelectorAll('header button')]
      .find(button => button.textContent?.includes('DCC Bridge'));
    if (!dcc) return;
    const button = document.createElement('button');
    button.id = `${SCRIPT_ID}-launcher`;
    button.type = 'button';
    button.className = dcc.className;
    button.style.cssText = 'justify-content:center;min-width:100px;';
    button.title = '打开或隐藏 Tripo 旋转助手';
    button.setAttribute('aria-expanded', String(panelVisible));
    button.setAttribute('data-state', panelVisible ? 'open' : 'closed');
    const icon = document.createElement('span');
    icon.textContent = '⟳';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.cssText = 'font-size:16px;line-height:16px;';
    const label = document.createElement('span');
    label.className = 'text-3 c-[#fafafa] leading-4 font-500';
    label.textContent = '旋转助手';
    button.append(icon, label);
    button.addEventListener('click', () => {
      showPanel(!panelVisible, true);
      if (panelVisible) refreshCanvasStatus();
    });
    dcc.after(button);
  }

  function scheduleAutoShow() {
    if (!settings.autoHide) return;
    const expectedRevision = visibilityRevision;
    window.setTimeout(() => {
      if (!activeRun && !batchRunning && !pendingSave && visibilityRevision === expectedRevision) {
        showPanel(true);
        refreshCanvasStatus();
      }
    }, 1000);
  }

  function throwIfCancelled(task = activeTask) {
    if (task?.cancelled) throw new DOMException('用户已停止导出', 'AbortError');
  }

  function stopRotation(reason = '已手动停止') {
    // 保存恢复窗口中的 Blob 必须留在原队列里，停止/切后台不能把它丢掉。
    if (pendingSave) {
      showSaveRecovery(pendingSave);
      return;
    }
    const run = activeRun;
    if (run?.recording?.finalized) return;
    if (activeTask) {
      activeTask.cancelled = true;
      for (const [timer, resolve] of activeTask.timers) { clearTimeout(timer); resolve(); }
      activeTask.timers.clear();
      for (const [frame, resolve] of activeTask.frames) { cancelAnimationFrame(frame); resolve(); }
      activeTask.frames.clear();
      for (const cleanup of activeTask.cleanups) cleanup();
    }
    if (pendingProjectName) finishProjectName(null);
    if (pendingBatchStart) finishBatchCaptureStart(false);
    if (!run) {
      setStatus(reason, 'warning');
      return;
    }

    run.cancelled = true;
    if (run.strictFrames) {
      run.frameLock?.release();
      for (const [timer, resolve] of run.timers) { clearTimeout(timer); resolve(); }
      run.timers.clear();
      setStatus(reason, 'warning');
      return; // The serial owner performs encoder/lock cleanup; never finalize twice.
    }
    if (run.frame) cancelAnimationFrame(run.frame);
    run.cancelAnimation?.();
    for (const [timer, resolve] of run.timers) {
      clearTimeout(timer);
      resolve();
    }
    run.timers.clear();

    if (run.pointerDown) {
      dispatchPointer(document, 'pointerup', run.lastX, run.y, 0, 0);
      run.pointerDown = false;
    }

    activeRun = null;
    setStatus(reason, 'warning');
    void finalizeRecording(run.recording, run.mode, true);
    scheduleAutoShow();
  }

  async function countdown(run) {
    const seconds = Math.ceil(settings.countdown);
    if (seconds <= 0) return true;

    for (let remaining = seconds; remaining > 0; remaining -= 1) {
      if (run.cancelled || activeRun !== run) return false;
      setStatus(`${remaining} 秒后开始…按 Esc 取消`, 'countdown');
      if (settings.autoHide && remaining <= 1) showPanel(false);
      await sleep(1000, run);
    }
    return !run.cancelled && activeRun === run;
  }

  async function nextRenderedFrame(task = activeTask) {
    throwIfCancelled(task);
    await new Promise(resolve => {
      const frame = requestAnimationFrame(() => { task?.frames.delete(frame); resolve(undefined); });
      task?.frames.set(frame, resolve);
    });
    throwIfCancelled(task);
  }

  function verifyBatchFrame(batchState, mode, index, signature) {
    if (!batchState) return;
    const key = `${mode}:${index}`;
    const expected = batchState.signatures.get(key);
    if (expected) assertSignature(signature, expected, `${mode} 第 ${index + 1} 帧跨材质视角`);
    else batchState.signatures.set(key, signature.slice());
  }

  async function animateDrag(run: any, durationMs: number, totalDistance: number, progressAt: (elapsed: number) => number) {
    if (run.recording) throw new Error('禁止通过模拟拖拽录制视频');

    return new Promise((resolve) => {
      const finish = (completed) => {
        run.cancelAnimation = null;
        resolve(completed);
      };
      run.cancelAnimation = () => finish(false);
      const startTime = performance.now();
      let previousDistance = 0;

      const step = (now) => {
        if (run.cancelled || activeRun !== run || !run.canvas.isConnected) {
          finish(false);
          return;
        }

        const elapsedMs = Math.min(durationMs, now - startTime);
        const progress = Math.min(1, Math.max(0, progressAt(elapsedMs / 1000)));
        const distance = totalDistance * progress;
        const delta = distance - previousDistance;
        run.lastX = run.startX + settings.direction * distance;

        dispatchPointer(document, 'pointermove', run.lastX, run.y, 1,
          settings.direction * delta);
        previousDistance = distance;

        if (elapsedMs >= durationMs) {
          finish(true);
          return;
        }
        run.frame = requestAnimationFrame(step);
      };

      run.frame = requestAnimationFrame(step);
    });
  }

  async function captureSettlingFrames(run) {
    if (run.recording) throw new Error('禁止通过缓动等待补齐视频帧');
    await sleep(settings.settleDuration * 1000, run);
  }

  async function restoreViewAfterRotation(canvas: any, totalDistance: number) {
    const rect = canvas.getBoundingClientRect();
    const startX = rect.left + rect.width * 0.5;
    const y = rect.top + rect.height * 0.5;
    const steps = 18;
    let previous = 0;
    dispatchPointer(canvas, 'pointerdown', startX, y, 1, 0);
    try {
      for (let step = 1; step <= steps; step += 1) {
        const distance = totalDistance * step / steps;
        const delta = distance - previous;
        const x = startX - settings.direction * distance;
        dispatchPointer(document, 'pointermove', x, y, 1, -settings.direction * delta);
        previous = distance;
        await nextRenderedFrame();
      }
    } finally {
      dispatchPointer(document, 'pointerup', startX - settings.direction * totalDistance, y, 0, 0);
    }
  }

  async function startRotation(mode: any, options: any = {}) {
    throwIfCancelled();
    if (activeRun) {
      setStatus('旋转正在运行；按 Esc 可停止', 'warning');
      return;
    }

    sanitizeSettingsFromUI();
    if (settings.recordEnabled || options.forceRecord) {
      const material = options.material || currentMaterial();
      if (!MATERIALS.some(item => item.id === material.id)) throw new Error('请等待当前模型材质加载完成');
      const wireframe = options.wireframe ?? toggleIsOn(findWireframeButton());
      return exportIndependent(null, { ...options,
        jobs: [{ kind: mode, key: mode + ':' + material.id, material, wireframe }] });
    }
    const canvas = findViewerCanvas();
    if (!canvas) {
      setStatus('没有找到已加载的模型 Canvas', 'error');
      showPanel(true);
      return;
    }

    await applySolidLookWhenReady();
    throwIfCancelled();

    const rect = canvas.getBoundingClientRect();
    const pixelsPerTurn = rect.height * settings.pixelsPerTurnRatio;
    const run = {
      mode,
      canvas,
      cancelled: false,
      pointerDown: false,
      frame: 0,
      timers: new Map(),
      startX: rect.left + rect.width * 0.5,
      lastX: rect.left + rect.width * 0.5,
      y: rect.top + rect.height * 0.5,
      recording: null,
    };
    activeRun = run;

    try {
      run.recording = await prepareRecording(canvas, options);
    } catch (error) {
      activeRun = null;
      if (!options.suppressAutoShow) showPanel(true);
      setStatus(`无法开始 MP4 录制：${error.message}`, 'error');
      console.error('[Tripo Rotation] 无法开始录制', error);
      return;
    }

    const ready = await countdown(run);
    if (!ready) return;
    if (settings.autoHide && settings.countdown <= 0) showPanel(false);

    startRecorder(run.recording);
    dispatchPointer(canvas, 'pointerdown', run.startX, run.y, 1, 0);
    run.pointerDown = true;

    try {
      let completed = false;
      let totalDistance = 0;
      if (mode === 'uniform') {
      setStatus(`匀速旋转中（${settings.uniformTurns} 圈）…`, 'running');
      const durationSeconds = settings.uniformDuration * settings.uniformTurns;
      const durationMs = durationSeconds * 1000;
      totalDistance = pixelsPerTurn * settings.uniformTurns;
      completed = Boolean(await animateDrag(run, durationMs, totalDistance,
        (elapsed) => elapsed / durationSeconds));
      } else {
      setStatus('加速转场旋转中…', 'running');
      const a = settings.accelerationDuration;
      const c = settings.cruiseDuration;
      const d = settings.decelerationDuration;
      const durationMs = (a + c + d) * 1000;
      totalDistance = pixelsPerTurn * settings.transitionTurns;
      completed = Boolean(await animateDrag(run, durationMs,
        totalDistance,
        (elapsed) => transitionProgress(elapsed, a, c, d)));
      }

      if (!completed || activeRun !== run) return;

      dispatchPointer(document, 'pointerup', run.lastX, run.y, 0, 0);
      run.pointerDown = false;
      setStatus('正在编码停止段…', 'running');
      await captureSettlingFrames(run);

      if (options.restoreAfter) {
        setStatus('正在恢复初始视角…', 'running');
        try {
          await restoreViewAfterRotation(canvas, totalDistance);
        } catch (error) {
          console.warn('[Tripo Rotation] 恢复初始视角失败', error);
        }
      }

      if (activeRun === run) {
        setStatus('正在封装固定帧率 MP4…', 'running');
        const filename = await finalizeRecording(run.recording, run.mode, false);
        activeRun = null;
        if (filename || !run.recording) {
          setStatus(filename ? '旋转完成 · MP4 已保存' : '旋转完成', 'ready', true);
        }
        if (!options.suppressAutoShow) scheduleAutoShow();
        return filename;
      }
    } catch (error) {
      if (run.pointerDown) {
        dispatchPointer(document, 'pointerup', run.lastX, run.y, 0, 0);
        run.pointerDown = false;
      }
      run.cancelled = true;
      if (activeRun === run) activeRun = null;
      await finalizeRecording(run.recording, run.mode, true);
      if (!options.suppressAutoShow) showPanel(true);
      setStatus(`固定帧录制失败：${error.message}`, 'error');
      console.error('[Tripo Rotation] 固定帧录制失败', error);
      return null;
    } finally {
      if (run.pointerDown) {
        dispatchPointer(document, 'pointerup', run.lastX, run.y, 0, 0);
        run.pointerDown = false;
      }
      if (activeRun === run) activeRun = null;
    }
  }

  function handleBeforeUnload(event) {
    if (multiBatchNavigating) return;
    if (exportBusy || batchRunning) { event.preventDefault(); event.returnValue = ''; return; }
    if (activeSaves > 0 || pendingSave || activeRun?.recording?.finalized) {
      event.preventDefault();
      event.returnValue = '';
      return;
    }
    if (activeRun) stopRotation('页面切换，已安全停止');
  }

  const host = document.createElement('div');
  host.id = SCRIPT_ID;
  host.style.cssText = 'all:initial;position:fixed;right:286px;bottom:18px;z-index:2147483646;pointer-events:none;font-family:Inter,"Microsoft YaHei",sans-serif;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      .panel { display:flex; flex-direction:column; max-height:calc(100dvh - 36px); width: 330px; color: #f7f7f8; background: rgba(20,21,25,.94); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; box-shadow: 0 16px 45px rgba(0,0,0,.38); backdrop-filter: blur(16px); overflow: hidden; pointer-events: auto; }
      .panel[hidden] { display: none; }
      .zoom-rail { position:absolute; left:-68px; top:50%; transform:translateY(-50%); width:62px; height:min(460px, calc(100vh - 36px)); display:flex; flex-direction:column; align-items:center; gap:6px; padding:10px 5px; border:1px solid rgba(255,255,255,.12); border-radius:12px; background:rgba(20,21,25,.94); box-shadow:0 10px 28px rgba(0,0,0,.3); color:#f7f7f8; pointer-events:auto; }
      .zoom-rail label { font-size:10px; color:#c8c9d0; }
      .zoom-rail input[type="range"] { appearance:auto; writing-mode:vertical-lr; direction:rtl; flex:1; width:24px; min-width:24px; min-height:0; margin:0; padding:0; border:0; background:transparent; accent-color:#846bff; cursor:pointer; touch-action:none; }
      .zoom-rail .zoom-step { width:28px; height:25px; padding:0; background:#393341; font-size:17px; line-height:1; }
      .zoom-number { display:flex; align-items:center; gap:1px; color:#c8bfff; font-size:10px; }
      .zoom-number input { width:42px; min-width:42px; padding:3px 2px; text-align:center; color:#c8bfff; font-size:10px; }
      header { flex-shrink:0; display:flex; align-items:center; justify-content:space-between; padding:12px 13px 10px; border-bottom:1px solid rgba(255,255,255,.08); }
      h2 { margin:0; font-size:14px; font-weight:700; letter-spacing:.2px; }
      .hint { color:#8d9099; font-size:10px; }
      .body { min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; padding:11px 13px 13px; }
      .status { min-height:31px; display:flex; align-items:center; padding:7px 9px; margin-bottom:10px; border-radius:8px; background:rgba(255,255,255,.055); color:#c7c9cf; font-size:10.5px; line-height:1.4; }
      .status[data-tone="ready"] { color:#91e5b1; }
      .status[data-tone="warning"], .status[data-tone="countdown"] { color:#ffd37a; }
      .status[data-tone="error"] { color:#ff8e8e; }
      .status[data-tone="running"] { color:#b7a7ff; }
      .primary { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px; }
      button { appearance:none; border:0; border-radius:9px; color:#fff; background:#34363d; padding:8px; font:600 11px inherit; cursor:pointer; }
      button:hover { filter:brightness(1.14); }
      button:active { transform:translateY(1px); }
      button.run { background:linear-gradient(135deg,#6953ff,#8a63ff); }
      button.capture { grid-column:1 / -1; background:linear-gradient(135deg,#2479d8,#3ba8e8); }
      button.export-all { grid-column:1 / -1; background:linear-gradient(135deg,#168a63,#24b47e); }
      button.multi-batch { grid-column:1 / -1; background:linear-gradient(135deg,#7652c9,#9b70ed); }
      button.stop { background:#6f3438; }
      details { border-top:1px solid rgba(255,255,255,.075); padding-top:8px; }
      summary { cursor:pointer; color:#cfd0d5; font-size:11px; user-select:none; }
      .grid { display:grid; grid-template-columns:1fr 78px; gap:7px 9px; align-items:center; margin-top:9px; }
      label { color:#aeb0b7; font-size:10.5px; }
      input, select { width:100%; min-width:0; color:#f7f7f8; background:#2b2d33; border:1px solid rgba(255,255,255,.1); border-radius:6px; padding:5px 6px; font:11px inherit; outline:none; }
      input:focus, select:focus { border-color:#806bff; }
      .check { display:flex; align-items:center; gap:6px; grid-column:1 / -1; }
      .check input { width:auto; }
      .project-line { display:grid; grid-template-columns:1fr auto; gap:6px; margin-top:9px; }
      .project-line button { padding:5px 9px; }
      .calibrate { display:grid; grid-template-columns:1fr auto auto; gap:6px; margin-top:9px; }
      .calibrate input { min-width:0; }
      .calibrate button { padding:5px 8px; }
      .note { margin:8px 0 0; color:#a0a2aa; font-size:10.5px; line-height:1.5; }
      #accountForm { display:grid; gap:6px; margin-top:8px; }
      #accountForm input { width:100%; }
      .account-option { display:flex; align-items:center; gap:6px; margin-top:8px; }
      .account-option input { width:auto; }
      footer { display:flex; justify-content:space-between; margin-top:9px; color:#777b85; font-size:9.5px; }
      kbd { padding:1px 4px; border-radius:4px; background:#303239; color:#bbb; font-family:inherit; }
      .modal-layer { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(0,0,0,.58); pointer-events:auto; }
      .modal-layer[hidden] { display:none; }
      .modal-card { width:330px; padding:18px; border:1px solid rgba(255,255,255,.14); border-radius:14px; color:#f7f7f8; background:#18191e; box-shadow:0 22px 70px rgba(0,0,0,.55); }
      .modal-card h3 { margin:0 0 7px; font-size:15px; }
      .modal-card p { margin:0 0 12px; color:#aeb0b7; font-size:11px; line-height:1.55; }
      .modal-card input { padding:8px 9px; }
      .modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
      .modal-actions button.primary-action { background:#725cff; }
      #saveRecoveryInfo { white-space:pre-wrap; overflow-wrap:anywhere; }
      .modal-actions { flex-wrap:wrap; }
      button:disabled { opacity:.5; cursor:wait; }
      [hidden] { display:none !important; }
      .export-split { grid-column:1 / -1; display:flex; gap:1px; }
      .export-split .export-all { flex:1; border-radius:9px 0 0 9px; }
      .export-split .export-toggle { width:32px; border-radius:0 9px 9px 0; background:#168a63; }
      .batch-menu { grid-column:1 / -1; padding:10px 8px; border:1px solid #3d4546; border-radius:8px; background:#22272b; }
      .batch-menu .note { margin:0 0 8px; }
      .batch-wireframe { display:flex; align-items:center; gap:6px; padding:0 0 8px; border-bottom:1px solid #3d4546; color:#dedee3; font-size:10px; }
      .batch-wireframe input { width:auto; margin:0; }
      .batch-wireframe:has(input:disabled) { color:#858892; }
      .batch-row { display:grid; grid-template-columns:76px repeat(3,1fr); gap:5px; align-items:center; margin-top:8px; font-size:10px; }
      .batch-row label { display:flex; align-items:center; gap:3px; color:#dedee3; font-size:10px; }
      .batch-row input { width:auto; margin:0; }
      .projects-heading { display:flex; align-items:center; gap:10px; margin-bottom:10px; font-size:13px; }
      #projectList { max-height:340px; overflow-y:auto; margin-top:10px; display:grid; gap:7px; }
      .project-entry { display:flex; flex-direction:column; align-items:flex-start; gap:5px; text-align:left; }
      .project-entry span { overflow-wrap:anywhere; }
      .project-entry small { color:#aeb0b7; font-size:10px; font-weight:400; }
    </style>
    <section class="panel" hidden>
      <header>
        <h2>Tripo 旋转助手</h2>
        <span class="hint">v${SCRIPT_VERSION} · 默认离屏导出</span>
      </header>
      <div class="body">
        <div class="status">正在连接模型预览器…</div>
        <div id="mainPage">
        <div class="primary">
          <button class="run" id="uniform">匀速旋转</button>
          <button class="run" id="transition">加速转场</button>
          <button class="capture" id="screenshot">截图当前画面</button>
          <div class="export-split">
            <button class="export-all" id="exportAll">导出所选内容（9 项）</button>
            <button class="export-toggle" id="batchToggle" aria-label="选择导出内容" aria-expanded="false" aria-controls="batchMenu">▾</button>
          </div>
          <div class="batch-menu" id="batchMenu" hidden role="group" aria-label="导出内容选择">
            <p class="note">先选要导出的内容，再点绿色按钮开始。选项会自动记住。</p>
          </div>
          <button class="stop" id="stop">立即停止</button>
          <button id="hide">隐藏面板</button>
          <details class="capture" style="grid-column:1 / -1">
            <summary>离屏导出设置 / 高级来源</summary>
            <p class="note">默认视频及“仅模型画面”批量导出均使用离屏渲染，直接读取当前模型，无需链接。匀速旋转 / 加速转场导出当前材质；绿色按钮导出勾选内容。网页仅在复制模型时临时切换材质，旋转在离屏完成。</p>
            <label for="offscreenSize">输出分辨率</label>
            <select id="offscreenSize"><option value="512">512 × 512</option><option value="1024" selected>1024 × 1024</option><option value="2048">2048 × 2048</option></select>
            <details>
              <summary>高级：导入本地 GLB / 外部直链（可选）</summary>
            <label for="offscreenFiles">本地 GLB（支持多选，不上传）</label>
            <input id="offscreenFiles" type="file" accept=".glb" multiple>
            <button id="offscreenLocal" type="button">批量导出所选 GLB</button>
            <label for="offscreenUrls">HTTPS GLB 直链（每行一个，需支持跨域）</label>
            <textarea id="offscreenUrls" rows="3" style="width:100%;box-sizing:border-box" placeholder="https://…/model.glb"></textarea>
            <button id="offscreenRemote" type="button">导出外部直链模型</button>
            </details>
            <p class="note">支持普通 / Meshopt GLB、内嵌贴图。单文件最多 256MB。GLB 自动居中取景；当前模型保留观察目标。线框固定为 WebGL 细线。透明 MOV 为控制内存逐材质导出。Esc 可取消。</p>
          </details>
          <button class="capture" id="checkFrameEntry">检查录制功能</button>
          <button class="capture" id="openProjects">已命名项目</button>
          <button class="multi-batch" id="multiBatchStart">多个项目批量导出</button>
          <button id="multiBatchCancel" hidden>取消批量导出</button>
          <p class="note" id="multiBatchStatus">先在模型卡片上勾选项目。每个项目需先导出一次，保存视角后才能批量处理。</p>
        </div>
        <details id="restorePointsDetails">
          <summary>已保存的导出视角 <span class="hint" id="restorePointCount">0 个</span></summary>
          <button id="recordRestorePoint" type="button">保存当前视角</button>
          <div id="restorePointList"></div>
          <p class="note">导出时会自动保存视角和设置，可用于多个项目批量导出或补导文件。</p>
        </details>
        <details open>
          <summary>录制与截图输出</summary>
          <div class="project-line">
            <input id="projectName" type="text" placeholder="给当前项目命名（可选）" title="名称按网址中的工程 UUID 分别记忆，允许重名">
            <button id="renameProject">改名</button>
          </div>
          <div class="grid">
            <label class="check"><input id="recordEnabled" type="checkbox">导出离屏视频（关闭后仅网页旋转预览）</label>
            <label for="recordingScope">输出范围</label>
            <select id="recordingScope">
              <option value="canvas">仅模型画面</option>
              <option value="tab">整个当前标签页</option>
            </select>
            <label for="recordingFps">帧率（FPS）</label>
            <input id="recordingFps" type="number" min="15" max="120" step="1" list="fpsOptions">
            <datalist id="fpsOptions"><option value="24"><option value="25"><option value="30"><option value="50"><option value="60"></datalist>
            <label for="videoBitrate">视频码率（Mbps，0 为自动）</label>
            <input id="videoBitrate" type="number" min="0" max="200" step="1">
            <label class="check"><input id="showAxisInOutput" type="checkbox">输出中显示右上角坐标轴</label>
            <label class="check"><input id="transparentOutput" type="checkbox">关闭背景 · 透明 MOV / PNG</label>
            <p class="note">透明背景只支持“仅模型画面”。MOV 画质无损，但文件较大、导出较慢；每段最多 1 GB。</p>
          </div>
          <p class="note">视频默认由独立离屏渲染器逐帧生成，网页模型不跟随旋转。导出时可以切换标签页，但请勿刷新或关闭 Tripo；如果浏览器暂停绘制，回来后会继续。批量导出不同材质共用起始视角及离屏模型。“整个当前标签页”目前只支持截图；视频请选择“仅模型画面”。</p>
        </details>
        <details>
          <summary>线框样式</summary>
          <div class="grid">
            <label for="wireframeWidth">线条粗细（px）</label>
            <input id="wireframeWidth" type="number" min="0.25" max="8" step="0.25">
            <label for="wireframeColor">线条颜色</label>
            <input id="wireframeColor" type="color">
            <label for="wireframeOpacity">透明度（%）</label>
            <input id="wireframeOpacity" type="number" min="0" max="100" step="1">
            <button id="resetWireframeStyle" type="button">恢复 Tripo 默认线框</button>
          </div>
        </details>
        <details>
          <summary>光照效果</summary>
          <div class="grid">
            <label class="check"><input id="studioLighting" type="checkbox">改善模型光照（关闭可恢复）</label>
            <label for="lightingEnvironment">环境光倍率</label>
            <input id="lightingEnvironment" type="number" min="0" max="3" step="0.05">
            <label for="lightingDirect">现有灯光倍率</label>
            <input id="lightingDirect" type="number" min="0" max="3" step="0.05">
            <label for="lightingExposure">曝光倍率</label>
            <input id="lightingExposure" type="number" min="0.5" max="2" step="0.05">
          </div>
          <p class="note">棚拍光照会调整环境光、灯光和曝光，对白膜材质可能不起作用。要提亮白膜，请使用下方选项。</p>
          <div class="grid">
            <label class="check"><input id="brightSolid" type="checkbox">提亮白膜（仅对白膜生效）</label>
            <label for="solidLift">提亮幅度（0–1）</label>
            <input id="solidLift" type="number" min="0" max="1" step="0.05">
          </div>
        </details>
        <details>
          <summary>参数与校准</summary>
          <div class="grid">
            <label for="direction">旋转方向</label>
            <select id="direction"><option value="-1">顺时针</option><option value="1">逆时针</option></select>
            <label for="uniformTurns">匀速圈数</label>
            <input id="uniformTurns" type="number" min="1" max="20" step="1">
            <label for="uniformDuration">匀速每圈时长（秒）</label>
            <input id="uniformDuration" type="number" min="0.5" max="30" step="0.1">
            <label for="transitionTurns">转场总圈数</label>
            <input id="transitionTurns" type="number" min="0.25" max="20" step="0.25">
            <label for="acceleration">加速时间（秒）</label>
            <input id="acceleration" type="number" min="0.05" max="20" step="0.05">
            <label for="cruise">高速持续时间（秒）</label>
            <input id="cruise" type="number" min="0" max="60" step="0.1">
            <label for="deceleration">减速时间（秒）</label>
            <input id="deceleration" type="number" min="0.05" max="20" step="0.05">
            <label for="countdown">启动倒计时（秒）</label>
            <input id="countdown" type="number" min="0" max="10" step="1">
            <label for="settle">结束后停留（秒）</label>
            <input id="settle" type="number" min="0" max="5" step="0.1">
            <label class="check"><input id="autoHide" type="checkbox">旋转开始时自动隐藏面板</label>
          </div>
          <div class="calibrate">
            <input id="ratio" type="number" min="0.2" max="3" step="0.01" placeholder="旋转灵敏度" aria-label="旋转灵敏度" title="调整鼠标拖动旋转时的灵敏度">
            <button id="minus" title="一圈距离减少 1%">−1%</button>
            <button id="plus" title="一圈距离增加 1%">+1%</button>
          </div>
        </details>
        <details id="accountDetails">
          <summary>账号登录 / 刷新会话</summary>
          <form id="accountForm">
            <label for="accountEmail">邮箱</label>
            <input id="accountEmail" type="email" autocomplete="username" required aria-label="账号邮箱">
            <label for="accountPassword">密码</label>
            <input id="accountPassword" type="password" autocomplete="current-password" required aria-label="账号密码">
            <div class="primary">
              <button id="accountLogin" type="submit">登录</button>
              <button id="accountRefresh" type="button">刷新会话</button>
            </div>
          </form>
          <label class="account-option"><input id="accountRemember" type="checkbox">记住账号密码（仅本浏览器）</label>
          <label class="account-option"><input id="accountKeepAlive" type="checkbox">会话失效时自动登录</label>
          <p class="note">勾选“记住账号密码”后，密码会以明文保存在 Tripo 的本地存储，同站点代码可以读取。自动登录需要保持浏览器和至少一个 Tripo 页面开启。</p>
          <div class="primary">
            <button id="accountSave" type="button">保存设置</button>
            <button id="accountClear" type="button">清除账号密码</button>
          </div>
          <p class="note" id="accountStatus" role="status" aria-live="polite">自动登录默认关闭。输入账号密码后可直接登录，或保存账号以便自动登录。</p>
        </details>
        <footer>
          <span><kbd>Alt+1</kbd> 匀速旋转　<kbd>Alt+2</kbd> 转场　<kbd>Alt+S</kbd> 截图</span>
          <span><kbd>Alt+H</kbd> 面板　<kbd>Esc</kbd> 停止</span>
        </footer>
        </div>
        <div id="projectsPage" hidden>
          <div class="projects-heading"><button id="backProjects">← 返回</button><span>已命名项目</span></div>
          <input id="projectSearch" type="search" placeholder="搜索名称或 ID" aria-label="搜索已命名项目">
          <div id="projectList"></div>
          <p class="note">这里只显示你在本浏览器里命名过的项目。点击项目即可切换；导出或保存文件时不能切换。</p>
        </div>
      </div>
    </section>
    <div class="modal-layer" id="projectNameModal" hidden>
      <div class="modal-card">
        <h3>命名当前工程</h3>
        <p>项目名称可以不填。不命名时会使用项目 ID 作为文件名。名称会保存在本浏览器中，不同项目可以重名。</p>
        <input id="projectNameInput" type="text" maxlength="80" placeholder="例如：风车">
        <div class="modal-actions">
          <button id="projectNameCancel">取消</button>
          <button id="projectNameSkip">跳过命名</button>
          <button class="primary-action" id="projectNameConfirm">确认并继续</button>
        </div>
      </div>
    </div>
    <div class="modal-layer" id="batchStartModal" hidden>
      <div class="modal-card">
        <h3>准备共享标签页</h3>
        <p>你选择了“整个当前标签页”。点击“开始共享”，再从浏览器弹窗中选择当前标签页即可。一次任务只需选择一次；取消或停止后，导出也会停止。</p>
        <div class="modal-actions">
          <button id="batchStartCancel">取消</button>
          <button class="primary-action" id="batchStartConfirm">开始共享</button>
        </div>
      </div>
    </div>
    <div class="modal-layer" id="saveRecoveryModal" hidden role="dialog" aria-modal="true" aria-labelledby="saveRecoveryTitle">
      <div class="modal-card">
        <h3 id="saveRecoveryTitle">文件保存失败 · 导出已暂停</h3>
        <p id="saveRecoveryInfo"></p>
        <div class="modal-actions">
          <button id="saveRetry">重试保存</button>
          <button class="primary-action" id="saveAs">另存为</button>
          <button id="saveDiscard">放弃并终止</button>
        </div>
      </div>
    </div>
    <aside class="zoom-rail" id="zoomRail" hidden aria-label="模型精细缩放">
      <label for="zoomRange">缩放</label>
      <button class="zoom-step" id="zoomIn" type="button" title="放大 1%">+</button>
      <input id="zoomRange" type="range" min="25" max="400" step="0.1" value="100" orient="vertical" aria-label="模型缩放百分比" disabled>
      <button class="zoom-step" id="zoomOut" type="button" title="缩小 1%">−</button>
      <div class="zoom-number"><input id="zoomValue" type="number" min="25" max="400" step="0.1" aria-label="模型缩放百分比" disabled><span>%</span></div>
    </aside>`;

  document.documentElement.appendChild(host);

  // Keep native scrolling inside the panel and prevent bubbling into viewer zoom handlers.
  shadow.addEventListener('wheel', event => event.stopPropagation(), { passive: true });

  const $ = (selector) => shadow.querySelector(selector);
  ui = {
    panel: $('.panel'),
    zoomRail: $('#zoomRail'), zoomRange: $('#zoomRange'), zoomValue: $('#zoomValue'),
    zoomIn: $('#zoomIn'), zoomOut: $('#zoomOut'),
    status: $('.status'),
    direction: $('#direction'),
    ratio: $('#ratio'),
    uniformTurns: $('#uniformTurns'),
    uniformDuration: $('#uniformDuration'),
    transitionTurns: $('#transitionTurns'),
    acceleration: $('#acceleration'),
    cruise: $('#cruise'),
    deceleration: $('#deceleration'),
    countdown: $('#countdown'),
    settle: $('#settle'),
    autoHide: $('#autoHide'),
    recordEnabled: $('#recordEnabled'),
    recordingScope: $('#recordingScope'),
    recordingFps: $('#recordingFps'),
    videoBitrate: $('#videoBitrate'),
    showAxisInOutput: $('#showAxisInOutput'),
    transparentOutput: $('#transparentOutput'),
    wireframeWidth: $('#wireframeWidth'), wireframeColor: $('#wireframeColor'),
    wireframeOpacity: $('#wireframeOpacity'),
    studioLighting: $('#studioLighting'),
    lightingEnvironment: $('#lightingEnvironment'),
    lightingDirect: $('#lightingDirect'),
    lightingExposure: $('#lightingExposure'),
    brightSolid: $('#brightSolid'),
    solidLift: $('#solidLift'),
    projectName: $('#projectName'),
    projectNameModal: $('#projectNameModal'),
    projectNameInput: $('#projectNameInput'),
    batchStartModal: $('#batchStartModal'),
    saveRecoveryModal: $('#saveRecoveryModal'),
    saveRecoveryInfo: $('#saveRecoveryInfo'),
    saveRetry: $('#saveRetry'),
    saveAs: $('#saveAs'),
    saveDiscard: $('#saveDiscard'),
    mainPage: $('#mainPage'), projectsPage: $('#projectsPage'),
    projectSearch: $('#projectSearch'), projectList: $('#projectList'),
    exportAll: $('#exportAll'), batchMenu: $('#batchMenu'), batchToggle: $('#batchToggle'),
    multiBatchStart: $('#multiBatchStart'), multiBatchCancel: $('#multiBatchCancel'),
    multiBatchStatus: $('#multiBatchStatus'), restorePointList: $('#restorePointList'),
    restorePointCount: $('#restorePointCount'),
  };

  mountAuthControls(shadow, () => Boolean(exportBusy || batchRunning || activeRun || pendingSave || activeSaves));
  syncUI();
  syncProjectNameField();
  initializeBatchMenu();
  renderRestorePoints();
  renderMultiBatchStatus();
  injectAssetCheckboxes();
  $('#openProjects').addEventListener('click', () => showProjectLibrary(true));
  $('#backProjects').addEventListener('click', () => showProjectLibrary(false));
  ui.projectSearch.addEventListener('input', renderProjectLibrary);
  ui.batchToggle.addEventListener('click', () => {
    if (projectSwitchBlocked()) return;
    syncBatchSelection();
    ui.batchMenu.hidden = !ui.batchMenu.hidden;
    ui.batchToggle.setAttribute('aria-expanded', String(!ui.batchMenu.hidden));
  });
  $('#uniform').addEventListener('click', () => void runExportAction(() => handleRotationClick('uniform')));
  $('#transition').addEventListener('click', () => void runExportAction(() => handleRotationClick('transition')));
  $('#screenshot').addEventListener('click', () => void runExportAction(handleScreenshotClick));
  $('#offscreenLocal').addEventListener('click', () => void runExportAction(async () => {
    const files = Array.from($('#offscreenFiles').files || []) as File[];
    if (!files.length) throw new Error('请先选择一个或多个 GLB 文件');
    await exportIndependent(files);
  }));
  $('#offscreenRemote').addEventListener('click', () => void runExportAction(async () => {
    const urls = $('#offscreenUrls').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(glbUrl);
    if (!urls.length) { await exportIndependent(); return; }
    await exportIndependent(urls);
  }));
  $('#exportAll').addEventListener('click', () => void runExportAction(exportAll));
  ui.multiBatchStart.addEventListener('click', () => void runExportAction(startMultiProjectBatch));
  ui.multiBatchCancel.addEventListener('click', () => void cancelMultiProjectBatch());
  $('#recordRestorePoint').addEventListener('click', recordManualRestorePoint);
  $('#stop').addEventListener('click', () => stopRotation());
  $('#hide').addEventListener('click', () => showPanel(false, true));
  $('#checkFrameEntry').addEventListener('click', () => void runExportAction(checkFrameEntry));
  $('#renameProject').addEventListener('click', () => void requestProjectName(true));
  ui.projectName.addEventListener('change', () => {
    if (ui.projectName.value.trim()) saveProjectName(ui.projectName.value);
  });
  $('#projectNameConfirm').addEventListener('click', () => finishProjectName(ui.projectNameInput.value));
  $('#projectNameCancel').addEventListener('click', () => finishProjectName(null));
  $('#projectNameSkip').addEventListener('click', () => finishProjectName(null, true));
  ui.projectNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finishProjectName(ui.projectNameInput.value);
    if (event.key === 'Escape') finishProjectName(null);
  });
  $('#batchStartConfirm').addEventListener('click', () => finishBatchCaptureStart(true));
  $('#batchStartCancel').addEventListener('click', () => finishBatchCaptureStart(false));
  ui.saveRetry.addEventListener('click', () => void resumePendingSave(false));
  ui.saveAs.addEventListener('click', () => void resumePendingSave(true));
  ui.saveDiscard.addEventListener('click', discardPendingSave);
  ui.zoomRange.addEventListener('pointerdown', () => { zoomDragging = true; });
  const finishZoomDrag = () => { if (zoomDragging) { zoomDragging = false; syncZoomSlider(); } };
  ui.zoomRange.addEventListener('change', finishZoomDrag);
  ui.zoomRange.addEventListener('pointercancel', finishZoomDrag);
  window.addEventListener('pointerup', finishZoomDrag);
  ui.zoomRange.addEventListener('input', () => setFineZoom(ui.zoomRange.value));
  ui.zoomIn.addEventListener('click', () => stepFineZoom(1));
  ui.zoomOut.addEventListener('click', () => stepFineZoom(-1));
  ui.zoomValue.addEventListener('change', () => {
    if (ui.zoomValue.value.trim()) setFineZoom(ui.zoomValue.value);
    ui.zoomValue.blur();
    syncZoomSlider();
  });
  ui.zoomValue.addEventListener('blur', syncZoomSlider);
  $('#resetWireframeStyle').addEventListener('click', () => {
    if (zoomLocked()) return;
    settings.wireframeWidth = DEFAULTS.wireframeWidth;
    settings.wireframeColor = DEFAULTS.wireframeColor;
    settings.wireframeOpacity = DEFAULTS.wireframeOpacity;
    saveSettings(); syncUI(); bindWireframeStyle();
    setStatus('已恢复 Tripo 默认线框样式', 'ready');
  });
  $('#minus').addEventListener('click', () => {
    sanitizeSettingsFromUI();
    settings.pixelsPerTurnRatio = Math.max(0.2, settings.pixelsPerTurnRatio * 0.99);
    saveSettings(); syncUI(); setStatus('一圈距离已减少 1%', 'ready');
  });
  $('#plus').addEventListener('click', () => {
    sanitizeSettingsFromUI();
    settings.pixelsPerTurnRatio = Math.min(3, settings.pixelsPerTurnRatio * 1.01);
    saveSettings(); syncUI(); setStatus('一圈距离已增加 1%', 'ready');
  });

  shadow.addEventListener('change', () => {
    if (exportBusy || batchRunning || activeRun || pendingSave) { syncUI(); return; }
    sanitizeSettingsFromUI();
  });

  document.addEventListener('keydown', (event) => {
    const target = event.composedPath?.()[0] || event.target;
    const editableTarget = target instanceof HTMLElement ? target : null;
    const editing = editableTarget && (editableTarget.matches('input, textarea, select') || editableTarget.isContentEditable);

    if (event.key === 'Escape' && (activeRun || activeTask || batchRunning)) {
      event.preventDefault();
      stopRotation();
      return;
    }
    if (editing || !event.altKey) return;

    if (event.code === 'Digit1') {
      event.preventDefault();
      void runExportAction(() => handleRotationClick('uniform'));
    } else if (event.code === 'Digit2') {
      event.preventDefault();
      void runExportAction(() => handleRotationClick('transition'));
    } else if (event.code === 'KeyH') {
      event.preventDefault();
      showPanel(!panelVisible, true);
      if (!panelVisible) return;
      refreshCanvasStatus();
    } else if (event.code === 'KeyS') {
      event.preventDefault();
      void runExportAction(handleScreenshotClick);
    }
  }, true);

  document.addEventListener('visibilitychange', () => {
    // Strict capture owns visibility handling, retaining the same pending frame.
    // Only the non-recording mouse-drag preview still stops on backgrounding.
    if (document.hidden && activeRun && !activeRun.strictFrames && !pendingSave && !activeRun.recording?.finalized) {
      stopRotation('页面进入后台，已安全停止');
    }
  });

  window.addEventListener('beforeunload', handleBeforeUnload);

  refreshCanvasStatus();
  ensureLauncher();
  canvasStatusTimer = window.setInterval(refreshCanvasStatus, 2500);
  window.setTimeout(() => void continueMultiProjectBatch(), 500);
  let assetRefreshTimer = 0;
  if (typeof MutationObserver !== 'undefined' && document.body) {
    new MutationObserver(() => {
      ensureLauncher();
      window.clearTimeout(assetRefreshTimer);
      assetRefreshTimer = window.setTimeout(() => { injectAssetCheckboxes(); renderMultiBatchStatus(); }, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }
}
