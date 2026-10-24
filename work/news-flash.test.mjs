import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import vm from 'node:vm';
import {HEALTH_FLASH, FILM_FLASH, FILMS_FLASH, FIELD_FLASH, FIELD_VIDEOS_SHOWN, parseRss, itemsFrom, merge, appItems, classify, loadNews, NEWS_SOURCES, EXCLUDED_OUTLETS, excludedOutlet, isEventAnnouncement} from './somalia-flood-watch/news-feed.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const day = n => new Date(NOW - n * 86400000).toUTCString();
const rss = items => `<?xml version="1.0"?><rss><channel>${items.map(item => `<item><title>${item.title}</title><link>${item.link || 'https://example.org/a'}</link><pubDate>${item.date}</pubDate>${item.source ? `<source url="https://${item.source.toLowerCase().replace(/\W+/g, '')}.org">${item.source}</source>` : ''}</item>`).join('')}</channel></rss>`;

test('RSS is read with CDATA, entities, and SoDMA\'s bold letters turned back into plain text', () => {
  const [item] = parseRss(rss([{title: '<![CDATA[𝐒𝐨𝐃𝐌𝐀 oo &#8220;El Niño&#8221; &amp; fatahaad]]>', date: day(1), source: 'SoDMA'}]));
  assert.equal(item.title, 'SoDMA oo “El Niño” & fatahaad');
  assert.equal(item.sourceName, 'SoDMA'); assert.equal(item.link, 'https://example.org/a');
  assert.equal(parseRss(rss([{title: 'x', link: 'javascript:alert(1)', date: day(1)}]))[0].link, null, 'only web links');
});

test('each source keeps recent, relevant items, labelled by who published them', () => {
  const sodma = itemsFrom('sodma', parseRss(rss([
    {title: 'War-bixinta toddobaadlaha ee digniinaha khatarta fatahaadaha', date: day(2)},
    {title: 'SoDMA oo daahfurtay tababar Ebola', date: day(1)},
    {title: 'Diyaar-garowga El Niño', date: day(40)}
  ])), NOW);
  assert.deepEqual(sodma.map(item => item.title), ['War-bixinta toddobaadlaha ee digniinaha khatarta fatahaadaha'], 'off-topic and older than 30 days are dropped');
  assert.equal(sodma[0].group, 'government'); assert.equal(sodma[0].language, 'so');
  const google = itemsFrom('googleElNino', parseRss(rss([
    {title: 'Somalia: As El Niño floods loom - ICRC', date: day(2), source: 'ICRC'},
    {title: 'El Niño threatens Somali farms - BBC', date: day(3), source: 'BBC'},
    {title: 'UK gives £5 million for El Niño in Somalia - GOV.UK', date: day(20), source: 'GOV.UK'},
    {title: 'WFP warns on Somalia hunger as El Niño strengthens - UN World Food Programme', date: day(4), source: 'UN World Food Programme'},
    {title: 'Details | FAO in Somalia', date: day(1), source: 'FAO'},
    {title: 'Football results', date: day(1), source: 'BBC'}
  ])), NOW);
  assert.deepEqual(google.map(item => [item.title, item.group]), [['Somalia: As El Niño floods loom', 'humanitarian'], ['El Niño threatens Somali farms', 'media'], ['WFP warns on Somalia hunger as El Niño strengthens', 'un'], ['UK gives £5 million for El Niño in Somalia', 'government']], 'the " - Publisher" suffix goes; page titles and off-topic items are dropped');
  assert.equal(classify('www.icrcnewsroom.org'), 'humanitarian');
  assert.equal(classify('Red Cross Red Crescent Climate Centre'), 'humanitarian');
  assert.equal(classify('OCHA'), 'un'); assert.equal(classify('Horn Observer'), 'media');
  assert.equal(classify('Gavi, the Vaccine Alliance'), 'humanitarian');
  assert.ok(itemsFrom('swalim', parseRss(rss([{title: 'Strong El Niño raises Deyr flood risk', date: day(31)}, {title: 'Land use training', date: day(2)}])), NOW).every(item => /El Niño/.test(item.title)), 'SWALIM: flood, rain and El Niño items only, up to 60 days');
});

test('excluded outlets are left out by web address, with the reason recorded', () => {
  const feed = `<rss><channel>${[
    ['Super El Niño may push Somalis into hunger', 'Genocide Watch', 'https://www.genocidewatch.com'],
    ['Somalia El Niño explained', 'Wansom AI', 'https://www.wansom.ai'],
    ['Somalia braces for El Niño floods', 'Yahoo', 'https://www.yahoo.com'],
    ['Somalia braces for El Niño floods (original)', 'Horn Observer', 'https://hornobserver.com']
  ].map(([title, name, url]) => `<item><title>${title} - ${name}</title><link>https://news.google.com/x</link><pubDate>${day(1)}</pubDate><source url="${url}">${name}</source></item>`).join('')}</channel></rss>`;
  assert.deepEqual(itemsFrom('googleElNino', parseRss(feed), NOW).map(item => item.source), ['Horn Observer']);
  assert.equal(excludedOutlet('https://news.genocidewatch.com/')?.[1], 'advocacy group, not a news outlet', 'subdomains too');
  assert.equal(excludedOutlet('https://notyahoo.com/'), null, 'only the outlet itself, not look-alike names');
  assert.ok(excludedOutlet('https://sonna.so/'), 'SONNA is left out');
  assert.ok(excludedOutlet('https://centralnews.co.za/'), 'Central News South Africa is left out');
  assert.ok(excludedOutlet('https://gazettengr.com/'), 'Peoples Gazette Nigeria is left out');
  for (const url of ['https://www.dawan.africa/', 'https://somaliatoday.com/', 'https://www.newvision.co.ug/', 'https://www.telesurenglish.net/', 'https://www.middleeastmonitor.com/', 'https://www.devdiscourse.com/']) assert.ok(excludedOutlet(url), `${url} is left out`);
  for (const url of ['https://www.hiiraan.com/', 'https://hornobserver.com/', 'https://shabellemedia.com/', 'https://www.garoweonline.com/', 'https://www.ftlsomalia.com/', 'https://www.bbc.co.uk/', 'https://www.africanews.com/', 'https://www.channelafrica.co.za/', 'https://floodlist.com/', 'https://reliefweb.int/', 'https://www.icrc.org/']) assert.equal(excludedOutlet(url), null, `${url} is kept`);
});

test('meeting and event announcements are left out, in Somali and English; warnings and news stay', () => {
  const titles = [
    "Guddoomiyaha Hay'adda SoDMA oo UN OCHA Kala Hadlay Diyaar-garowga Super El Niño iyo Saameynta Fatahaadaha.",
    'Guddoomiyaha SoDMA oo Muqdisho ku Soo Xiray Meertada 3-aad ee Shirweynaha U Adkaysiga Aafooyinka',
    'SoDMA oo Afmadow ka Samaysay Wacyigelin ku Saabsan Diyaar-garowga iyo Khataraha El Niño.',
    "Hay'adda SoDMA oo Muqdisho ku soo xiray shir ku saabsan u-diyaargarowga El Niño 2026.",
    'Somali Red Crescent Society, ICRC train 72 responders ahead of expected El Niño floods',
    'OCHA convenes El Niño preparedness meeting in Mogadishu',
    'WAR-BIXINTA TODDOBAADLAHA EE DIGNIINAHA KHARTA FATAHAADAHA.',
    'Two Boats for 30 Villages: OCHA Warns Doolow Underprepared for El Niño Floods',
    'UK announces £5 million to help Somali communities prepare for El Niño flooding',
    'Strong El Niño raises risk of severe Deyr flooding in Somalia'
  ];
  assert.deepEqual(titles.filter(title => !isEventAnnouncement(title)), titles.slice(6));
  const sodma = itemsFrom('sodma', parseRss(rss(titles.slice(0, 4).concat(titles[6]).map(title => ({title, date: day(1)})))), NOW);
  assert.deepEqual(sodma.map(item => item.title), [titles[6]], "SoDMA's weekly flood-warning bulletin stays; its meetings and events go");
  assert.ok(EXCLUDED_OUTLETS.every(([domain, reason]) => /^[a-z0-9.-]+\.[a-z]+$/.test(domain) && reason.length > 10), 'each exclusion has a reason');
});

test('ICRC is a source of its own: Somalia items from its worldwide feed, labelled humanitarian', () => {
  const icrc = itemsFrom('icrc', parseRss(rss([
    {title: 'Somalia: As El Niño floods loom, millions could face further hardship and hunger', date: day(2)},
    {title: 'Donetsk: The quiet that conflict takes away', date: day(1)},
    {title: 'Somali Red Crescent and ICRC train volunteers', date: day(3)},
    {title: 'Somalia: water trucking reaches Gedo', date: day(70)}
  ])), NOW);
  assert.deepEqual(icrc.map(item => [item.title, item.source, item.group]), [['Somalia: As El Niño floods loom, millions could face further hardship and hunger', 'ICRC', 'humanitarian']], 'other countries, training events and items older than 60 days are left out');
  assert.equal(NEWS_SOURCES.icrc.url, 'https://www.icrc.org/en/rss/news');
  const viaSearch = itemsFrom('googleIcrc', parseRss(rss([
    {title: 'Somalia: As El Niño floods loom - www.icrcnewsroom.org', date: day(2), source: 'www.icrcnewsroom.org'},
    {title: 'Frequently asked questions: Our work in Somalia - ICRC', date: day(5), source: 'ICRC'}
  ])), NOW);
  assert.deepEqual(viaSearch.map(item => [item.title, item.source]), [['Somalia: As El Niño floods loom', 'ICRC']], "ICRC's newsroom is credited to ICRC; information pages are not news");
  assert.match(decodeURIComponent(NEWS_SOURCES.googleIcrc.url), /site:icrc\.org OR site:icrcnewsroom\.org/);
});

test('the same story from two searches appears once, newest first, at most 30 items', () => {
  const a = {title: 'Somalia braces for El Niño floods', publishedAt: '2026-10-14T00:00:00.000Z'}, b = {title: 'Somalia braces for El Niño floods!', publishedAt: '2026-10-13T00:00:00.000Z'}, c = {title: 'Another story', publishedAt: '2026-10-15T00:00:00.000Z'};
  assert.deepEqual(merge([[a, c], [b]]).map(item => item.title), ['Another story', 'Somalia braces for El Niño floods']);
  assert.equal(merge([Array.from({length: 40}, (_, i) => ({title: `Story ${i}`, publishedAt: new Date(NOW - i * 3600000).toISOString()}))]).length, 30);
});

test('the app\'s own flashes: NOAA\'s El Niño status and how many cities ICPAC forecasts heavy rain for', () => {
  const items = appItems({
    enso: {available: true, alertStatus: 'El Niño Advisory', synopsis: 'El Niño continues to strengthen.', issuedAt: '2026-10-08', sourceUrl: 'https://www.cpc.ncep.noaa.gov/'},
    alerts: {available: true, sources: [{id: 'icpac', available: true, fetchedAt: '2026-10-15T10:00:00Z', forecast: {weekLabel: '13 Oct–20 Oct'}}], alerts: [{sourceId: 'icpac', scope: {cities: ['Baidoa']}}, {sourceId: 'icpac', scope: {cities: ['Jowhar']}}, {sourceId: 'icpac', scope: {cities: ['Baidoa']}}, {sourceId: 'gdacs', scope: {cities: ['Kismayo']}}]}
  });
  assert.equal(items[0].title, 'El Niño Advisory: El Niño continues to strengthen.');
  assert.equal(items[1].title, '2 of 30 cities have a heavy-rainfall forecast for 13 Oct–20 Oct');
  assert.equal(items[1].url, '#tab=alerts');
  assert.equal(appItems({enso: {available: false}, alerts: {available: false}}).length, 0, 'nothing from a feed that is down');
});

test('loading: each source on its own, SWALIM\'s HTTP 500 feed accepted, ReliefWeb only with an approved appname', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({url, options});
    const text = url.startsWith(NEWS_SOURCES.sodma.url) ? rss([{title: 'Digniinta fatahaadaha', date: day(1)}])
      : url.startsWith(NEWS_SOURCES.swalim.url) ? rss([{title: 'El Niño flood warning', date: day(3)}])
      : url.includes('reliefweb') ? JSON.stringify({data: [{fields: {title: 'Somalia: Deyr floods flash update', url_alias: 'https://reliefweb.int/report/somalia/x', date: {created: '2026-10-14T08:00:00+00:00'}, source: [{shortname: 'OCHA'}]}}]})
      : null;
    if (text === null) return {ok: false, status: 503, text: async () => 'unavailable'};
    return {ok: !url.startsWith(NEWS_SOURCES.swalim.url), status: url.startsWith(NEWS_SOURCES.swalim.url) ? 500 : 200, text: async () => text, json: async () => JSON.parse(text)};
  };
  const without = await loadNews({fetchImpl, now: NOW, reliefWebAppname: ''});
  assert.deepEqual(without.items.map(item => item.title), [FIELD_FLASH.title, HEALTH_FLASH.title, FILM_FLASH.title, FILMS_FLASH.title, 'Digniinta fatahaadaha', 'El Niño flood warning'], 'the field videos, the health flash and the films lead the headlines');
  assert.equal(without.sources.find(source => source.id === 'googleElNino').available, false, 'a failing source is reported, not fatal');
  assert.match(without.sources.find(source => source.id === 'reliefweb').error, /RELIEFWEB_APPNAME/);
  assert.equal(requests.some(request => request.url.includes('reliefweb')), false, 'no ReliefWeb call without an appname');
  const withAppname = await loadNews({fetchImpl, now: NOW, reliefWebAppname: 'elninowatch-approved'});
  const relief = withAppname.items.find(item => item.feed === 'reliefweb');
  assert.equal(relief.title, 'Somalia: Deyr floods flash update'); assert.equal(relief.group, 'un');
  assert.ok(requests.find(request => request.url.includes('reliefweb')).url.includes('appname=elninowatch-approved'));
  await assert.rejects(loadNews({fetchImpl: async () => ({ok: false, status: 503, text: async () => ''}), now: NOW, reliefWebAppname: ''}), /No news source answered/);
});

test('the bar: headlines as published and escaped, links open safely, the app\'s ICPAC sentence is translatable', async () => {
  const document = {readyState: 'complete', getElementById: () => null, addEventListener() {}};
  const window = {document, location: {protocol: 'http:'}, setInterval() {}, setTimeout() {}, clearTimeout() {}, matchMedia: () => ({matches: false}), fetch: async () => ({ok: false})};
  vm.runInContext(await readFile(new URL('./somalia-flood-watch/dist/news-flash.js', import.meta.url), 'utf8'), vm.createContext({window, URL}));
  const {itemHtml, safeUrl} = window.NewsFlash;
  const headline = itemHtml({kind: 'news', title: '<b>Floods</b> "loom"', url: 'https://example.org/story', source: 'ICRC', group: 'humanitarian', language: 'en', publishedAt: '2026-10-13T08:00:00Z'});
  assert.ok(headline.includes('&lt;b&gt;Floods&lt;/b&gt; &quot;loom&quot;') && !headline.includes('<b>Floods'));
  assert.match(headline, /<span class="news-flash-title" data-i18n-skip lang="en">/);
  assert.match(headline, /href="https:\/\/example\.org\/story" target="_blank" rel="noopener"/);
  assert.match(headline, /news-flash-humanitarian">Humanitarian</);
  assert.equal(safeUrl('javascript:alert(1)'), null); assert.equal(safeUrl('#tab=alerts'), '#tab=alerts'); assert.equal(safeUrl('#tab=x"y'), null);
  const icpac = itemHtml({kind: 'app', key: 'icpac', label: 'Rainfall forecast · ICPAC', title: '16 of 30 cities have a heavy-rainfall forecast for 13 Oct–20 Oct', url: '#tab=alerts', source: 'ICPAC', group: 'app'});
  assert.match(icpac, /<span class="news-flash-title">16 of 30 cities/, 'translated through the catalogue pattern');
  assert.ok(!icpac.includes('target="_blank"'), 'an in-app link stays in the page');
});

test('the health flash: a standing item that opens the health alert, translated, and never hiding an outage', async () => {
  assert.deepEqual({...HEALTH_FLASH}, {kind: 'app', key: 'health', label: 'Public health · WHO guidance', title: 'Flooding raises the risk of cholera, malaria and dengue: what to do', url: '#health-alert', publishedAt: null, source: 'WHO', group: 'app', language: 'en'});
  const index = await readFile(new URL('./somalia-flood-watch/dist/index.html', import.meta.url), 'utf8');
  assert.ok(index.includes('id="health-alert"'), 'the section it points to exists');
  const opened = [], scrolled = [];
  // The health alert is on the Diseases tab, which the city manager view has no tool for.
  const healthSection = {closest: selector => selector === '#diseases-panel' ? {} : null, scrollIntoView() { scrolled.push('health-alert'); }};
  for (const mayorView of [false, true]) {
    opened.length = 0; scrolled.length = 0;
    const document = {readyState: 'complete', body: {classList: {contains: name => mayorView && name === 'mayor-view'}}, getElementById: id => id === 'health-alert' ? healthSection : null, addEventListener() {}};
    const window = {document, location: {protocol: 'http:'}, setInterval() {}, setTimeout: fn => fn(), clearTimeout() {}, matchMedia: () => ({matches: false}), fetch: async () => ({ok: false}), MayorNavigation: {open: tool => opened.push(tool)}, SiteTabs: {leaveMayor: () => opened.push('public page')}};
    vm.runInContext(await readFile(new URL('./somalia-flood-watch/dist/news-flash.js', import.meta.url), 'utf8'), vm.createContext({window, URL}));
    const html = window.NewsFlash.itemHtml(HEALTH_FLASH);
    assert.match(html, /<a class="news-flash-link" href="#health-alert">/, 'an in-page link, not a new tab');
    assert.match(html, /<span class="news-flash-title">Flooding raises the risk/, 'the title is translatable');
    let prevented = false;
    const link = {getAttribute: () => '#health-alert', closest: selector => selector === 'a.news-flash-link' ? link : null};
    window.NewsFlash.onClick({target: link, preventDefault() { prevented = true; }});
    assert.equal(prevented, true);
    assert.deepEqual(scrolled, ['health-alert']);
    assert.deepEqual(opened, mayorView ? ['public page'] : [], mayorView ? 'the city manager view goes back to the public page, where tabs.js opens the Diseases tab' : 'the public page leaves the tab to tabs.js');
  }
  assert.equal(globalThis.NewsFlash, undefined);
});

test('the film flash: a standing item that opens the cholera film, in Somali too', async () => {
  assert.deepEqual({...FILM_FLASH}, {kind: 'app', key: 'film', label: 'Film · Cholera', title: 'Watch: how to protect your family from cholera', url: '#health-film', publishedAt: null, source: 'El Nino Watch', group: 'app', language: 'en'});
  const index = await readFile(new URL('./somalia-flood-watch/dist/index.html', import.meta.url), 'utf8');
  assert.ok(index.includes('<video id="health-film"'), 'the film it points to exists');
  const document = {readyState: 'complete', getElementById: () => null, addEventListener() {}};
  const window = {document, location: {protocol: 'http:'}, setInterval() {}, setTimeout() {}, clearTimeout() {}, matchMedia: () => ({matches: false}), fetch: async () => ({ok: false})};
  vm.runInContext(await readFile(new URL('./somalia-flood-watch/dist/news-flash.js', import.meta.url), 'utf8'), vm.createContext({window, URL}));
  const html = window.NewsFlash.itemHtml(FILM_FLASH);
  assert.match(html, /<a class="news-flash-link" href="#health-film">/, 'an in-page link, not a new tab');
  assert.match(html, /<span class="news-flash-title">Watch: how to protect/, 'the title is translatable');
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  assert.equal(catalog.messages[FILM_FLASH.label], 'Filim · Daacuun');
  assert.equal(catalog.messages[FILM_FLASH.title], 'Daawo: sida qoyskaaga looga ilaaliyo daacuunka');
});

test('videos from the field: Cabudwaaq, Jowhar, Dalsan and Xingod flooding on the home page as thumbnails, without sound; the Xingod sand dam kept hidden (owner, 2026-10-17)', async () => {
  assert.equal(FIELD_VIDEOS_SHOWN, true, 'the news-flash item is on');
  assert.deepEqual({...FIELD_FLASH}, {kind: 'app', key: 'field', label: 'Videos from the field', title: 'Watch: flooding in Cabudwaaq, Jowhar, Dalsan and Xingod', url: '#field-videos', publishedAt: null, source: 'El Nino Watch', group: 'app', language: 'en'});
  const index = await readFile(new URL('./somalia-flood-watch/dist/index.html', import.meta.url), 'utf8');
  assert.ok(index.includes('</details></div><section class="panel field-videos" id="field-videos" data-site-tab="overview" aria-labelledby="field-videos-title"><div'), 'on the home page, straight after the audio bulletin, shown');
  const section = index.slice(index.indexOf('id="field-videos"'), index.indexOf('</section>', index.indexOf('id="field-videos"')));
  // The silent Cabudwaaq clip has a new name: the CDN keeps a file for an hour and ignores query strings, so the
  // old name went on serving the copy with sound after the deploy.
  for (const [id, file, video, shown] of [['cabudwaaq-video', 'cabudwaaq-flooding-17oct', 'cabudwaaq-flooding-17oct', true], ['jowhar-video', 'jowhar-flooding', 'jowhar-flooding', true], ['dalsan-video', 'dalsan-flooding', 'dalsan-flooding', true], ['xingod-flood-video', 'xingod-flooding', 'xingod-flooding', true], ['xingod-video', 'xingod-water-dam', 'xingod-water-dam', false]]) {
    assert.ok(section.includes(`<figure class="field-video${{'xingod-video': '', 'dalsan-video': ' square', 'xingod-flood-video': ' square'}[id] ?? ' wide'}" id="${id}"${shown ? '' : ' hidden'}><button type="button" class="film-thumb-img field-thumb" data-video="film/${video}.mp4" data-poster="film/${file}.jpg"${{'xingod-video': '', 'dalsan-video': ' data-size="540x540"', 'xingod-flood-video': ' data-size="540x540"'}[id] ?? ' data-size="854x480"'} aria-labelledby="${id}-title"><img src="film/thumb-wide-${file}.jpg" alt="" width="480" height="270"`), `${id}: a 16:9 thumbnail, like the films${shown ? '' : ', hidden'}`);
    assert.ok((await stat(new URL(`./somalia-flood-watch/dist/film/${file}.jpg`, import.meta.url))).size > 0);
    const thumb = (await stat(new URL(`./somalia-flood-watch/dist/film/thumb-wide-${file}.jpg`, import.meta.url))).size;
    assert.ok(thumb > 2000 && thumb < 40000, `thumb-wide-${file}.jpg is a small thumbnail`);
    const size = (await stat(new URL(`./somalia-flood-watch/dist/film/${video}.mp4`, import.meta.url))).size;
    assert.ok(size > 0 && size < 8e6, `${video} stays small enough for a phone on mobile data (${size} bytes)`);
  }
  // Without sound: the shown clips have no audio track (an MP4 audio track carries an 'mp4a' sample entry).
  for (const file of ['cabudwaaq-flooding-17oct', 'jowhar-flooding', 'dalsan-flooding', 'xingod-flooding']) {
    const bytes = await readFile(new URL(`./somalia-flood-watch/dist/film/${file}.mp4`, import.meta.url));
    assert.equal(bytes.indexOf('mp4a'), -1, `${file} has no audio track`);
  }
  assert.ok(!section.includes('<video'), 'thumbnails, not players, until tapped');
  assert.match(section, /17 October 2026\. Video: Af-hayeenka Umada Soomaaliyeed, via Facebook\./, 'the Cabudwaaq clip credits who filmed it');
  assert.match(section, /Video: Guutaale Media\./, 'the Jowhar clip credits who filmed it');
  assert.match(section, /18 October 2026\. Video: Cabdifataax Loore\./, 'the Dalsan clip credits who filmed it');
  assert.match(section, /October 2026\. Video: Been Mashege\./, 'the Xingod clip credits who filmed it');
  // Only the water-only opening of the Xingod clip (owner, 2026-10-25): the rest shows young boys' faces.
  assert.ok(section.includes('data-video="film/xingod-flooding.mp4"') && section.includes('>0:07</span>'), 'the Xingod clip is the 7-second opening');
  assert.ok((await stat(new URL('./somalia-flood-watch/dist/film/xingod-flooding.mp4', import.meta.url))).size < 1e6, 'a 7-second clip, not the whole 1:17');
  assert.ok(!index.includes('mudug-video') && !index.includes('mudug-flooding'), 'the Mudug clip is gone (owner, 2026-10-20)');
  const css = await readFile(new URL('./somalia-flood-watch/dist/alerts.css', import.meta.url), 'utf8');
  assert.match(css, /\.field-video\.square video\{aspect-ratio:1\/1\}/, 'a square clip plays square');
  assert.match(css, /\.field-video\.wide\.playing\{grid-column:1\/-1\}/, 'a landscape clip plays across the row');
  assert.match(section, /without sound\. Like community reports, they are unverified\./, 'marked unverified, like community reports');
  const footer = index.slice(index.indexOf('<footer class="site-footer'), index.indexOf('</footer>'));
  assert.ok(footer.includes('<a href="#field-videos">Flood videos: Cabudwaaq, Jowhar, Dalsan and Xingod</a>'), 'its footer link, shown');
  const shell = await readFile(new URL('./somalia-flood-watch/dist/shell.css', import.meta.url), 'utf8');
  assert.match(shell, /main>#field-videos\{order:-1\}/, 'phone: under the bulletin');
  assert.match(shell, /:has\(>#podcast:not\(\[hidden\]\)\):has\(>#field-videos:not\(\[hidden\]\)\)\{grid-template-areas:"nav pod pod" "nav field field" "nav films films" "nav disc disc"/, 'desktop: under the bulletin');
  // A tap puts a silent player in the thumbnail's place and starts it.
  const alerts = await readFile(new URL('./somalia-flood-watch/dist/alerts.js', import.meta.url), 'utf8');
  assert.match(alerts, /closest\?\.\('\.field-thumb\[data-video\]'\)[\s\S]{0,200}createElement\('video'\)[\s\S]{0,120}video\.muted = true[\s\S]{0,600}thumb\.replaceWith\(video\)/);
  const catalog = JSON.parse(await readFile(new URL('./i18n-public.json', import.meta.url), 'utf8'));
  for (const text of [FIELD_FLASH.label, FIELD_FLASH.title, 'FROM THE FIELD · UNVERIFIED VIDEOS', 'Rain and flooding, October 2026', 'Cabudwaaq, Galgaduud: homes under water', '17 October 2026. Video: Af-hayeenka Umada Soomaaliyeed, via Facebook. Do not walk or drive through moving water.', 'Jowhar, Middle Shabelle: the river floods Maandheere and Bayaxaaw', 'October 2026. Video: Guutaale Media. Do not walk or drive through moving water.', 'Videos shared with El Nino Watch, without sound. Like community reports, they are unverified.', 'Flood videos: Cabudwaaq, Jowhar, Dalsan and Xingod', 'Xingod, Mudug: flood water across the plain', '20 October 2026. Video: Been Mashege. Do not walk or drive through moving water.', 'Dalsan, Galdogob: a seasonal river in flood', '18 October 2026. Video: Cabdifataax Loore. Do not walk or drive through moving water.']) {
    assert.ok(catalog.messages[text], `Somali for: ${text}`);
  }
});
