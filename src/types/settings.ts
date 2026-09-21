export type RecordingScope = 'canvas' | 'tab';
export type RotationMode = 'uniform' | 'transition';
export type MaterialId = 'solid' | 'pbr' | 'normal';
export type ExportKind = 'screenshot' | RotationMode;
export type ExportKey = `${ExportKind}:${MaterialId}`;

export interface Settings {
  configVersion: number;
  direction: -1 | 1;
  pixelsPerTurnRatio: number;
  uniformTurns: number;
  uniformDuration: number;
  transitionTurns: number;
  accelerationDuration: number;
  cruiseDuration: number;
  decelerationDuration: number;
  countdown: number;
  settleDuration: number;
  autoHide: boolean;
  recordEnabled: boolean;
  recordingScope: RecordingScope;
  recordingFps: number;
  videoBitrateMbps: number;
  showAxisInOutput: boolean;
  transparentOutput: boolean;
  batchItems: ExportKey[];
  batchWireframeVariants: boolean;
  studioLighting: boolean;
  lightingEnvironment: number;
  lightingDirect: number;
  lightingExposure: number;
  brightSolid: boolean;
  solidLift: number;
}

export interface FramePlan {
  fps: number;
  angles: readonly number[];
  endAngle: number;
  movingFrames: number;
}
