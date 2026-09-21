export function meetsMinimumVersion(current: unknown, minimum: unknown): boolean {
  const parse = (value: unknown): number[] | null => {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
    const parts = value.split('.').map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
  };
  const installed = parse(current);
  const required = parse(minimum);
  if (!installed || !required) return false;
  for (let index = 0; index < installed.length; index += 1) {
    if (installed[index] !== required[index]) return installed[index] > required[index];
  }
  return true;
}
