import type {
  ExportItem, ExportKey, ExportRestorePoint, MultiProjectBatchSession,
  SelectedProjectAsset, Settings,
} from '../types/settings';
import { validProjectUrl } from '../projects/project-url';

export function parseRestorePoints(value: string | null): Record<string, ExportRestorePoint[]> {
  try {
    const parsed: unknown = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, ExportRestorePoint[]> = {};
    for (const [projectId, points] of Object.entries(parsed)) {
      if (!Array.isArray(points)) continue;
      result[projectId] = points.filter(point => point && typeof point === 'object' &&
        typeof (point as ExportRestorePoint).id === 'string' &&
        typeof (point as ExportRestorePoint).projectId === 'string' &&
        (point as ExportRestorePoint).projectId === projectId &&
        (point as ExportRestorePoint).view && typeof (point as ExportRestorePoint).view === 'object');
    }
    return result;
  } catch { return {}; }
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

export function createMultiProjectSession(
  id: string, points: readonly ExportRestorePoint[], itemKeys: readonly ExportKey[],
  settings: Settings, includeWireframe: boolean, startedAt = new Date().toISOString(),
): MultiProjectBatchSession {
  return { id, status: 'running', startedAt, points: [...points], itemKeys: [...itemKeys],
    includeWireframe, settings: structuredClone(settings), pointIndex: 0, jobIndex: 0,
    completedFiles: 0, error: '' };
}

export function parseMultiProjectSession(value: string | null): MultiProjectBatchSession | null {
  try {
    const candidate: unknown = JSON.parse(value || 'null');
    if (!candidate || typeof candidate !== 'object') return null;
    const session = candidate as MultiProjectBatchSession;
    if (!['running', 'paused', 'cancelled'].includes(session.status) ||
        !Array.isArray(session.points) || !Array.isArray(session.itemKeys) ||
        !Number.isInteger(session.pointIndex) || !Number.isInteger(session.jobIndex)) return null;
    return session;
  } catch { return null; }
}
