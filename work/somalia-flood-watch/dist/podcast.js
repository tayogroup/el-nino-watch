/* El Nino Watch: the Somali audio bulletin, first on the home page (podcast.mjs writes and voices them).
   Shown whenever the service is on: before the first recording it says when that will be; afterwards it
   plays the latest bulletin and says when it was recorded and when the next one is due. Times are East
   Africa Time (UTC+3) whatever the reader's clock says. The bulletin is Somali in either page language; the
   times line follows the page language and is redrawn when the EN/SO buttons are used. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis, doc = root.document;
  const section = doc?.getElementById?.('podcast');
  if (!section) return;
  const EAT_MS = 3 * 3600 * 1000, DEFAULT_SLOTS = ['06:30', '12:30', '18:30'];
  const length = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  const clock = ms => new Date(ms + EAT_MS).toISOString().slice(11, 16);
  const dayKey = ms => new Date(ms + EAT_MS).toISOString().slice(0, 10);
  const WORDS = {
    en: {recorded: at => `Recorded at ${at} EAT`, next: at => `next bulletin at ${at}`, nextTomorrow: at => `next bulletin tomorrow at ${at}`, first: at => `The first bulletin is at ${at} East Africa Time.`, firstTomorrow: at => `The first bulletin is tomorrow at ${at} East Africa Time.`, held: 'New bulletins are paused.'},
    so: {recorded: at => `Waxaa la duubay ${at} (saacadda Bariga Afrika)`, next: at => `warbixinta xigta waa ${at}`, nextTomorrow: at => `warbixinta xigta waa berri ${at}`, first: at => `Warbixinta ugu horreysa waa ${at} saacadda Bariga Afrika.`, firstTomorrow: at => `Warbixinta ugu horreysa waa berri ${at} saacadda Bariga Afrika.`, held: 'Warbixinada cusub waa la hakiyay.'}
  };

  // The next slot after this moment, in East Africa Time: {at: "12:30", tomorrow: false}.
  function nextSlot(nowMs, slots = DEFAULT_SLOTS) {
    const minutes = Math.floor(((nowMs + EAT_MS) % 86400000) / 60000);
    const upcoming = slots.find(at => { const [h, m] = at.split(':').map(Number); return h * 60 + m > minutes; });
    return upcoming ? {at: upcoming, tomorrow: false} : {at: slots[0], tomorrow: true};
  }

  // The times line: "Recorded at 06:31 EAT · next bulletin at 12:30", or when the first bulletin is.
  function describeTimes(data, nowMs, lang) {
    const w = WORDS[lang === 'so' ? 'so' : 'en'], item = data?.items?.[0];
    const next = nextSlot(nowMs, data?.slots || DEFAULT_SLOTS);
    if (!item) return data?.hold ? w.held : (next.tomorrow ? w.firstTomorrow(next.at) : w.first(next.at));
    const recorded = Date.parse(item.publishedAt);
    const parts = [Number.isFinite(recorded) ? w.recorded(clock(recorded)) + (dayKey(recorded) === dayKey(nowMs) ? '' : `, ${dayKey(recorded)}`) : ''];
    parts.push(data.hold ? w.held : (next.tomorrow ? w.nextTomorrow(next.at) : w.next(next.at)));
    const text = parts.filter(Boolean).join(' · ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  let last = null;
  const language = () => (root.SiteLanguage?.getLanguage?.() === 'so' ? 'so' : 'en');
  function draw(data) {
    const item = data?.items?.[0];
    if (!data?.enabled && !item) { section.hidden = true; return; }
    const audio = doc.getElementById('podcast-audio'), read = doc.getElementById('podcast-read'), player = doc.getElementById('podcast-player');
    const when = doc.getElementById('podcast-when'), text = doc.getElementById('podcast-text'), times = doc.getElementById('podcast-times');
    const playable = !!item && /^\/podcast\/[\w-]+\.mp3$/.test(item.url || '');
    // Nothing recorded yet: one column, saying when the first bulletin is; no empty player.
    if (player) player.hidden = !playable;
    if (read) read.hidden = !playable;
    section.classList?.toggle('is-empty', !playable);
    // A newer bulletin does not cut off one being listened to; it is picked up on the next check.
    if (audio && playable && audio.getAttribute('src') !== item.url && audio.paused !== false) audio.setAttribute('src', item.url);
    if (when) when.textContent = playable ? `${item.title} · ${length(Number(item.seconds) || 0)}` : '';
    if (text) text.textContent = playable ? item.text || '' : '';
    if (times) times.textContent = describeTimes(data, Date.now(), language());
    section.hidden = false;
  }
  async function load() {
    try { last = await (await root.fetch('/api/podcast', {cache: 'no-store'})).json(); } catch { return null; }
    draw(last);
    return last;
  }
  // i18n.js sets the page language when the page has loaded; drawing before that would write the times
  // line in English on a Somali page. The timer lets i18n.js's own DOMContentLoaded handler run first.
  if (doc.readyState === 'loading') doc.addEventListener?.('DOMContentLoaded', () => root.setTimeout(load, 0), {once: true});
  else load();
  // Every 5 minutes: a new bulletin appears soon after its time, and "next" stays right.
  root.setInterval?.(load, 5 * 60 * 1000);
  doc.addEventListener?.('click', event => { if (last && event.target?.closest?.('[data-site-language]')) root.setTimeout?.(() => draw(last), 0); });
  root.ElNinoPodcast = Object.freeze({load, describeTimes, nextSlot});
})();
