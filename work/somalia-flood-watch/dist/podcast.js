/* El Nino Watch: the Somali audio bulletin, first on the home page (podcast.mjs writes and voices them).
   Shown whenever the service is on: before the first recording it says when that will be; afterwards it
   plays the latest bulletin and says when it was recorded and when the next one is due. Earlier bulletins
   (the server keeps a week; the list shows the last few) can be played here or saved as MP3 to listen
   offline. Times are East Africa Time (UTC+3) whatever the reader's clock says. The bulletin is Somali in
   either page language; the times line and the list follow the page language and are redrawn when the
   EN/SO buttons are used. The first play of each bulletin is counted, anonymously (visits.js). */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis, doc = root.document;
  const section = doc?.getElementById?.('podcast');
  if (!section) return;
  const EAT_MS = 3 * 3600 * 1000, DEFAULT_SLOTS = ['06:30', '12:30', '18:30'], EARLIER = 5;
  const length = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  const clock = ms => new Date(ms + EAT_MS).toISOString().slice(11, 16);
  const dayKey = ms => new Date(ms + EAT_MS).toISOString().slice(0, 10);
  const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const playable = item => !!item && /^\/podcast\/[\w-]+\.mp3$/.test(item.url || '');
  const WORDS = {
    en: {recorded: at => `Recorded at ${at} EAT`, next: at => `next bulletin at ${at}`, nextTomorrow: at => `next bulletin tomorrow at ${at}`, first: at => `The first bulletin is at ${at} East Africa Time.`, firstTomorrow: at => `The first bulletin is tomorrow at ${at} East Africa Time.`, held: 'New bulletins are paused.', save: 'Save MP3', listen: {so: 'Listen in Somali', en: 'Listen in English'}},
    so: {recorded: at => `Waxaa la duubay ${at} (saacadda Bariga Afrika)`, next: at => `warbixinta xigta waa ${at}`, nextTomorrow: at => `warbixinta xigta waa berri ${at}`, first: at => `Warbixinta ugu horreysa waa ${at} saacadda Bariga Afrika.`, firstTomorrow: at => `Warbixinta ugu horreysa waa berri ${at} saacadda Bariga Afrika.`, held: 'Warbixinada cusub waa la hakiyay.', save: 'Kaydi MP3', listen: {so: 'Ku dhageyso Af-Soomaali', en: 'Ku dhageyso Ingiriisi'}}
  };

  // The next slot after this moment, in East Africa Time: {at: "12:30", tomorrow: false}.
  function nextSlot(nowMs, slots = DEFAULT_SLOTS) {
    const minutes = Math.floor(((nowMs + EAT_MS) % 86400000) / 60000);
    const upcoming = slots.find(at => { const [h, m] = at.split(':').map(Number); return h * 60 + m > minutes; });
    return upcoming ? {at: upcoming, tomorrow: false} : {at: slots[0], tomorrow: true};
  }

  // The times line: "Recorded at 06:31 EAT · next bulletin at 12:30", or when the first bulletin is.
  // item: the bulletin on show (the latest unless an earlier one was picked).
  function describeTimes(data, nowMs, lang, item = data?.items?.[0]) {
    const w = WORDS[lang === 'so' ? 'so' : 'en'];
    const next = nextSlot(nowMs, data?.slots || DEFAULT_SLOTS);
    if (!item) return data?.hold ? w.held : (next.tomorrow ? w.firstTomorrow(next.at) : w.first(next.at));
    const recorded = Date.parse(item.publishedAt);
    const parts = [Number.isFinite(recorded) ? w.recorded(clock(recorded)) + (dayKey(recorded) === dayKey(nowMs) ? '' : `, ${dayKey(recorded)}`) : ''];
    parts.push(data.hold ? w.held : (next.tomorrow ? w.nextTomorrow(next.at) : w.next(next.at)));
    const text = parts.filter(Boolean).join(' · ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  let last = null, chosen = null;
  // The bulletin language the reader picked (the panel's switch, the footer's two links, a #podcast-so or
  // #podcast-en link); null follows the page language.
  const fromHash = hash => (/^#podcast-(so|en)$/.exec(String(hash || '')) || [])[1] || null;
  let listenLang = fromHash(root.location?.hash);
  const counted = new Set();
  const language = () => (root.SiteLanguage?.getLanguage?.() === 'so' ? 'so' : 'en');
  const byId = id => doc.getElementById(id);

  function draw(data) {
    // The page's language when there are bulletins in it (English ones once approved), otherwise Somali.
    const all = (data?.items || []).filter(playable), mine = all.filter(other => (other.lang || 'so') === (listenLang || language()));
    const items = mine.length ? mine : all.filter(other => (other.lang || 'so') === 'so'), latest = items[0];
    if (!data?.enabled && !latest) { section.hidden = true; return; }
    const item = items.find(other => other.id === chosen) || latest, w = WORDS[language()];
    const audio = byId('podcast-audio'), save = byId('podcast-save');
    // Nothing recorded yet: one column, saying when the first bulletin is; no empty player.
    for (const id of ['podcast-player', 'podcast-read']) { const el = byId(id); if (el) el.hidden = !item; }
    section.classList?.toggle('is-empty', !item);
    // A newer bulletin does not cut off one being listened to; it is picked up on the next check.
    if (audio && item && audio.getAttribute('src') !== item.url && audio.paused !== false) {
      audio.setAttribute('src', item.url);
      // Which bulletin is loaded, for the play count.
      if (audio.dataset) { audio.dataset.id = item.id; audio.dataset.slot = item.slot; }
    }
    if (save) { save.hidden = !item; if (item) { save.setAttribute('href', item.url); save.setAttribute('download', `el-nino-watch-${item.id}.mp3`); save.textContent = w.save; } }
    const when = byId('podcast-when'), text = byId('podcast-text'), times = byId('podcast-times');
    if (when) { when.textContent = item ? `${item.title} · ${length(Number(item.seconds) || 0)}` : ''; when.setAttribute?.('lang', item?.lang || 'so'); }
    byId('podcast-text')?.setAttribute?.('lang', item?.lang || 'so');
    if (text) text.textContent = item ? item.text || '' : '';
    // Before English bulletins exist, the English page says the one it plays is in Somali.
    if (times) times.textContent = describeTimes(data, Date.now(), language(), item) + (item && language() === 'en' && (item.lang || 'so') === 'so' ? ' · in Somali' : '');
    // The other language, when it has bulletins: one tap switches the player to it.
    const toggle = byId('podcast-switch'), other = (item?.lang || 'so') === 'so' ? 'en' : 'so';
    if (toggle) {
      toggle.hidden = !item || !all.some(entry => (entry.lang || 'so') === other);
      toggle.textContent = w.listen[other];
      toggle.setAttribute?.('data-listen', other);
    }
    // Earlier bulletins: play here, or save to listen offline.
    const earlier = byId('podcast-earlier'), list = byId('podcast-list');
    const others = items.filter(other => other.id !== item?.id).slice(0, EARLIER);
    if (earlier) earlier.hidden = !others.length;
    // While an earlier one plays, the latest is the first in this list.
    if (list) list.innerHTML = others.map(other => `<li><button type="button" class="linkish" data-podcast-id="${esc(other.id)}" lang="${esc(other.lang || 'so')}">${esc(other.title)} · ${esc(length(Number(other.seconds) || 0))}</button> <a href="${esc(other.url)}" download="el-nino-watch-${esc(other.id)}.mp3">${esc(w.save)}</a></li>`).join('');
    section.hidden = false;
  }
  async function load() {
    try { last = await (await root.fetch('/api/podcast', {cache: 'no-store'})).json(); } catch { return null; }
    draw(last);
    return last;
  }
  function listenIn(lang) {
    listenLang = lang === 'en' ? 'en' : 'so';
    chosen = null;
    const audio = byId('podcast-audio');
    if (audio) { audio.pause?.(); audio.removeAttribute?.('src'); }
    if (last) draw(last);
  }
  // The footer's "Audio bulletin, Somali" and "Audio bulletin, English" (tabs.js brings the panel into view).
  doc.addEventListener?.('click', event => {
    const link = event.target?.closest?.('a[href="#podcast-so"], a[href="#podcast-en"]');
    if (link) listenIn(fromHash(link.getAttribute('href')));
  }, true);
  // Picking an earlier bulletin loads it into the player and plays it.
  section.addEventListener?.('click', event => {
    const toggle = event.target?.closest?.('#podcast-switch');
    if (toggle) { listenIn(toggle.getAttribute('data-listen')); return; }
    const button = event.target?.closest?.('[data-podcast-id]');
    if (!button || !last) return;
    chosen = button.getAttribute('data-podcast-id');
    const audio = byId('podcast-audio');
    if (audio) { audio.pause?.(); audio.removeAttribute?.('src'); }
    draw(last);
    audio?.play?.()?.catch?.(() => {});
  });
  // The first play of each bulletin, for the anonymous counts (visits.js).
  byId('podcast-audio')?.addEventListener?.('play', event => {
    const audio = event.target, id = audio?.dataset?.id;
    if (!id || counted.has(id)) return;
    counted.add(id);
    if (typeof root.CustomEvent === 'function') root.dispatchEvent?.(new root.CustomEvent('podcast-play', {detail: {slot: audio.dataset.slot}}));
  });
  // i18n.js sets the page language when the page has loaded; drawing before that would write the times
  // line in English on a Somali page. The timer lets i18n.js's own DOMContentLoaded handler run first.
  if (doc.readyState === 'loading') doc.addEventListener?.('DOMContentLoaded', () => root.setTimeout(load, 0), {once: true});
  else load();
  // The English page plays English bulletins once there are some; redraw on a language switch picks them.
  // Every 5 minutes: a new bulletin appears soon after its time, and "next" stays right.
  root.setInterval?.(load, 5 * 60 * 1000);
  doc.addEventListener?.('click', event => { if (last && event.target?.closest?.('[data-site-language]')) root.setTimeout?.(() => draw(last), 0); });
  root.ElNinoPodcast = Object.freeze({load, describeTimes, nextSlot});
})();
