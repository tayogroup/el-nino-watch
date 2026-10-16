// What a package must carry, worked out from the code rather than kept as a list. The fixed lists in
// package-flood-app.mjs and make-source-bundles.mjs had fallen behind server.mjs (news-feed, hydro-feed,
// floodhub-feed, whatsapp and podcast were missing, so the packaged server could not start) and behind
// index.html (the portable page lacked share.js, whatsapp.js, news-flash.js and podcast.js).
import fs from 'node:fs/promises';

const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]\.\/([\w.-]+\.mjs)['"]/g;

// The server modules: the entries and every module they import, at any depth, in the order found.
export async function serverModules(base, entries = ['server.mjs']) {
  const seen = [];
  async function visit(file) {
    if (seen.includes(file)) return;
    seen.push(file);
    const source = await fs.readFile(new URL(file, base), 'utf8');
    for (const [, next] of source.matchAll(RELATIVE_IMPORT)) await visit(next);
  }
  for (const entry of entries) await visit(entry);
  return seen;
}

// The page's own stylesheets and scripts, in page order: what the portable single-file page inlines.
export function pageAssets(html) {
  const local = href => !/^(?:[a-z]+:)?\/\//i.test(href) && !href.startsWith('data:');
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1]).filter(local);
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]).filter(local);
  return {styles, scripts};
}
