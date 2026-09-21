import { startApp } from './app.js';
import { ensureRuntimeAvailable } from './runtime/runtime-gate';

async function main(): Promise<void> {
  // Cached userscripts must pass the release policy on every page load.
  if (!await ensureRuntimeAvailable(__SCRIPT_VERSION__)) return;
  startApp(__SCRIPT_VERSION__);
}

void main();
