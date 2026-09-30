import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

for (const minify of [false, true]) {
  const variant = minify ? 'minified' : 'unminified';
  const result = await build({
    stdin: {
      contents: `export { meetsMinimumVersion } from './runtime/version';
        export { normalizeSettings, DEFAULT_SETTINGS } from './settings/settings';
        export { makeFramePlan, transitionProgress } from './rotation/frame-plan';
        export { formatOutputFilename, formatBackgroundFilename } from './utils/filename';
        export { validProjectUrl } from './projects/project-url';
        export { createProjectStorage, parseProjectNames, parseProjectLibrary, projectNameFor, rememberProject } from './storage/project-library';
        export { planBatchJobs, selectedBatchItems } from './batch/plan';
        export { parseRestorePoints, restorePointsForWrite, parseMultiProjectSession,
          createMultiProjectSession, planMultiProjectJobs, preserveCheckboxState,
          cancelMultiProjectSession, completeMultiProjectSession,
          runRestoreTransaction } from './batch/multi-project';
        export { EXPORT_ITEMS } from './settings/catalog';`,
      resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
    },
    bundle: true, write: false, minify, format: 'esm', target: ['chrome109'],
  });
  const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  test(`${variant}: minimum version compares numeric release components and rejects invalid policy`,()=>{
    for (const [current,minimum,expected] of [
      ['3.9.6','3.9.5',true],['3.9.6','3.9.6',true],['3.9.6','3.9.7',false],
      ['3.10.0','3.9.9',true],['3.9.6','3.10.0',false],['4.0.0','3.99.99',true],
      ['3.9.6','99.0.0',false],['3.9.6',undefined,false],['3.9.6',null,false],
      ['3.9.6',123,false],['3.9.6','3.9',false],['3.9.6','03.9.0',false],
      ['3.9.6','3.9.6-beta',false],['3.9.6','3.9.6\n',false],
      ['3.9.6','9007199254740992.0.0',false],['invalid','3.9.5',false],
    ]) assert.equal(api.meetsMinimumVersion(current,minimum),expected,JSON.stringify([current,minimum]));
  });
  test(`${variant}: empty batch selection survives settings round trip`,()=>{
    assert.equal(api.normalizeSettings(JSON.parse(JSON.stringify({batchItems:[]}))).batchItems.length,0);
    assert.equal(api.normalizeSettings({}).batchItems.length,9);
    assert.equal(api.normalizeSettings({batchItems:null}).batchItems.length,9);
    assert.deepEqual(Array.from(api.normalizeSettings({batchItems:['screenshot:solid','bad','screenshot:solid']}).batchItems),['screenshot:solid']);
    assert.equal(api.normalizeSettings({batchItems:['bad']}).batchItems.length,0);
  });
  test(`${variant}: frame plan preserves deterministic count and endpoints`,()=>{
    const plan=api.makeFramePlan('uniform',api.normalizeSettings({}));
    assert.equal(plan.angles.length,195);assert.equal(plan.angles[0],0);
    assert.equal(plan.angles.at(-1),2*Math.PI);assert.equal(plan.movingFrames,180);
  });

  test(`${variant}: stored settings normalize invalid values and keep independent batch arrays`, () => {
    const defaults = api.normalizeSettings(null);
    const settings = api.normalizeSettings({ configVersion: 1, direction: '1', recordingFps: 999,
      uniformDuration: 'bad', autoHide: 'false', transparentOutput: true, recordingScope: 'other' });
    assert.equal(settings.configVersion, 9);
    assert.equal(settings.direction, 1);
    assert.equal(settings.recordingFps, 120);
    assert.equal(settings.uniformDuration, defaults.uniformDuration);
    assert.equal(settings.autoHide, true);
    assert.equal(settings.transparentOutput, true);
    assert.equal(settings.recordingScope, 'canvas');
    assert.equal(settings.offscreenSize, 1024);
    assert.equal(settings.transparentOutput, true);
    assert.equal(api.normalizeSettings({ offscreenSize: 2048 }).offscreenSize, 2048);
    assert.equal(api.normalizeSettings({ offscreenSize: 999 }).offscreenSize, 1024);
    const wireframe = api.normalizeSettings({ wireframeWidth: 99, wireframeColor: '#Ab12Cd', wireframeOpacity: -1 });
    assert.equal(wireframe.wireframeWidth, 8);
    assert.equal(wireframe.wireframeColor, '#ab12cd');
    assert.equal(wireframe.wireframeOpacity, 0);
    assert.equal(api.normalizeSettings({ wireframeColor: 'red' }).wireframeColor, '#000000');
    settings.batchItems.length = 0;
    assert.equal(defaults.batchItems.length, 9);
    assert.equal(api.DEFAULT_SETTINGS.batchItems.length, 9);
    assert(Object.isFrozen(api.DEFAULT_SETTINGS.batchItems));
  });
  test(`${variant}: batch job plan preserves selected order and only expands valid wireframe variants`, () => {
    const settings = api.normalizeSettings({ batchItems: ['transition:normal', 'screenshot:solid'] });
    const selected = api.selectedBatchItems(api.EXPORT_ITEMS, settings.batchItems);
    assert.deepEqual(selected.map(item => item.key), ['screenshot:solid', 'transition:normal']);
    assert.deepEqual(api.planBatchJobs(api.EXPORT_ITEMS, settings, false).map(job => [job.key, job.wireframe]), [
      ['screenshot:solid', false], ['transition:normal', false],
    ]);
    settings.batchWireframeVariants = true;
    assert.deepEqual(api.planBatchJobs(api.EXPORT_ITEMS, settings, true).map(job => [job.key, job.wireframe]), [
      ['screenshot:solid', false], ['screenshot:solid', true],
      ['transition:normal', false], ['transition:normal', true],
    ]);
  });
  test(`${variant}: transition trajectory is monotonic in either direction with exact hold poses`, () => {
    for (const direction of [-1, 1]) {
      const settings = api.normalizeSettings({ direction });
      const plan = api.makeFramePlan('transition', settings);
      assert.equal(plan.movingFrames, 99);
      assert.equal(plan.angles.length, 114);
      assert(Math.abs(plan.angles[0]) === 0);
      assert.equal(plan.endAngle, -direction * 8 * Math.PI);
      for (let index = 1; index < plan.movingFrames; index++) {
        assert(-direction * (plan.angles[index] - plan.angles[index - 1]) >= 0);
      }
      assert(plan.angles.slice(plan.movingFrames).every(angle => angle === plan.endAngle));
      assert(Math.abs(api.transitionProgress(1.65, 0.65, 0.7, 0.3) - 1) < 1e-12);
    }
  });
  test(`${variant}: filenames retain format, material, turn count and wireframe convention`, () => {
    const settings = api.normalizeSettings({});
    assert.equal(api.formatOutputFilename('screenshot', ' 工程/一 ', '白膜', settings), '工程-一-单帧-白膜.png');
    assert.equal(api.formatOutputFilename('uniform', '工程', '贴图', settings, true), '工程-匀速圈（圈数1）-贴图-线框.mov');
    settings.transparentOutput = true;
    assert.equal(api.formatOutputFilename('transition', '', '法线', settings), '未命名工程-转场-法线.mov');
    assert.equal(api.formatBackgroundFilename(' 工程/一 '), '工程-一-灰色渐变背景.png');
  });
  test(`${variant}: project links stay on Tripo and match the stored project identity`, () => {
    const id = '12345678-1234-4123-8123-123456789abc';
    const base = `https://studio.tripo3d.ai/zh/workspace/generate/${id}`;
    assert.equal(api.validProjectUrl(`${base}?foo=1#x`, id), base);
    for (const value of [null, 42, `https://other.example/workspace/generate/${id}`,
      `https://user:pass@studio.tripo3d.ai/workspace/generate/${id}`, 'javascript:alert(1)']) {
      assert.equal(api.validProjectUrl(value, id), null);
    }
    assert.equal(api.validProjectUrl(base, 'other-id'), null);
  });
  test(`${variant}: malformed restore-point storage fails closed before writes`, () => {
    const corrupt = '{\ninvalid json';
    assert.deepEqual(api.parseRestorePoints(corrupt), {}); // Safe for read-only display.
    assert.throws(() => api.restorePointsForWrite(corrupt), /为避免覆盖已有记录/);
    assert.throws(() => api.restorePointsForWrite('[]'), /为避免覆盖已有记录/);
    const storage = { raw: corrupt };
    assert.throws(() => { const points = api.restorePointsForWrite(storage.raw); storage.raw = JSON.stringify(points); }, /为避免覆盖已有记录/);
    assert.equal(storage.raw, corrupt);
    assert.deepEqual(api.restorePointsForWrite(null), {});
  });
  test(`${variant}: cross-project sessions validate frozen jobs and resume indexes`, () => {
    const id = '12345678-1234-4123-8123-123456789abc';
    const point = { id: 'rp1', projectId: id, url: `https://studio.tripo3d.ai/workspace/generate/${id}`,
      createdAt: '2026-01-01T00:00:00.000Z', kind: 'manual', view: { width: 800, height: 600 }, settings: {} };
    const settings = api.normalizeSettings({});
    const session = api.createMultiProjectSession('batch1', [point, { ...point, id: 'rp2', projectId: '22345678-1234-4123-8123-123456789abc', url: 'https://studio.tripo3d.ai/workspace/generate/22345678-1234-4123-8123-123456789abc' }],
      ['screenshot:solid', 'uniform:pbr'], settings, true);
    session.activeJobs = api.planMultiProjectJobs(api.EXPORT_ITEMS, session.itemKeys, true);
    session.pointIndex = 0; session.jobIndex = 2; session.completedFiles = 2;
    const resumed = api.parseMultiProjectSession(JSON.stringify(session));
    assert.equal(resumed.pointIndex, 0); assert.equal(resumed.jobIndex, 2);
    assert.deepEqual(resumed.activeJobs, session.activeJobs);
    assert.equal(resumed.completedFiles, 2);
    const legacy = { ...session }; delete legacy.activeJobs;
    const migrated = api.parseMultiProjectSession(JSON.stringify(legacy));
    assert.equal(migrated.jobIndex, 2); assert.deepEqual(migrated.activeJobs, session.activeJobs);
    assert.equal(api.parseMultiProjectSession(JSON.stringify({ ...session, pointIndex: 3 })), null);
    assert.equal(api.parseMultiProjectSession(JSON.stringify({ ...session, activeJobs: [{ key: 'bad', wireframe: true }] })), null);
  });
  test(`${variant}: unsupported wireframe capability keeps ordinary jobs`, () => {
    const jobs = api.planMultiProjectJobs(api.EXPORT_ITEMS, ['screenshot:solid'], false);
    assert.deepEqual(jobs, [{ key: 'screenshot:solid', wireframe: false }]);
  });
  test(`${variant}: checkbox state is restored after link click cancellation`, () => {
    let checked = false;
    const storage = new Set();
    const click = () => {
      checked = !checked; // Browser pre-activation toggle.
      const intended = checked;
      checked = !checked; // preventDefault rollback in Chrome.
      api.preserveCheckboxState(intended, value => {
        checked = value;
        if (value) storage.add('asset'); else storage.delete('asset');
      });
    };
    click(); assert.equal(checked, true); assert(storage.has('asset'));
    click(); assert.equal(checked, false); assert.equal(storage.has('asset'), false);
  });
  test(`${variant}: cancelling removes persisted work and handle and stops active export`, async () => {
    const id = '12345678-1234-4123-8123-123456789abc';
    const point = { id: 'rp', projectId: id, url: `https://studio.tripo3d.ai/workspace/generate/${id}`, view: { width: 1, height: 1 } };
    const session = api.createMultiProjectSession('batch-cancel', [point], ['screenshot:solid'], api.normalizeSettings({}), false);
    let stored = session; let stopped = false; const deletedHandles = [];
    await api.cancelMultiProjectSession(session,
      value => { assert.equal(value.status, 'cancelled'); stored = value; },
      () => { stopped = true; },
      () => { stored = null; },
      async key => { deletedHandles.push(key); });
    assert.equal(session.status, 'cancelled'); assert.equal(stopped, true);
    assert.equal(stored, null); assert.deepEqual(deletedHandles, ['batch-cancel']);
  });
  test(`${variant}: successful cross-project completion removes session and directory handle`, async () => {
    const id = '12345678-1234-4123-8123-123456789abc';
    const point = { id: 'rp', projectId: id, url: `https://studio.tripo3d.ai/workspace/generate/${id}`, view: { width: 1, height: 1 } };
    const session = api.createMultiProjectSession('batch-complete', [point], ['screenshot:solid'], api.normalizeSettings({}), false);
    session.completedFiles = 3;
    let stored = session; const removed = [];
    await api.completeMultiProjectSession(session, () => { stored = null; }, async key => removed.push(key));
    assert.equal(stored, null); assert.deepEqual(removed, ['batch-complete']); assert.equal(session.completedFiles, 3);
  });
  test(`${variant}: failed restore rolls view, settings and raw storage back`, () => {
    const state = { view: 'before', settings: { turns: 2 }, raw: '{"old":true}', busy: false };
    const before = structuredClone(state);
    assert.throws(() => api.runRestoreTransaction(() => {
      state.busy = true; state.view = 'partially-restored'; state.settings = { turns: 9 }; state.raw = '{bad';
      throw new Error('camera signature mismatch');
    }, () => Object.assign(state, before)), /camera signature mismatch/);
    assert.deepEqual(state, before);
  });
  test(`${variant}: project-library storage parsing drops invalid records and keeps newest first`, () => {
    const id = '12345678-1234-4123-8123-123456789abc';
    const url = `https://studio.tripo3d.ai/workspace/generate/${id}`;
    assert.deepEqual(api.parseProjectNames('{"a":" Name "}'), { a: ' Name ' });
    assert.deepEqual(api.parseProjectNames('[]'), {});
    const records = api.parseProjectLibrary(JSON.stringify([
      { id, name: ' First ', url, updatedAt: '5' },
      { id: 'bad', name: 'Bad', url, updatedAt: 9 },
      { id, name: 'Newest', url, updatedAt: 8 },
    ]));
    assert.deepEqual(records.map(record => [record.name, record.updatedAt]), [['Newest', 8], ['First', 5]]);
    const writes = [];
    const storage = api.createProjectStorage(() => '{"a":"  Demo  "}', (key, value) => (writes.push([key, value]), true), 'names', 'library');
    assert.equal(api.projectNameFor(storage, 'a'), 'Demo');
    assert.equal(storage.saveNames({ a: 'Saved' }), true);
    assert.equal(storage.saveLibrary([]), true);
    assert.deepEqual(writes, [['names', '{\"a\":\"Saved\"}'], ['library', '[]']]);
    assert.deepEqual(api.rememberProject(records, id, 'Replacement', `${url}?ignored=1`, 12)[0],
      { id, name: 'Replacement', url, updatedAt: 12 });
  });
}
