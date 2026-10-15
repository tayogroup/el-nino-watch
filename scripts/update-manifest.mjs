// Update MANIFEST.json, which pins the size and SHA-256 of every packaged file (npm run check).
//
//   npm run manifest                 re-pin every listed file that has changed, and name each one
//   npm run manifest -- <path> ...   re-pin those files, add new ones, drop listed ones that were deleted
//
// Paths are relative to the repository root. It never lists ignored local files (.env, data/).
// Read what it prints: a file you did not mean to change (often line endings) shows up here first.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const order = (a, b) => a.localeCompare(b, 'en');
const refused = rel => /(^|\/)\.env(\.|$)/.test(rel) && rel !== '.env.example' || /(^|\/)data\//.test(rel) || /(^|\/)(node_modules|outputs)\//.test(rel);

async function pin(root, rel) {
  const bytes = await fs.readFile(path.join(root, rel));
  return {path: rel, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
}

async function exists(file, rel) {
  try {
    if ((await fs.stat(file)).isDirectory()) throw new Error(`${rel} is a folder; name the files in it.`);
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Returns what changed: {updated, added, removed, missing}. Writes the manifest only when something did.
export async function updateManifest(root, paths = []) {
  const manifestPath = path.join(root, 'MANIFEST.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const result = {updated: [], added: [], removed: [], missing: []};
  const listed = new Map(manifest.files.map(entry => [entry.path, entry]));
  const named = paths.map(input => {
    // Windows-style separators work everywhere: no repository path contains a backslash.
    const absolute = path.resolve(root, String(input).replace(/\\/g, '/'));
    const rel = path.relative(root, absolute).split(path.sep).join('/');
    if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) throw new Error(`${input} is outside the repository.`);
    if (refused(rel)) throw new Error(`${rel} is a local file that is never packaged (.env, data/, node_modules/, outputs/).`);
    return rel;
  });
  for (const rel of named.length ? [...new Set(named)] : [...listed.keys()]) {
    const entry = listed.get(rel);
    if (!(await exists(path.join(root, rel), rel))) {
      if (!entry) throw new Error(`${rel} does not exist and is not listed.`);
      // Named: the file was deleted on purpose, so its entry goes. Unnamed: report it and change nothing.
      if (named.length) { manifest.files = manifest.files.filter(item => item !== entry); result.removed.push(rel); }
      else result.missing.push(rel);
      continue;
    }
    const pinned = await pin(root, rel);
    if (!entry) {
      const at = manifest.files.findIndex(item => order(item.path, rel) > 0);
      manifest.files.splice(at < 0 ? manifest.files.length : at, 0, pinned);
      result.added.push(rel);
    } else if (entry.bytes !== pinned.bytes || entry.sha256 !== pinned.sha256) {
      Object.assign(entry, pinned);
      result.updated.push(rel);
    }
  }
  if (result.updated.length || result.added.length || result.removed.length) {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const {updated, added, removed, missing} = await updateManifest(root, process.argv.slice(2));
    for (const [label, list] of [['Updated', updated], ['Added', added], ['Removed', removed]]) for (const rel of list) console.log(`${label}: ${rel}`);
    if (!updated.length && !added.length && !removed.length) console.log('MANIFEST.json already matches.');
    if (missing.length) {
      console.error(`Listed but missing: ${missing.join(', ')}. If you deleted them on purpose, run: npm run manifest -- ${missing.join(' ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
