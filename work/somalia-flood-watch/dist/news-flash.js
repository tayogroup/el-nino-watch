/* El Nino Watch: the El Niño news flash at the top of the page.
   Items come from /api/news (news-feed.mjs): the app's own flashes first, then recent headlines
   from SoDMA, FAO SWALIM, humanitarian organisations and the media. One item shows at a time and
   moves on every few seconds; it stops while the pointer or keyboard is on the bar, when paused,
   and for visitors who ask for reduced motion. "All news" opens the full list.
   Headlines stay as published (data-i18n-skip); the bar's own words are translated by i18n.js. */
(function (global) {
  'use strict';
  const doc = global.document;
  const ROTATE_MS = 8000, REFRESH_MS = 30 * 60 * 1000;
  const GROUPS = {app: 'El Nino Watch', government: 'Government', un: 'UN', humanitarian: 'Humanitarian', media: 'Media'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const safeUrl = value => { const text = String(value || ''); if (/^#tab=[a-z]+$/.test(text) || /^#[a-z][a-z-]*$/.test(text)) return text; try { const url = new URL(text); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; } };
  const dayLabel = value => { const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toLocaleDateString('en-GB', {timeZone: 'Africa/Mogadishu', day: 'numeric', month: 'short'}) : ''; };
  let items = [], index = 0, timer = 0, paused = false, holding = false;
  const reducedMotion = () => global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

  // One item. App flashes have a translated label and, for ICPAC, a translated sentence; outside
  // headlines and NOAA's own wording are shown as published.
  function itemHtml(item, inList = false) {
    const url = safeUrl(item.url), external = url && !url.startsWith('#');
    const group = `<span class="news-flash-badge news-flash-${esc(item.group)}"${item.group === 'app' ? ' data-i18n-skip' : ''}>${esc(GROUPS[item.group] || 'Media')}</span>`;
    const translated = item.kind === 'app' && ['icpac', 'health'].includes(item.key);
    const title = `<span class="news-flash-title"${translated ? '' : ` data-i18n-skip lang="${esc(item.language === 'so' ? 'so' : item.language === 'en' ? 'en' : 'und')}"`}>${esc(item.title)}</span>`;
    const label = item.label ? `<span class="news-flash-label-text">${esc(item.label)}</span> ` : '';
    const meta = `<span class="news-flash-meta"><span data-i18n-skip>${esc(item.source)}</span>${dayLabel(item.publishedAt) ? ` · <span data-i18n-skip>${esc(dayLabel(item.publishedAt))}</span>` : ''}</span>`;
    const body = `${label}${title}`;
    const link = url ? `<a class="news-flash-link" href="${esc(url)}"${external ? ' target="_blank" rel="noopener"' : ''}>${body}${external ? ' <span aria-hidden="true">↗</span>' : ''}</a>` : `<span class="news-flash-link">${body}</span>`;
    return inList ? `<li>${group} ${link} ${meta}</li>` : `${group}<span class="news-flash-text">${link} ${meta}</span>`;
  }
  function show(next) {
    const current = doc.getElementById('news-flash-current'); if (!current || !items.length) return;
    index = (next + items.length) % items.length;
    current.innerHTML = itemHtml(items[index]);
    const counter = doc.getElementById('news-flash-counter'); if (counter) counter.textContent = `${index + 1}/${items.length}`;
  }
  function schedule() {
    global.clearTimeout(timer);
    if (paused || holding || reducedMotion() || items.length < 2) return;
    timer = global.setTimeout(() => { show(index + 1); schedule(); }, ROTATE_MS);
  }
  function render() {
    const bar = doc.getElementById('news-flash'); if (!bar) return;
    if (!items.length) { bar.hidden = true; return; }
    bar.innerHTML = `<div class="news-flash-inner"><span class="news-flash-heading">El Niño news</span><div class="news-flash-current" id="news-flash-current" aria-live="${reducedMotion() ? 'polite' : 'off'}"></div><div class="news-flash-controls"><button type="button" data-news="prev" aria-label="Previous news item">‹</button><span class="news-flash-counter" id="news-flash-counter" data-i18n-skip></span><button type="button" data-news="next" aria-label="Next news item">›</button><button type="button" data-news="pause" aria-label="${paused ? 'Play news' : 'Pause news'}" aria-pressed="${paused}">${paused ? '▶' : '❚❚'}</button><button type="button" class="news-flash-all" data-news="all" aria-expanded="false" aria-controls="news-flash-list" aria-label="All news (${items.length})"><span aria-hidden="true">☰</span> <span class="news-flash-all-text">All news</span> <span data-i18n-skip>(${items.length})</span></button></div></div><div class="news-flash-list" id="news-flash-list" hidden><ol>${items.map(item => itemHtml(item, true)).join('')}</ol><p class="news-flash-note">Headlines are shown as published by each organisation or outlet. Nothing here is an official warning.</p></div>`;
    bar.hidden = false;
    show(Math.min(index, items.length - 1));
    schedule();
  }
  // A link to a section of this page (#health-alert). On the public page tabs.js opens its tab and
  // scrolls; in the city manager view, open the tool that holds the section first.
  const TOOL_PANELS = {alerts: 'alerts-panel', map: 'map-panel', weather: 'daily-panel', community: 'community-panel'};
  function openSection(link, event) {
    const href = link.getAttribute('href') || '';
    if (!/^#[a-z][a-z-]*$/.test(href)) return false;
    const target = doc.getElementById(href.slice(1)); if (!target) return false;
    event.preventDefault();
    if (doc.body?.classList?.contains('mayor-view')) {
      const tool = Object.keys(TOOL_PANELS).find(key => target.closest?.('#' + TOOL_PANELS[key]));
      if (tool) global.MayorNavigation?.open?.(tool);
    }
    global.setTimeout(() => target.scrollIntoView({behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start'}), 0);
    return true;
  }
  function onClick(event) {
    const link = event.target?.closest?.('a.news-flash-link');
    if (link && openSection(link, event)) return;
    const button = event.target?.closest?.('[data-news]'); if (!button) return;
    const action = button.getAttribute('data-news');
    if (action === 'prev') show(index - 1);
    else if (action === 'next') show(index + 1);
    else if (action === 'pause') {
      paused = !paused;
      button.setAttribute('aria-pressed', String(paused)); button.setAttribute('aria-label', paused ? 'Play news' : 'Pause news'); button.textContent = paused ? '▶' : '❚❚';
    } else if (action === 'all') {
      const list = doc.getElementById('news-flash-list'), open = list.hidden;
      list.hidden = !open; button.setAttribute('aria-expanded', String(open));
    }
    schedule();
  }
  async function load() {
    if (!/^https?:$/.test(global.location?.protocol || '')) return;
    try {
      const response = await global.fetch('/api/news', {cache: 'no-store'});
      const data = response.ok ? await response.json() : null;
      const fresh = Array.isArray(data?.items) ? data.items.filter(item => item && item.title) : [];
      if (fresh.length) { items = fresh; render(); }
    } catch {}
  }
  function init() {
    const bar = doc?.getElementById?.('news-flash'); if (!bar) return;
    bar.addEventListener('click', onClick);
    // Hold still while someone is reading or using the bar.
    bar.addEventListener('mouseenter', () => { holding = true; schedule(); });
    bar.addEventListener('mouseleave', () => { holding = false; schedule(); });
    bar.addEventListener('focusin', () => { holding = true; schedule(); });
    bar.addEventListener('focusout', () => { holding = false; schedule(); });
    load();
    global.setInterval(load, REFRESH_MS);
  }
  global.NewsFlash = {itemHtml, safeUrl, onClick, setItems(list) { items = list; render(); }, load};
  if (doc?.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, {once: true}); else init();
})(window);
