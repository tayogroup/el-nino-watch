import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseRss, itemsFrom, merge, appItems, classify, loadNews, NEWS_SOURCES, EXCLUDED_OUTLETS, excludedOutlet, isEventAnnouncement} from './somalia-flood-watch/news-feed.mjs';

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
  assert.deepEqual(without.items.map(item => item.title), ['Digniinta fatahaadaha', 'El Niño flood warning']);
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
