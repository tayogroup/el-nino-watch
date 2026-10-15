// A Chromium-based browser for headless printing and screenshots (print-sources-pdf.mjs,
// print-social-image.mjs): CHROME_PATH if set, else Microsoft Edge or Google Chrome where usually installed.
import {existsSync} from 'node:fs';

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
