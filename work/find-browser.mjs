// A Chromium-based browser for headless printing and screenshots (print-sources-pdf.mjs,
// print-social-image.mjs): CHROME_PATH if set, else Microsoft Edge or Google Chrome where usually installed.
import {existsSync, mkdtempSync, rmSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A throwaway browser profile. With the usual profile, an Edge or Chrome window the user already
// has open takes the headless job over and nothing is written.
// Edge's launcher can return before the page is printed, so wait (up to 30 s) for the file to change.
export function waitForWrite(file, before, ms = 30000) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (const end = Date.now() + ms; Date.now() < end; Atomics.wait(pause, 0, 0, 250)) {
    if (existsSync(file) && statSync(file).mtimeMs !== before) return true;
  }
  return false;
}

export function withProfile(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'elnino-browser-'));
  try { return run(`--user-data-dir=${dir}`); } finally { try { rmSync(dir, {recursive: true, force: true}); } catch {} }
}

export function findBrowser() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean).find(candidate => existsSync(candidate)) || null;
}
