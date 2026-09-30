import type { ExportKind } from '../types/settings';

/** GLB files must be self-contained: loading a local model never fetches sidecar URLs. */
export function inspectGlb(data: ArrayBuffer): void {
  const view = new DataView(data);
  if (data.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength ||
      view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('需要有效的 GLB 2.0 文件');
  }
  const length = view.getUint32(12, true);
  if (length > data.byteLength - 20) throw new Error('GLB JSON 数据不完整');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, length)));
  for (const entry of [...(json.buffers || []), ...(json.images || [])]) {
    if (entry.uri && !/^data:/i.test(entry.uri)) throw new Error('请导出内嵌贴图和缓冲区的 GLB；不支持外部依赖');
  }
  const unsupported = (json.extensionsUsed || []).filter((name: string) =>
    ['KHR_draco_mesh_compression', 'KHR_texture_basisu'].includes(name));
  if (unsupported.length) throw new Error(`暂不支持 ${unsupported.join('、')}，请使用普通或 Meshopt GLB`);
}

export function glbUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('请输入 HTTPS GLB 直链');
  return url.href;
}

/** Group by trajectory, with bounded encoder concurrency (wireframe doubles variants). */
export function groupOffscreenJobs<T extends { kind: ExportKind }>(jobs: readonly T[], limit = 3): T[][] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid encoder limit');
  const groups: T[][] = [];
  for (const kind of ['screenshot', 'uniform', 'transition'] as const) {
    const matching = jobs.filter(job => job.kind === kind);
    for (let index = 0; index < matching.length; index += limit) groups.push(matching.slice(index, index + limit));
  }
  return groups;
}

/** Exactly one camera update per angle; copies/encodes a pass before changing its material. */
export async function renderFrameBatch<T>(angles: readonly number[], variants: readonly T[], hooks: {
  check(): void;
  pose(angle: number): void;
  capture(variant: T, index: number): Promise<void>;
  progress(index: number): Promise<void>;
}): Promise<void> {
  for (let index = 0; index < angles.length; index += 1) {
    hooks.check();
    hooks.pose(angles[index]);
    for (const variant of variants) {
      hooks.check();
      await hooks.capture(variant, index);
    }
    await hooks.progress(index);
  }
}
