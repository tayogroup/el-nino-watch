/* El Nino Watch: the latest Somali audio bulletin, on the Alerts tab (podcast.mjs writes and voices them).
   The panel stays hidden while the service is off or has nothing to play. The bulletin itself is Somali in
   either page language; its title and text are marked lang="so" and left out of translation. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis, doc = root.document;
  const section = doc?.getElementById?.('podcast');
  if (!section) return;
  const length = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

  async function load() {
    let data = null;
    try { data = await (await root.fetch('/api/podcast', {cache: 'no-store'})).json(); } catch { return null; }
    const item = data?.items?.[0];
    if (!item || !/^\/podcast\/[\w-]+\.mp3$/.test(item.url || '')) { section.hidden = true; return null; }
    const audio = doc.getElementById('podcast-audio');
    // A newer bulletin does not cut off one being listened to; it is picked up on the next check.
    if (audio && audio.getAttribute('src') !== item.url && (audio.paused !== false)) audio.setAttribute('src', item.url);
    const when = doc.getElementById('podcast-when'), text = doc.getElementById('podcast-text');
    if (when) when.textContent = `${item.title} · ${length(Number(item.seconds) || 0)}`;
    if (text) text.textContent = item.text || '';
    section.hidden = false;
    return item;
  }
  load();
  root.setInterval?.(load, 15 * 60 * 1000);
  root.ElNinoPodcast = Object.freeze({load});
})();
