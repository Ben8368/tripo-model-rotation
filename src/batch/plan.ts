import type { ExportKey } from '../types/settings';

export interface BatchItem {
  key: ExportKey;
}

export interface BatchSelection {
  batchItems: readonly ExportKey[];
  batchWireframeVariants: boolean;
}

export interface BatchJob extends BatchItem {
  wireframe: boolean;
}

export function selectedBatchItems<T extends BatchItem>(
  items: readonly T[], selectedKeys: readonly ExportKey[],
): T[] {
  const selected = new Set(selectedKeys);
  return items.filter(item => selected.has(item.key));
}

export function planBatchJobs<T extends BatchItem>(
  items: readonly T[], settings: BatchSelection, wireframeAvailable: boolean,
): BatchJob[] {
  const selected = selectedBatchItems(items, settings.batchItems);
  return selected.flatMap(item => settings.batchWireframeVariants && wireframeAvailable
    ? [{ ...item, wireframe: false }, { ...item, wireframe: true }]
    : [{ ...item, wireframe: false }]);
}