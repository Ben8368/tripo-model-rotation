import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const header = (await readFile(new URL('../src/userscript.meta.txt', import.meta.url), 'utf8')).replace(/\r\n/g, '\n').replaceAll('{{VERSION}}', pkg.version);
const result = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife',
  target: ['chrome109'], legalComments: 'none', sourcemap: false, write: false,
  define: { __SCRIPT_VERSION__: JSON.stringify(pkg.version) },
});
const license = await readFile('node_modules/mp4-muxer/LICENSE', 'utf8');
const notice = '/*! mp4-muxer 5.2.2\n' + license.replace(/\r\n/g, '\n').trim() + '\n*/\n';
const core = notice + result.outputFiles[0].text;
const standaloneHeader = header
  .split('\n')
  .filter(line => !line.startsWith('// @require'))
  .map(line => /^\/\/ @(updateURL|downloadURL)\s/.test(line)
    ? line.replace('/master/tripo-model-rotation.user.js', '/master/dist/tripo-model-rotation.standalone.user.js')
    : line)
  .join('\n');

await mkdir('dist', { recursive: true });
await writeFile('dist/tripo-core.min.js', core);
await writeFile('tripo-model-rotation.user.js', header + '\n// Core code is loaded from the immutable GitHub release tag above.\n');
await writeFile('dist/tripo-model-rotation.standalone.user.js', standaloneHeader + '\n' + core);

console.log(`Built v${pkg.version}: loader ${Buffer.byteLength(header)} bytes, core ${Buffer.byteLength(core)} bytes (no source map)`);
