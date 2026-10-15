// Prints dist/sources.html (in English) to dist/el-nino-watch-sources.pdf with a headless
// Chromium browser: Microsoft Edge or Google Chrome, or the one named by CHROME_PATH.
// Run after changing the sources page: npm run build:sources-pdf
import {spawnSync} from 'node:child_process';
import {existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'somalia-flood-watch', 'dist');
const page = path.join(dist, 'sources.html'), output = path.join(dist, 'el-nino-watch-sources.pdf');
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const browser = candidates.find(candidate => existsSync(candidate));
if (!browser) { console.error('No Edge or Chrome found. Set CHROME_PATH to a Chromium-based browser.'); process.exitCode = 1; }
else {
  const before = existsSync(output) ? statSync(output).mtimeMs : 0;
  const url = pathToFileURL(page).href + '?lang=en';
  const result = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer', '--virtual-time-budget=5000', `--print-to-pdf=${output}`, url], {encoding: 'utf8', timeout: 120000});
  if (!existsSync(output) || statSync(output).mtimeMs === before) {
    console.error(`The PDF was not written.\n${result.stderr || result.error?.message || ''}`);
    process.exitCode = 1;
  } else console.log(`Wrote ${path.relative(process.cwd(), output)} (${statSync(output).size} bytes). Rehash it in MANIFEST.json before committing.`);
}
