import type { ExportKind, Settings } from '../types/settings';

export function safeFilenamePart(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '') || '未命名工程';
}

export function formatOutputFilename(
  kind: ExportKind, projectName: unknown, materialLabel: unknown,
  settings: Pick<Settings, 'uniformTurns' | 'transparentOutput'>, wireframe = false,
): string {
  const project = safeFilenamePart(projectName);
  const material = `${safeFilenamePart(materialLabel)}${wireframe ? '-线框' : ''}`;
  if (kind === 'screenshot') return `${project}-单帧-${material}.png`;
  if (kind === 'uniform') {
    return `${project}-匀速圈（圈数${settings.uniformTurns}）-${material}.${settings.transparentOutput ? 'mov' : 'mp4'}`;
  }
  return `${project}-转场-${material}.${settings.transparentOutput ? 'mov' : 'mp4'}`;
}
