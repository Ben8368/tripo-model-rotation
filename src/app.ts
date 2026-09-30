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
      const point: ExportRestorePoint = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        projectId: currentProjectId(), url: validProjectUrl(location.href, currentProjectId()) || location.href,
        projectName: getProjectName(), createdAt: new Date().toISOString(), kind, itemCount,
        cameraType: binding.camera.type, canvasCssSize: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height],
        view: view as unknown as Record<string, unknown>, settings: structuredClone(settings),
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
      syncUI(); syncBatchSelection(); applyLightingPreset(); applySolidLook(); binding.manager.invalidate();
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
          try { syncUI(); syncBatchSelection(); applyLightingPreset(); applySolidLook(); }
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
      const jobs = session.activeJobs;
      const originalMaterial = currentMaterial();
      const originalWireframe = toggleIsOn(findWireframeButton());
      const batchState = { view, signatures: new Map(), plans: { uniform: makeFramePlan('uniform', settings), transition: makeFramePlan('transition', settings) } };
      batchRunning = true; showPanel(false);
      try {
        while (session.jobIndex < jobs.length) {
          const job = jobs[session.jobIndex];
          const item = EXPORT_ITEMS.find(candidate => candidate.key === job.key);
          if (!item) throw new Error('批量文件配置无效');
          setStatus(`工程 ${session.pointIndex + 1}/${session.points.length} · 文件 ${session.jobIndex + 1}/${jobs.length} · ${item.material.label}${job.wireframe ? '线框' : ''}`, 'running');
          const beforeJob = loadMultiBatchSession();
          if (!beforeJob || beforeJob.id !== session.id || beforeJob.status !== 'running') throw new Error('跨工程批量任务已取消');
          await switchMaterial(item.material); await switchWireframe(job.wireframe);
          const filename = formatOutputFilename(item.kind, point.projectName || `工程-${point.projectId.slice(0, 8)}`, item.material.label, settings, job.wireframe);
          const options = { forceRecord: true, outputFilename: filename, outputTarget: { kind: 'directory', handle: directory }, suppressAutoShow: true, restoreAfter: true, batchState };
          const saved = item.kind === 'screenshot' ? await takeScreenshot(options) : await startRotation(item.kind, options);
          if (!saved) throw new Error(`${filename} 导出失败`);
          const afterJob = loadMultiBatchSession();
          if (!afterJob || afterJob.id !== session.id || afterJob.status !== 'running') throw new Error('跨工程批量任务已取消');
          session = afterJob;
          session.jobIndex += 1; session.completedFiles += 1; persistMultiBatchSession(session);
        }
      } finally {
        await switchMaterial(originalMaterial, true).catch(() => {}); await switchWireframe(originalWireframe, true).catch(() => {});
        try { applyView(binding, view); binding.manager.invalidate(); } catch {}
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

  // 白膜常用 Matcap；原站 HDRI 强度对它可能无效。只对当前白膜模型的
  // 内建受光材质做屏幕空间的中间调提亮，黑位与白位保持不变；线框材质不参与。
  function isSolidSurfaceMaterial(material) {
    if (!material || material.wireframe || !material.color || typeof material.clone !== 'function') return false;
    if (!(material.isMeshMatcapMaterial || material.isMeshStandardMaterial ||
          material.isMeshPhongMaterial || material.isMeshLambertMaterial)) return false;
    const { r, g, b } = material.color;
    return Math.min(r, g, b) >= 0.65 && Math.max(r, g, b) - Math.min(r, g, b) < 0.15;
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
          const clone = material.clone();
          const originalCompile = material.onBeforeCompile;
          const originalProgramKey = material.customProgramCacheKey?.() || '';
          clone.onBeforeCompile = function (shader, renderer) {
            originalCompile?.call(this, shader, renderer);
            const anchor = '#include <dithering_fragment>';
            if (!shader.fragmentShader.includes(anchor)) return;
            shader.fragmentShader = shader.fragmentShader.replace(anchor,
              `vec3 tripoSolidBase = clamp(gl_FragColor.rgb, 0.0, 1.0);\n` +
              `gl_FragColor.rgb = clamp(tripoSolidBase + ${strength} * tripoSolidBase * (1.0 - tripoSolidBase), 0.0, 1.0);\n${anchor}`);
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
        if (strict) throw new Error('未找到可调整的白膜材质；已保留原站画面');
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

  function createFrameLock(canvas, initialView = null) {
    const binding = findRenderContext(canvas, true);
    const { controls, renderer, manager, scene, camera } = binding;
    const view = initialView || snapshotView(binding);
    const originalEnabled = controls.enabled;
    const originalRender = renderer.render;
    const transparent = Boolean(settings.transparentOutput);
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
    if (!settings.recordEnabled && !options.forceRecord) return null;
    requireCanvasRecording();
    if (settings.transparentOutput) {
      return {
        ...createCanvasFrameSource(canvas, false),
        format: 'mov', samples: [], sampleBytes: 0, fps: Math.round(settings.recordingFps),
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

    const fps = Math.round(settings.recordingFps);
    const source = settings.recordingScope === 'tab'
      ? await createTabFrameSource(fps, canvas, options.tabCapture || null)
      : createCanvasFrameSource(canvas);

    const bitrate = settings.videoBitrateMbps > 0
      ? Math.round(settings.videoBitrateMbps * 1_000_000)
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
      if (settings.recordingScope === 'tab') {
        applySolidLook(true);
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
        applySolidLook(true);
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

  async function switchMaterial(material, restoring = false) {
    if (!restoring) throwIfCancelled();
    const button = findMaterialButton(material.id);
    if (!button) throw new Error(`没有找到“${material.label}”显示按钮`);
    if (material.id !== 'solid') restoreSolidLook();
    if (button.getAttribute('aria-pressed') !== 'true' && button.dataset.state !== 'on') {
      button.click();
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(100, restoring ? null : activeTask);
        if (!restoring) throwIfCancelled();
        if (button.getAttribute('aria-pressed') === 'true' || button.dataset.state === 'on') break;
        if (attempt === 49) throw new Error(`切换到“${material.label}”超时`);
      }
    }
    if (!restoring) await nextRenderedFrame();
    if (!restoring) await nextRenderedFrame();
    await sleep(250, restoring ? null : activeTask);
    if (!restoring) throwIfCancelled();
    applySolidLook(true);
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
    const filename = buildOutputFilename(mode, projectName, material.label, toggleIsOn(findWireframeButton()));
    try {
      const target = await chooseSingleFile(filename, settings.transparentOutput ? 'video/quicktime' : 'video/mp4');
      await startRotation(mode, { outputFilename: filename, outputTarget: target });
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
    button.style.cssText = 'justify-content:center;min-width:140px;';
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

  async function startStrictRotation(mode, canvas, options) {
    requireCanvasRecording();
    applySolidLook(true);
    const config = { ...settings };
    const plan = options.batchState?.plans[mode] || makeFramePlan(mode, config);
    const run = { mode, canvas, strictFrames: true, cancelled: false,
      frame: 0, timers: new Map(), recording: null, frameLock: null };
    activeRun = run;
    let success = false;
    try {
      run.frameLock = createFrameLock(canvas, options.batchState?.view);
      run.recording = await prepareRecording(canvas, options);
      throwIfCancelled();
      if (run.recording.fps !== plan.fps) throw new Error('批量导出期间帧率设置发生变化');
      if (!await countdown(run)) return null;
      if (config.autoHide) showPanel(false);
      startRecorder(run.recording);
      for (let index = 0; index < plan.angles.length; index += 1) {
        if (run.cancelled || activeRun !== run) throw new Error('用户已停止录制');
        await run.frameLock.capture(plan.angles[index], (signature) => {
          verifyBatchFrame(options.batchState, mode, index, signature);
          run.recording.drawFrame();
        });
        if (run.cancelled) throw new Error('用户已停止录制');
        await captureDeterministicFrame(run.recording, true);
        if (index % 30 === 0) setStatus(`严格逐帧 ${index + 1}/${plan.angles.length} · ${plan.fps}fps`, 'running');
      }
      throwIfCancelled();
      if (run.recording.frameIndex !== plan.angles.length) throw new Error('编码输入帧数与轨迹帧数不一致');
      // Verify and show the endpoint without encoding an extra duplicate frame.
      await run.frameLock.capture(options.restoreAfter ? 0 : plan.endAngle, () => {});
      run.frameLock.release();
      setStatus('帧数与视角检查通过，正在封装视频…', 'running');
      throwIfCancelled();
      const filename = await finalizeRecording(run.recording, mode);
      success = Boolean(filename);
      if (success) setStatus(`严格逐帧完成 · ${plan.angles.length} 帧 · ${plan.fps}fps`, 'ready', true);
      return filename;
    } catch (error) {
      if (run.cancelled || error?.name === 'AbortError') throw new DOMException('用户已停止导出', 'AbortError');
      setStatus(`逐帧导出已停止：${error.message}（未保存不完整视频）`, 'error');
      console.error('[Tripo Rotation] 严格逐帧导出失败', error);
      return null;
    } finally {
      if (run.frameLock) {
        if (!success) {
          try { run.frameLock.restore(); } catch (error) { console.warn('[Tripo Rotation] 恢复视角失败', error); }
        }
        run.frameLock.release();
      }
      if (run.recording && !run.recording.finalized) {
        if (run.recording.encoder && run.recording.encoder.state !== 'closed') run.recording.encoder.close();
        if (run.recording.samples) run.recording.samples.length = 0;
        run.recording.cleanup();
      }
      if (activeRun === run) activeRun = null;
      if (!options.suppressAutoShow) {
        if (success) scheduleAutoShow();
        else showPanel(true);
      }
    }
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
    const canvas = findViewerCanvas();
    if (!canvas) {
      setStatus('没有找到已加载的模型 Canvas', 'error');
      showPanel(true);
      return;
    }

    applySolidLook(true);

    if (settings.recordEnabled || options.forceRecord) {
      return startStrictRotation(mode, canvas, options);
    }

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
      .panel { width: 330px; color: #f7f7f8; background: rgba(20,21,25,.94); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; box-shadow: 0 16px 45px rgba(0,0,0,.38); backdrop-filter: blur(16px); overflow: hidden; pointer-events: auto; }
      .panel[hidden] { display: none; }
      header { display:flex; align-items:center; justify-content:space-between; padding:12px 13px 10px; border-bottom:1px solid rgba(255,255,255,.08); }
      h2 { margin:0; font-size:14px; font-weight:700; letter-spacing:.2px; }
      .hint { color:#8d9099; font-size:10px; }
      .body { padding:11px 13px 13px; }
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
        <span class="hint">v${SCRIPT_VERSION} · 明亮白膜</span>
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
            <label class="check"><input id="recordEnabled" type="checkbox">旋转时自动录制视频</label>
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
          <p class="note">视频会逐帧记录模型画面，旋转角度更准确。导出时可以切换标签页，但请勿刷新或关闭 Tripo；如果浏览器暂停绘制，回来后会继续。批量导出不同材质时会使用相同起始视角。“整个当前标签页”目前只支持截图；视频请选择“仅模型画面”。</p>
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
    </div>`;

  document.documentElement.appendChild(host);

  const $ = (selector) => shadow.querySelector(selector);
  ui = {
    panel: $('.panel'),
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
