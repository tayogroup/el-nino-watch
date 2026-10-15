import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {updateManifest} from '../scripts/update-manifest.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const entry = (rel, text) => ({path: rel, bytes: Buffer.byteLength(text), sha256: sha(text)});

async function repo(files, listed = Object.keys(files)) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'elnino-manifest-'));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), {recursive: true});
    await writeFile(path.join(root, rel), text);
  }
  await writeFile(path.join(root, 'MANIFEST.json'), JSON.stringify({package: 'test', files: listed.map(rel => entry(rel, files[rel]))}, null, 2) + '\n');
  return root;
}
const manifest = async root => JSON.parse(await readFile(path.join(root, 'MANIFEST.json'), 'utf8'));

test('with no paths: every listed file that changed is re-pinned and named, nothing else moves', async () => {
  const root = await repo({'a.js': 'one', 'b.js': 'two', 'work/c.js': 'three'});
  try {
    await writeFile(path.join(root, 'b.js'), 'two, edited');
    const before = await readFile(path.join(root, 'MANIFEST.json'), 'utf8');
    assert.deepEqual(await updateManifest(root), {updated: ['b.js'], added: [], removed: [], missing: []});
    const after = await manifest(root);
    assert.deepEqual(after.files.map(item => item.path), ['a.js', 'b.js', 'work/c.js']);
    assert.deepEqual(after.files[1], entry('b.js', 'two, edited'));
    assert.equal(after.package, 'test', 'other fields are kept');
    assert.ok(before.endsWith('\n') && (await readFile(path.join(root, 'MANIFEST.json'), 'utf8')).endsWith('\n'), 'formatting is kept');
    assert.deepEqual(await updateManifest(root), {updated: [], added: [], removed: [], missing: []}, 'a second run finds nothing');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('a line-ending change is reported, so an accidental edit shows up', async () => {
  const root = await repo({'a.js': 'x\ny\n'});
  try {
    await writeFile(path.join(root, 'a.js'), 'x\r\ny\r\n');
    assert.deepEqual((await updateManifest(root)).updated, ['a.js']);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('named paths: new files are added in order, deleted ones removed, unlisted missing ones refused', async () => {
  const root = await repo({'a.js': 'one', 'work/b.test.mjs': 'two', 'work/z.mjs': 'three', 'old.js': 'gone soon'});
  try {
    await writeFile(path.join(root, 'work/new.mjs'), 'new');
    await rm(path.join(root, 'old.js'));
    const result = await updateManifest(root, ['work/new.mjs', path.join(root, 'old.js'), 'work\\new.mjs']);
    assert.deepEqual(result, {updated: [], added: ['work/new.mjs'], removed: ['old.js'], missing: []}, 'absolute, relative and backslash paths all work');
    assert.deepEqual((await manifest(root)).files.map(item => item.path), ['a.js', 'work/b.test.mjs', 'work/new.mjs', 'work/z.mjs']);
    await assert.rejects(updateManifest(root, ['nowhere.js']), /nowhere\.js does not exist and is not listed/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('with no paths, a deleted listed file is reported and the manifest is left alone', async () => {
  const root = await repo({'a.js': 'one', 'b.js': 'two'});
  try {
    await rm(path.join(root, 'b.js'));
    await writeFile(path.join(root, 'a.js'), 'one, edited');
    const before = await readFile(path.join(root, 'MANIFEST.json'), 'utf8');
    const result = await updateManifest(root);
    assert.deepEqual(result.missing, ['b.js']);
    assert.deepEqual((await manifest(root)).files.map(item => item.path), ['a.js', 'b.js'], 'the entry stays until the deletion is named');
    assert.notEqual(await readFile(path.join(root, 'MANIFEST.json'), 'utf8'), before, 'the changed file is still re-pinned');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('local files, folders and paths outside the repository are refused', async () => {
  const root = await repo({'a.js': 'one', '.env': 'SECRET=1', 'data/reports.json': '[]', 'work/data/x.json': '{}'}, ['a.js']);
  try {
    for (const rel of ['.env', '.env.production', 'data/reports.json', 'work/data/x.json', 'node_modules/x.js']) await assert.rejects(updateManifest(root, [rel]), /never packaged/, rel);
    await assert.rejects(updateManifest(root, ['../outside.js']), /outside the repository/);
    await assert.rejects(updateManifest(root, ['work']), /is a folder/);
    assert.deepEqual((await manifest(root)).files.map(item => item.path), ['a.js']);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('the repository manifest is in the order the command keeps', async () => {
  const files = JSON.parse(await readFile(new URL('../MANIFEST.json', import.meta.url), 'utf8')).files.map(item => item.path);
  assert.deepEqual(files, [...files].sort((a, b) => a.localeCompare(b, 'en')));
});

test('npm run manifest is wired to the command', async () => {
  const scripts = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts.manifest, 'node scripts/update-manifest.mjs');
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/update-manifest.mjs', import.meta.url)), '../outside.js'], {encoding: 'utf8'});
  assert.equal(run.status, 1); assert.match(run.stderr, /outside the repository/, 'the command line reports errors and exits 1');
});
