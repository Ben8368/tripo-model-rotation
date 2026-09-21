import type { ExportItem, ExportKind, Material } from '../types/settings';

export const MATERIALS: readonly Material[] = Object.freeze([
  { id: 'solid', label: '白膜', icon: 'solid.png' },
  { id: 'pbr', label: '贴图', icon: 'pbr.png' },
  { id: 'normal', label: '法线', icon: 'normal.png' },
] as const);
export const EXPORT_KINDS: readonly { readonly id: ExportKind; readonly label: string }[] = Object.freeze([
  { id: 'screenshot', label: '单帧截图' },
  { id: 'uniform', label: '匀速圈' },
  { id: 'transition', label: '加速转场' },
] as const);
export const EXPORT_ITEMS: readonly ExportItem[] = Object.freeze(EXPORT_KINDS.flatMap(kind => MATERIALS.map(material =>
  Object.freeze({ key: `${kind.id}:${material.id}` as const, kind: kind.id, material }))));
