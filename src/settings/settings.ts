import type { Settings, ExportKey } from '../types/settings';
import { EXPORT_ITEMS } from './catalog';
import { clamp } from '../utils/numbers';

type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

export const DEFAULT_SETTINGS: Readonly<Omit<Settings, 'batchItems'>> & { readonly batchItems: readonly ExportKey[] } = Object.freeze({
  configVersion: 7,
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
  recordingFps: 60,
  videoBitrateMbps: 0,
  showAxisInOutput: false,
  transparentOutput: false,
  batchItems: Object.freeze([...EXPORT_ITEMS.map(item => item.key)]),
  batchWireframeVariants: false,
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
    recordEnabled: boolean('recordEnabled'),
    recordingScope: source.recordingScope === 'tab' ? 'tab' : DEFAULT_SETTINGS.recordingScope,
    recordingFps: number('recordingFps', 15, 120),
    videoBitrateMbps: number('videoBitrateMbps', 0, 200),
    showAxisInOutput: boolean('showAxisInOutput'),
    transparentOutput: boolean('transparentOutput'),
    batchItems,
    batchWireframeVariants: boolean('batchWireframeVariants'),
    studioLighting: boolean('studioLighting'),
    lightingEnvironment: number('lightingEnvironment', 0, 3),
    lightingDirect: number('lightingDirect', 0, 3),
    lightingExposure: number('lightingExposure', 0.5, 2),
    brightSolid: boolean('brightSolid'),
    solidLift: number('solidLift', 0, 1),
  };
}
