import type { Settings, ExportKey } from '../types/settings';
import { EXPORT_ITEMS } from './catalog';
import { clamp } from '../utils/numbers';

type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

export const DEFAULT_SETTINGS: Readonly<Omit<Settings, 'batchItems'>> & { readonly batchItems: readonly ExportKey[] } = Object.freeze({
  configVersion: 9,
  direction: -1,
  pixelsPerTurnRatio: 1,
  uniformTurns: 1,
  uniformDuration: 3,
  transitionTurns: 4,
  accelerationDuration: 0.65,
  cruiseDuration: 0.7,
  decelerationDuration: 0.3,
  countdown: 2,
  settleDuration: 0.25,
  autoHide: true,
  recordEnabled: true,
  recordingScope: 'canvas',
  offscreenSize: 1024,
  recordingFps: 60,
  videoBitrateMbps: 0,
  showAxisInOutput: false,
  transparentOutput: true,
  batchItems: Object.freeze([...EXPORT_ITEMS.map(item => item.key)]),
  batchWireframeVariants: false,
  wireframeWidth: 1,
  wireframeColor: '#000000',
  wireframeOpacity: 0.7,
  studioLighting: false,
  lightingEnvironment: 1.4,
  lightingDirect: 1.2,
  lightingExposure: 1.15,
  brightSolid: false,
  solidLift: 0.5,
});

export function normalizeSettings(candidate: unknown): Settings {
  const source = candidate && typeof candidate === 'object'
    ? candidate as Record<string, unknown>
    : {};
  const number = (key: KeysOfType<Settings, number>, min: number, max: number): number =>
    clamp(source[key], min, max, DEFAULT_SETTINGS[key]);
  const boolean = (key: KeysOfType<Settings, boolean>): boolean => {
    const value = source[key];
    return typeof value === 'boolean' ? value : DEFAULT_SETTINGS[key];
  };
  const validExportKeys = new Set<string>(EXPORT_ITEMS.map(item => item.key));
  const batchItems = Array.isArray(source.batchItems)
    ? [...new Set(source.batchItems.filter((key): key is ExportKey =>
      typeof key === 'string' && validExportKeys.has(key)))]
    : [...DEFAULT_SETTINGS.batchItems];

  return {
    ...DEFAULT_SETTINGS,
    configVersion: DEFAULT_SETTINGS.configVersion,
    direction: Number(source.direction) === 1 ? 1 : DEFAULT_SETTINGS.direction,
    pixelsPerTurnRatio: number('pixelsPerTurnRatio', 0.2, 3),
    uniformTurns: Math.round(number('uniformTurns', 1, 20)),
    uniformDuration: number('uniformDuration', 0.5, 30),
    transitionTurns: number('transitionTurns', 0.25, 20),
    accelerationDuration: number('accelerationDuration', 0.05, 20),
    cruiseDuration: number('cruiseDuration', 0, 60),
    decelerationDuration: number('decelerationDuration', 0.05, 20),
    countdown: number('countdown', 0, 10),
    settleDuration: number('settleDuration', 0, 5),
    autoHide: boolean('autoHide'),
    recordEnabled: true,
    recordingScope: 'canvas',
    offscreenSize: [512, 1024, 2048].includes(Number(source.offscreenSize))
      ? Number(source.offscreenSize) as Settings['offscreenSize'] : DEFAULT_SETTINGS.offscreenSize,
    recordingFps: number('recordingFps', 15, 120),
    videoBitrateMbps: number('videoBitrateMbps', 0, 200),
    showAxisInOutput: false,
    // All exports use transparent PNG frames in a MOV container. Legacy values
    // remain in storage only so old restore points can still be parsed.
    transparentOutput: true,
    batchItems,
    batchWireframeVariants: boolean('batchWireframeVariants'),
    wireframeWidth: number('wireframeWidth', 0.25, 8),
    wireframeColor: typeof source.wireframeColor === 'string' && /^#[0-9a-f]{6}$/i.test(source.wireframeColor)
      ? source.wireframeColor.toLowerCase() : DEFAULT_SETTINGS.wireframeColor,
    wireframeOpacity: number('wireframeOpacity', 0, 1),
    studioLighting: boolean('studioLighting'),
    lightingEnvironment: number('lightingEnvironment', 0, 3),
    lightingDirect: number('lightingDirect', 0, 3),
    lightingExposure: number('lightingExposure', 0.5, 2),
    brightSolid: boolean('brightSolid'),
    solidLift: number('solidLift', 0, 1),
  };
}
