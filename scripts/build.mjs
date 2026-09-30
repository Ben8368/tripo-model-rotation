import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const header = (await readFile(new URL('../src/userscript.meta.txt', import.meta.url), 'utf8')).replace(/\r\n/g, '\n').replaceAll('{{VERSION}}', pkg.version);
if (/^\/\/ @require\s/m.test(header)) {
  throw new Error('默认安装包必须内置核心，不能依赖未发布的 @require 版本标签');
}
const result = await build({
  entryPoints: ['src/main.ts'], bundle: true, minify: true, format: 'iife',
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
await writeFile('tripo-model-rotation.user.js', header + '\n' + core);
await writeFile('dist/tripo-model-rotation.standalone.user.js', standaloneHeader + '\n' + core);

console.log(`Built v${pkg.version}: self-contained installer ${Buffer.byteLength(header + '\n' + core)} bytes (no source map)`);
