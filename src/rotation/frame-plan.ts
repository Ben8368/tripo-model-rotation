import type { FramePlan, RotationMode, Settings } from '../types/settings';

function accelerationArea(x: number): number {
  return 0.25 * x * x * x * x;
}

function decelerationArea(x: number): number {
  return 0.25 * (1 - Math.pow(1 - x, 4));
}

export function transitionProgress(
  elapsed: number,
  acceleration: number,
  cruise: number,
  deceleration: number,
): number {
  const totalArea = acceleration * 0.25 + cruise + deceleration * 0.25;
  if (elapsed <= acceleration) {
    const x = acceleration > 0 ? elapsed / acceleration : 1;
    return acceleration * accelerationArea(x) / totalArea;
  }
  if (elapsed <= acceleration + cruise) {
    return (acceleration * 0.25 + elapsed - acceleration) / totalArea;
  }
  const decelElapsed = Math.min(deceleration, elapsed - acceleration - cruise);
  const x = deceleration > 0 ? decelElapsed / deceleration : 1;
  return (acceleration * 0.25 + cruise + deceleration * decelerationArea(x)) / totalArea;
}

export function makeFramePlan(mode: RotationMode, config: Settings): FramePlan {
  const fps = Math.round(config.recordingFps);
  const duration = mode === 'uniform'
    ? config.uniformDuration * config.uniformTurns
    : config.accelerationDuration + config.cruiseDuration + config.decelerationDuration;
  const count = Math.max(1, Math.round(duration * fps));
  const hold = Math.max(0, Math.round(config.settleDuration * fps));
  const turns = mode === 'uniform' ? config.uniformTurns : config.transitionTurns;
  const endAngle = -config.direction * 2 * Math.PI * turns;
  const angles: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const elapsed = duration * index / count;
    const progress = mode === 'uniform'
      ? index / count
      : transitionProgress(elapsed, config.accelerationDuration, config.cruiseDuration, config.decelerationDuration);
    angles.push(endAngle * progress);
  }
  for (let index = 0; index < hold; index += 1) angles.push(endAngle);
  return Object.freeze({
    fps,
    angles: Object.freeze(angles),
    endAngle,
    movingFrames: count,
  });
}
