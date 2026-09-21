import { meetsMinimumVersion } from './version';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

const RUNTIME_GATE_URL = 'https://raw.githubusercontent.com/Ben8368/tripo-model-rotation/master/runtime-status.json';
export async function ensureRuntimeAvailable(version: string): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = window.setTimeout(() => controller?.abort(), 6000);
  try {
    const url = `${RUNTIME_GATE_URL}?cacheBust=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller?.signal ?? null,
    });
    if (!response.ok) return false;
    const status: unknown = await response.json();
    return isRecord(status) && status.service === 'tripo-model-rotation' && status?.enabled === true &&
      meetsMinimumVersion(version, status.minimumVersion);
  } catch (error) {
    console.warn('[Tripo Rotation] 运行许可检查失败，脚本未启动', error);
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
