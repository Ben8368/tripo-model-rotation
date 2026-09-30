import type {
  ExportItem, ExportKey, ExportRestorePoint, MultiProjectBatchSession,
  SelectedProjectAsset, Settings,
} from '../types/settings';
import { validProjectUrl } from '../projects/project-url';
import { EXPORT_ITEMS } from '../settings/catalog';

export function parseRestorePoints(value: string | null): Record<string, ExportRestorePoint[]> {
  if (!value?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, ExportRestorePoint[]> = {};
    for (const [projectId, points] of Object.entries(parsed)) {
      if (!Array.isArray(points)) throw new Error('invalid restore-point list');
      result[projectId] = points.filter(point => point && typeof point === 'object' &&
        typeof (point as ExportRestorePoint).id === 'string' &&
        typeof (point as ExportRestorePoint).projectId === 'string' &&
        (point as ExportRestorePoint).projectId === projectId &&
        validProjectUrl((point as ExportRestorePoint).url, projectId) &&
        typeof (point as ExportRestorePoint).createdAt === 'string' &&
        (point as ExportRestorePoint).view && typeof (point as ExportRestorePoint).view === 'object');
    }
    return result;
  } catch { return {}; }
}

/** Fail closed on writes: malformed non-empty storage must never be replaced by an empty map. */
export function restorePointsForWrite(value: string | null): Record<string, ExportRestorePoint[]> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error('还原点数据格式无效；为避免覆盖已有记录，已停止导出'); }
  const structurallyValid = parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
    Object.entries(parsed as Record<string, unknown>).every(([projectId, points]) => Array.isArray(points) &&
      points.every(point => {
        if (!point || typeof point !== 'object' || Array.isArray(point)) return false;
        const value = point as ExportRestorePoint;
        return typeof value.id === 'string' && Boolean(value.id.trim()) && value.projectId === projectId &&
          Boolean(validProjectUrl(value.url, projectId)) && typeof value.createdAt === 'string' &&
          Boolean(value.view && typeof value.view === 'object' && !Array.isArray(value.view));
      }));
  if (!structurallyValid) {
    throw new Error('还原点数据格式无效；为避免覆盖已有记录，已停止导出');
  }
  return parsed as Record<string, ExportRestorePoint[]>;
}

export function parseSelectedAssets(value: string | null): SelectedProjectAsset[] {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Record<string, unknown>;
      const projectId = typeof candidate.projectId === 'string' ? candidate.projectId : '';
      const url = validProjectUrl(candidate.url, projectId);
      if (!projectId || !url) return [];
      return [{ projectId, url, label: typeof candidate.label === 'string' ? candidate.label : undefined }];
    });
  } catch { return []; }
}

export function flattenRestorePoints(store: Record<string, ExportRestorePoint[]>): ExportRestorePoint[] {
  return Object.values(store).flat().filter(point => validProjectUrl(point.url, point.projectId))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export function planMultiProjectJobs(
  items: readonly ExportItem[], itemKeys: readonly ExportKey[], includeWireframe: boolean,
): Array<{ key: ExportKey; wireframe: boolean }> {
  const selected = new Set(itemKeys);
  return items.filter(item => selected.has(item.key)).flatMap(item => includeWireframe
    ? [{ key: item.key, wireframe: false }, { key: item.key, wireframe: true }]
    : [{ key: item.key, wireframe: false }]);
}

export function preserveCheckboxState(checked: boolean, apply: (checked: boolean) => void): void {
  apply(checked);
}

export function runRestoreTransaction<T>(apply: () => T, rollback: () => void,
  logRollbackFailure: (error: unknown) => void = error => console.error('[Tripo Rotation] restore rollback failed', error)): T {
  try { return apply(); }
  catch (error) {
    try { rollback(); } catch (rollbackError) { logRollbackFailure(rollbackError); }
    throw error;
  }
}

export async function cancelMultiProjectSession(
  session: MultiProjectBatchSession,
  persistCancelled: (session: MultiProjectBatchSession) => void,
  stop: () => void,
  removeSession: () => void,
  removeDirectory: (id: string) => Promise<unknown>,
): Promise<void> {
  session.status = 'cancelled';
  persistCancelled(session);
  stop();
  removeSession();
  await removeDirectory(session.id);
}

export async function completeMultiProjectSession(
  session: MultiProjectBatchSession,
  removeSession: () => void,
  removeDirectory: (id: string) => Promise<unknown>,
): Promise<void> {
  await removeDirectory(session.id);
  removeSession();
}

export function createMultiProjectSession(
  id: string, points: readonly ExportRestorePoint[], itemKeys: readonly ExportKey[],
  settings: Settings, includeWireframe: boolean, startedAt = new Date().toISOString(),
): MultiProjectBatchSession {
  return { id, status: 'running', startedAt, points: [...points], itemKeys: [...itemKeys],
    includeWireframe, settings: structuredClone(settings), pointIndex: 0, jobIndex: 0,
    activeJobs: null, completedFiles: 0, error: '' };
}

export function parseMultiProjectSession(value: string | null): MultiProjectBatchSession | null {
  try {
    const candidate: unknown = JSON.parse(value || 'null');
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const session = candidate as MultiProjectBatchSession;
    const validKey = (key: unknown): key is ExportKey => typeof key === 'string' &&
      /^(screenshot|uniform|transition):(solid|pbr|normal)$/.test(key);
    const validPoint = (point: unknown): point is ExportRestorePoint => {
      if (!point || typeof point !== 'object' || Array.isArray(point)) return false;
      const value = point as ExportRestorePoint;
      return typeof value.id === 'string' && Boolean(value.id.trim()) &&
        typeof value.projectId === 'string' && Boolean(value.projectId.trim()) &&
        Boolean(validProjectUrl(value.url, value.projectId)) &&
        Boolean(value.view && typeof value.view === 'object' && !Array.isArray(value.view));
    };
    const validJobs = session.activeJobs === undefined || session.activeJobs === null ||
      (Array.isArray(session.activeJobs) && session.activeJobs.every(job => job && validKey(job.key) && typeof job.wireframe === 'boolean'));
    if (typeof session.id !== 'string' || !session.id.trim() ||
        !['running', 'paused', 'cancelled'].includes(session.status) ||
        !Array.isArray(session.points) || !session.points.length || !session.points.every(validPoint) ||
        !Array.isArray(session.itemKeys) || !session.itemKeys.length || !session.itemKeys.every(validKey) ||
        !session.settings || typeof session.settings !== 'object' || Array.isArray(session.settings) ||
        !Number.isInteger(session.pointIndex) || session.pointIndex < 0 || session.pointIndex > session.points.length ||
        !Number.isInteger(session.jobIndex) || session.jobIndex < 0 || session.jobIndex > session.itemKeys.length * 2 ||
        !Number.isInteger(session.completedFiles) || session.completedFiles < 0 ||
        typeof session.includeWireframe !== 'boolean' || !validJobs ||
        (session.activeJobs && session.jobIndex > session.activeJobs.length)) return null;
    if (session.activeJobs === undefined && session.jobIndex > 0) {
      // Older TypeScript sessions stored only the index. Reconstruct the exact
      // pre-capability-filter plan so the persisted index still names the same job.
      const activeJobs = planMultiProjectJobs(EXPORT_ITEMS, session.itemKeys, session.includeWireframe);
      if (session.jobIndex > activeJobs.length) return null;
      return { ...session, activeJobs };
    }
    return session;
  } catch { return null; }
}
