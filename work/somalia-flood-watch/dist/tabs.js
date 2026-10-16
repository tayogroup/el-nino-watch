/* El Nino Watch: horizontal section tabs for the public view.
   Each top-level block in <main> names its tab with data-site-tab; blocks without
   one (disclaimer, hero, live bar, mayor shell) stay on every tab. Nothing is
   moved, only hidden, so the mayor view and its own tool routing are unchanged:
   in mayor view the tab bar is hidden by mayor.css and these rules do not apply.
   Loaded before app.js, which reads window.SiteTabs for links and the URL. */
(function () {
  'use strict';
  const TABS = ['overview', 'weather', 'map', 'alerts', 'diseases', 'community', 'sources'];
  const doc = document, body = doc.body;
  const nav = doc.getElementById('site-tabs');
  // The sticky card holding the city control and the tabs (the tabs alone if absent).
  const bar = doc.getElementById('site-bar') || nav;
  if (!nav || !body) return;
  const links = [...nav.querySelectorAll('[data-site-tab-link]')];
  // A block may belong to several tabs (data-site-tab="map weather"); inside it,
  // data-site-tab-part says which of those tabs each part is shown on.
  const blocks = () => [...doc.querySelectorAll('main > [data-site-tab]')];
  const parts = () => [...doc.querySelectorAll('main > [data-site-tab] [data-site-tab-part]')];
  const tabsOf = element => (element.dataset.siteTab || '').split(/\s+/).filter(Boolean);
  const mayor = () => body.classList.contains('mayor-view');
  // After the DOM update, not on an animation frame: frames are skipped while the
  // page is not painted (a background tab, an off-screen webview), and reading
  // sizes forces the layout anyway.
  const nextFrame = fn => setTimeout(fn, 0);
  const tabOf = element => element?.closest?.('[data-site-tab-part]')?.dataset.siteTabPart
    || (element?.closest?.('main > [data-site-tab]') && tabsOf(element.closest('main > [data-site-tab]'))[0]) || null;
  let current = 'overview';

  function hashParams() { return new URLSearchParams((location.hash || '').replace(/^#/, '')); }
  function fromHash() {
    const p = hashParams(), tab = p.get('tab');
    return TABS.includes(tab) && p.get('view') !== 'mayor' && !p.has('tool') ? tab : 'overview';
  }
  function writeHash() {
    if (!window.history?.replaceState || mayor()) return;
    const p = hashParams();
    // A shared section anchor (#health-film) is not state to carry to another tab.
    for (const [key, value] of [...p]) if (!value && /^[\w-]+$/.test(key) && doc.getElementById(key)) p.delete(key);
    if (current === 'overview') p.delete('tab'); else p.set('tab', current);
    const next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : location.pathname + location.search);
  }
  // Keep the nav links app.js wires (top and bottom bars) in step with the tab.
  // A tab with no manager tool (Diseases) has its own phone bottom-bar link, marked here alone: app.js
  // knows only the tool links. The in-page click handler below opens it, in either view.
  function markTabLinks() {
    doc.querySelectorAll('[data-site-tab-target]').forEach(link => {
      if (!mayor() && link.dataset.siteTabTarget === current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  }
  function markLinks() {
    markTabLinks();
    if (mayor()) return;
    doc.querySelectorAll('[data-manager-tool], [data-dashboard-view]').forEach(link => {
      const active = link.dataset.dashboardView ? link.dataset.dashboardView === 'public' && current === 'overview' : link.dataset.managerTool === current;
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  }
  function apply(animate) {
    body.dataset.siteTab = current;
    for (const link of links) {
      const on = link.dataset.siteTabLink === current;
      link.setAttribute('aria-selected', String(on));
      link.tabIndex = on ? 0 : -1;
    }
    for (const block of blocks()) {
      const on = tabsOf(block).includes(current);
      block.classList.toggle('site-tab-hidden', !on);
      if (on && animate) { block.classList.remove('site-tab-enter'); void block.offsetWidth; block.classList.add('site-tab-enter'); }
    }
    for (const part of parts()) part.classList.toggle('site-tab-part-hidden', part.dataset.siteTabPart !== current);
    // On narrow screens the strip scrolls sideways; keep the open tab in it
    // without moving the page vertically.
    const strip = nav.querySelector('.site-tabs-inner'), open = links.find(link => link.dataset.siteTabLink === current);
    if (strip && open && (open.offsetLeft < strip.scrollLeft || open.offsetLeft + open.offsetWidth > strip.scrollLeft + strip.clientWidth)) strip.scrollTo?.({left: Math.max(0, open.offsetLeft - 12)});
  }
  // The header is sticky on wide screens and its height changes with width, so the
  // tab bar sits under whatever header height is measured now.
  function headerOffset() {
    const header = doc.querySelector('.site-header');
    return header && getComputedStyle(header).position === 'sticky' ? header.offsetHeight : 0;
  }
  function placeBar() { bar?.style.setProperty('--site-tabs-top', headerOffset() + 'px'); }
  // Bring the new tab's content into view: from far down the page, and also from
  // the top on phones, where the hero pushes the tabs below the bottom nav.
  function scrollToTabs() {
    const rect = bar.getBoundingClientRect(), top = rect.top + window.scrollY - headerOffset();
    // 'instant', not 'auto': the site sets html{scroll-behavior:smooth}, and a smooth
    // scroll is cancelled by the re-render that follows a bottom-nav tap.
    if (window.scrollY > top + 4 || rect.top > window.innerHeight * 0.5) window.scrollTo({top, behavior: 'instant'});
  }
  // Content measured while hidden (the Leaflet map, charts) needs a fresh size;
  // scroll once that layout has settled.
  function refreshLayout(scroll) {
    nextFrame(() => {
      if (current === 'map') window.FloodExplorer?.resize?.();
      window.dispatchEvent(new Event('resize'));
      if (scroll) scrollToTabs();
    });
  }

  function show(tab, {scroll = true, focus = false} = {}) {
    if (!TABS.includes(tab)) return false;
    const changed = tab !== current;
    current = tab;
    apply(changed);
    markLinks();
    writeHash();
    if (changed) refreshLayout(scroll);
    // For visits.js (anonymous tab counts).
    if (changed) window.dispatchEvent(new CustomEvent('site-tab-change', {detail: {tab}}));
    if (focus) links.find(link => link.dataset.siteTabLink === tab)?.focus();
    return true;
  }

  nav.addEventListener('click', event => {
    const link = event.target.closest('[data-site-tab-link]');
    if (!link) return;
    event.preventDefault();
    show(link.dataset.siteTabLink);
  });
  nav.addEventListener('keydown', event => {
    const index = links.indexOf(doc.activeElement);
    if (index < 0) return;
    const next = {ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: links.length - 1}[event.key];
    if (next === undefined) return;
    event.preventDefault();
    show(links[(next + links.length) % links.length].dataset.siteTabLink, {focus: true, scroll: false});
  });

  // In-page anchors (hero buttons, skip link) to a block on another tab open that
  // tab instead of the browser jumping to a hidden element. Links app.js wires
  // ([data-manager-tool], [data-dashboard-view]) are left to app.js.
  // In the city manager view, a link to a section inside one of its tools opens that tool and scrolls
  // there, rather than changing the address, which would leave the view. A section on a tab the view has
  // no tool for (the Diseases tab: the health alert and the films, linked from the footer and the film
  // notes) leaves the view for that public tab instead of landing on the top of the page.
  const TOOL_PANELS = {alerts: 'alerts-panel', map: 'map-panel', weather: 'daily-panel', community: 'community-panel'};
  function openInMayor(event) {
    const link = event.target.closest?.('a[href^="#"]');
    if (!link || link.dataset.managerTool || link.dataset.dashboardView) return;
    const id = decodeURIComponent(link.getAttribute('href').slice(1));
    const target = id && /^[\w-]+$/.test(id) ? doc.getElementById(id) : null;
    if (!target) return;
    const tool = Object.keys(TOOL_PANELS).find(key => target.closest('#' + TOOL_PANELS[key]));
    if (tool && window.MayorNavigation?.open) {
      event.preventDefault();
      event.stopPropagation();
      window.MayorNavigation.open(tool);
      nextFrame(() => target.scrollIntoView({behavior: 'smooth', block: 'start'}));
      return;
    }
    const tab = !tool && tabOf(target);
    if (tab) {
      event.preventDefault();
      event.stopPropagation();
      leaveMayor();
      show(tab, {scroll: false});
      nextFrame(() => target.scrollIntoView({behavior: 'instant', block: 'start'}));
    }
  }
  // Back to the public page, the way its "All 30 cities" link does it (app.js wires that link).
  function leaveMayor() { doc.querySelector('[data-dashboard-view="public"]')?.click(); }
  doc.addEventListener('click', event => {
    if (event.defaultPrevented) return;
    if (mayor()) return openInMayor(event);
    const link = event.target.closest?.('a[href^="#"]');
    if (!link || link.closest('#site-tabs') || link.dataset.managerTool || link.dataset.dashboardView) return;
    const id = decodeURIComponent(link.getAttribute('href').slice(1));
    const target = id && /^[\w-]+$/.test(id) ? doc.getElementById(id) : null;
    const tab = tabOf(target);
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    show(tab, {scroll: false});
    nextFrame(() => {
      target.scrollIntoView({behavior: 'smooth', block: 'start'});
      if (link.classList.contains('skip-link')) { target.tabIndex = target.tabIndex < 0 ? -1 : target.tabIndex; target.focus?.({preventScroll: true}); }
    });
  }, true);

  // The app scrolls to things it wants seen (the map, the report form, a report).
  // If that thing is on another tab, open the tab first.
  const nativeScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...args) {
    if (!mayor()) { const tab = tabOf(this); if (tab && tab !== current) show(tab, {scroll: false}); }
    return nativeScroll.apply(this, args);
  };

  // Count badges: alert cards and community reports.
  function badge(tab, count) {
    const el = nav.querySelector(`[data-site-tab-link="${tab}"] .site-tab-badge`);
    if (!el) return;
    el.textContent = count > 99 ? '99+' : String(count);
    el.hidden = !(count > 0);
  }
  const alertsList = doc.getElementById('alerts-list'), reports = doc.getElementById('reports');
  const countAlerts = () => badge('alerts', alertsList ? alertsList.querySelectorAll('.alert-card').length : 0);
  const countReports = () => badge('community', Number.parseInt(reports?.textContent || '0', 10) || 0);
  if (window.MutationObserver) {
    if (alertsList) new MutationObserver(countAlerts).observe(alertsList, {childList: true, subtree: true});
    if (reports) new MutationObserver(countReports).observe(reports, {childList: true, characterData: true, subtree: true});
  }
  countAlerts(); countReports();

  // Leaving the mayor view returns to whichever tab was open.
  if (window.MutationObserver) new MutationObserver(() => { if (!mayor()) { apply(false); markLinks(); } else markTabLinks(); }).observe(body, {attributes: true, attributeFilter: ['class']});

  placeBar();
  window.addEventListener('resize', placeBar);
  current = fromHash();
  body.classList.add('site-tabs-ready');
  apply(false);
  markTabLinks();

  // A shared link to a section (#health-film, from the film's Share row) opens its tab and brings the
  // section into view. Content above it (the alert list) arrives seconds later and pushes it down, so it is
  // kept in view as the page fills, until the reader scrolls, taps or types, or 15 seconds pass.
  const linkedId = /^#[\w-]+$/.test(location.hash) ? location.hash.slice(1) : '';
  const linked = linkedId && !mayor() ? doc.getElementById(linkedId) : null;
  const linkedTab = linked && tabOf(linked);
  if (linkedTab) {
    show(linkedTab, {scroll: false});
    // Keep the address as the shared link (show() wrote #tab=...), so a reload or a copy lands here again.
    window.history?.replaceState?.(null, '', location.pathname + location.search + '#' + linkedId);
    let follow = true;
    const stop = () => { follow = false; };
    for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) window.addEventListener(type, stop, {once: true, passive: true});
    setTimeout(stop, 15000);
    const bring = () => { if (follow) linked.scrollIntoView({block: 'start', behavior: 'instant'}); };
    nextFrame(bring);
    const panel = linked.closest('main > [data-site-tab]');
    if (panel && window.MutationObserver) {
      const watcher = new MutationObserver(() => { if (follow) bring(); else watcher.disconnect(); });
      watcher.observe(panel, {childList: true, subtree: true});
      setTimeout(() => watcher.disconnect(), 15000);
    }
  }

  window.SiteTabs = Object.freeze({
    show,
    leaveMayor,
    get current() { return current; },
    tabs: TABS.slice()
  });
})();
