export type RecordingScope = 'canvas' | 'tab';
export type RotationMode = 'uniform' | 'transition';
export type MaterialId = 'solid' | 'pbr' | 'normal';
export type ExportKind = 'screenshot' | RotationMode;
export type ExportKey = `${ExportKind}:${MaterialId}`;

export interface Material {
  id: MaterialId;
  label: string;
  icon: string;
}

export interface ExportItem {
  key: ExportKey;
  kind: ExportKind;
  material: Material;
}

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
  wireframeWidth: number;
  wireframeColor: string;
  wireframeOpacity: number;
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

export interface ExportRestorePoint {
  id: string;
  projectId: string;
  url: string;
  projectName?: string;
  createdAt: string;
  kind: ExportKind | 'manual' | 'batch';
  itemCount?: number;
  cameraType?: string;
  canvasCssSize?: readonly [number, number];
  slider?: { mode: 'dolly' | 'zoom'; baseline: number; percent: number; metric: number } | null;
  view: Record<string, unknown>;
  settings: Partial<Settings>;
}

export interface SelectedProjectAsset {
  projectId: string;
  url: string;
  label?: string;
}

export interface MultiProjectBatchSession {
  id: string;
  status: 'running' | 'paused' | 'cancelled';
  startedAt: string;
  points: ExportRestorePoint[];
  itemKeys: ExportKey[];
  includeWireframe: boolean;
  settings: Settings;
  pointIndex: number;
  jobIndex: number;
  /** Frozen job list for the current project, retained across reloads. */
  activeJobs?: Array<{ key: ExportKey; wireframe: boolean }> | null;
  completedFiles: number;
  error: string;
}
