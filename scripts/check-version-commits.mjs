import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const version = (ref, path) => JSON.parse(git('show', `${ref}:${path}`)).version;
const parts = value => {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`无效版本号：${value}`);
  return value.split('.').map(Number);
};
const greater = (next, previous) => {
  const a = parts(next);
  const b = parts(previous);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
};

const suppliedBase = process.env.VERSION_BASE_SHA;
const base = suppliedBase && !/^0+$/.test(suppliedBase) ? suppliedBase : 'HEAD^';
const commits = git('rev-list', '--reverse', '--topo-order', `${base}..HEAD`).split('\n').filter(Boolean);

for (const commit of commits) {
  const parent = git('rev-parse', `${commit}^`);
  const current = version(commit, 'package.json');
  const previous = version(parent, 'package.json');
  const lock = JSON.parse(git('show', `${commit}:package-lock.json`));
  if (!greater(current, previous)) {
    throw new Error(`${commit.slice(0, 7)} 必须将 package.json 版本提升至高于父提交的 ${previous}（当前 ${current}）`);
  }
  if (lock.version !== current || lock.packages?.['']?.version !== current) {
    throw new Error(`${commit.slice(0, 7)} 的 package-lock.json 版本与 ${current} 不一致`);
  }
}

console.log(`已验证 ${commits.length} 个提交的版本递增和锁文件一致性`);
