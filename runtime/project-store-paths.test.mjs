import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { projectStorePaths } from './project-store-paths.mjs';

test('a new store creates bounded media/jobs directories without another database', async t => {
  const base = await mkdtemp(join(tmpdir(), 'vyrealm-store-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const paths = await projectStorePaths(join(base, 'fresh'));
  assert.equal(paths.databasePath, join(await realpath(join(base, 'fresh')), 'vyrelum.sqlite'));
  assert.ok((await stat(paths.jobsDir)).isDirectory());
  assert.ok((await stat(paths.mediaDir)).isDirectory());
  await assert.rejects(stat(paths.databasePath), { code: 'ENOENT' });
});

test('existing database identity anchors a directory alias without moving files', async t => {
  const base = await mkdtemp(join(tmpdir(), 'vyrealm-store-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const actual = join(base, 'physical'), alias = join(base, 'alias');
  await mkdir(actual); await writeFile(join(actual, 'vyrelum.sqlite'), 'existing-store');
  await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const throughAlias = await projectStorePaths(alias), direct = await projectStorePaths(actual);
  assert.deepEqual(throughAlias, direct);
  assert.equal(throughAlias.dataDir, dirname(await realpath(join(alias, 'vyrelum.sqlite'))));
  assert.equal((await stat(throughAlias.databasePath)).size, 14);
});
