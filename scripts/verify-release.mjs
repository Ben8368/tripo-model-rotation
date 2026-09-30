import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const tag = process.env.RELEASE_TAG || process.argv[2];
const installer = await readFile('tripo-model-rotation.user.js', 'utf8');
const standalone = await readFile('dist/tripo-model-rotation.standalone.user.js', 'utf8');
const readme = await readFile('README.md', 'utf8');
const expectedInstallUrl = `https://raw.githubusercontent.com/Ben8368/tripo-model-rotation/v${pkg.version}/tripo-model-rotation.user.js`;

if (tag !== `v${pkg.version}`) throw new Error(`标签 ${tag} 与 package.json ${pkg.version} 不一致`);
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
  throw new Error('package-lock.json 版本与 package.json 不一致');
}
for (const [name, code] of [['默认安装包', installer], ['备用安装包', standalone]]) {
  if (!code.split('\n').some(line => line.trim() === `// @version      ${pkg.version}`)) {
    throw new Error(`${name} 未构建为 ${pkg.version}`);
  }
}
if (!readme.includes(expectedInstallUrl)) throw new Error(`README 安装链接没有指向 ${tag}`);

console.log(`已验证 ${tag} 的版本、安装包和固定版本安装链接`);
