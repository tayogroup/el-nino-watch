// Renders work/social-preview.html to dist/social-preview.png (1200x630), the image X and Facebook
// show for shared links, with a headless Microsoft Edge or Google Chrome (or CHROME_PATH).
// Run after changing the design: npm run build:social-image
import {spawnSync} from 'node:child_process';
import {existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {findBrowser} from './find-browser.mjs';

const work = path.dirname(fileURLToPath(import.meta.url));
const page = path.join(work, 'social-preview.html');
const output = path.join(work, 'somalia-flood-watch', 'dist', 'social-preview.png');
const browser = findBrowser();
if (!browser) { console.error('No Edge or Chrome found. Set CHROME_PATH to a Chromium-based browser.'); process.exitCode = 1; }
else {
  const before = existsSync(output) ? statSync(output).mtimeMs : 0;
  const result = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=3000', `--screenshot=${output}`, pathToFileURL(page).href], {encoding: 'utf8', timeout: 120000});
  if (!existsSync(output) || statSync(output).mtimeMs === before) {
    console.error(`The image was not written.\n${result.stderr || result.error?.message || ''}`);
    process.exitCode = 1;
  } else console.log(`Wrote ${path.relative(process.cwd(), output)} (${statSync(output).size} bytes). Rehash it in MANIFEST.json before committing.`);
}
