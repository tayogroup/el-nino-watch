import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCommunityHandler } from './somalia-flood-watch/community.mjs';

const nodes = new Map();
class Node {
  constructor(id) { this.id = id; this.innerHTML = ''; this.textContent = ''; this.disabled = false; this.value = ''; this.events = {}; this.classList = { add() {}, remove() {} }; }
  addEventListener(type, handler) { this.events[type] = handler; }
  insertAdjacentHTML(_position, markup) { for (const match of markup.matchAll(/id="([^"]+)"/g)) node(match[1]); }
}
const node = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
const memory = new Map(), calls = [];
let responseReports = [], failFeed = false;
const sandbox = {
  window: { addEventListener() {}, confirm() { return false; } },
  document: { getElementById: node },
  location: { href: 'http://127.0.0.1:4173/', origin: 'http://127.0.0.1:4173', protocol: 'http:' },
  navigator: {},
  localStorage: { getItem(key) { return memory.get(key); }, setItem(key, value) { memory.set(key, value); } },
  Date, URL, Set, AbortController, setTimeout, clearTimeout, FormData,
  fetch: async (url, options) => {
    calls.push({ url, options });
    if (failFeed) return { ok: false, status: 503, json: async () => ({ error: 'Service offline' }) };
    return { ok: true, status: 200, json: async () => ({ reports: responseReports, fetchedAt: '2026-10-13T09:00:00Z' }) };
  }
};
vm.runInNewContext(fs.readFileSync(new URL('./somalia-flood-watch/dist/community.js', import.meta.url), 'utf8'), sandbox);
const api = sandbox.window.CommunityReports;
const cities = [['Mogadishu'], ['Galkayo'], ['Beledweyne']];
const now = new Date('2026-10-13T12:00:00Z');
const draft = { cityId: 'mogadishu', category: 'flood', observedAt: '2026-10-13T14:30', description: 'Water covers the road near the market.', deaths: '', injuries: '0', damagedProperties: '2', latitude: '2.0469', longitude: '45.3182' };
let result = api.validateDraft(draft, cities, now);
assert.equal(result.valid, true);
assert.equal(result.payload.observedAt, '2026-10-13T11:30:00.000Z', 'Somalia local time converts to UTC');
assert.equal(result.payload.deaths, null, 'Blank impact remains unknown');
assert.equal(result.payload.injuries, 0, 'Explicit zero remains zero');
assert.equal(result.payload.damagedProperties, 2);
assert.equal(result.payload.latitude, 2.0469);
assert.equal(api.validateDraft({ ...draft, longitude: '' }, cities, now).valid, false, 'Coordinates must be paired');
assert.equal(api.validateDraft({ ...draft, latitude: '95' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, deaths: '-1' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, injuries: '2.5' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, deaths: '1e3' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, cityId: 'unknown' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, category: 'wildfire' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, description: 'short' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, observedAt: '2026-10-13T18:01' }, cities, now).valid, false, 'Do not accept a future observation');
assert.equal(api.validateDraft({ ...draft, observedAt: '2026-02-30T12:00' }, cities, now).valid, false, 'Do not normalize nonexistent calendar dates');
assert.equal(api.validateDraft({ ...draft, sourceUrl: 'javascript:alert(1)' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, sourceUrl: 'https://user:secret@example.org/' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, latitude: '', longitude: '', sourceUrl: 'https://example.org/source' }, cities, now).valid, true);
assert.equal(api.validateDraft({ ...draft, author: 'A'.repeat(61) }, cities, now).valid, false, 'Display names match the backend 60-character limit');
assert.equal(api.validateDraft({ ...draft, damagedProperties: '100001' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, latitude: '20' }, cities, now).valid, false, 'Coordinates must be in the supported Somalia reporting area');
assert.equal(api.validateDraft({ ...draft, observedAt: '1999-12-31T23:00:00Z' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, observedAt: '2026-02-30T12:00:00Z' }, cities, now).valid, false);
assert.equal(api.validateDraft({ ...draft, sourceUrl: 'https://example.org/' + 'a'.repeat(1000) }, cities, now).valid, false);
assert.equal(api.validateFiles([{ name: 'flood.jpg', type: 'image/jpeg', size: 12000 }, { name: 'rain.mp4', type: 'video/mp4', size: 50000 }]).valid, true);
assert.equal(api.validateFiles([{ name: 'page.html', type: 'text/html', size: 1000 }]).valid, false);
assert.equal(api.validateFiles([{ name: 'huge.mp4', type: 'video/mp4', size: 50 * 1024 * 1024 + 1 }]).valid, false);
assert.equal(api.validateFiles(Array.from({ length: 5 }, () => ({ name: 'photo.png', type: 'image/png', size: 100 }))).valid, false);
assert.equal(api.validateFiles([{ name: 'empty.png', type: 'image/png', size: 0 }]).valid, false);

const malicious = { id: 'report-1', cityId: 'mogadishu', category: 'flood', description: '<script>alert(1)</script>', author: '<img src=x onerror=alert(1)>', observedAt: '2026-10-13T11:30:00Z', deaths: null, injuries: 0, damagedProperties: 2, latitude: 2.04, longitude: 45.31, receivedAt: '2026-10-13T12:00:00Z', sourceUrl: 'javascript:alert(1)', media: [
  { id: 'photo-1', url: '/api/community/media/photo-1.jpg', type: 'image/jpeg', name: 'Flood photo' },
  { id: 'video-1', url: '/api/community/media/video-1.mp4', type: 'video/mp4', name: 'Rain video' },
  { id: 'outside', url: 'https://tracker.example.org/photo.jpg', type: 'image/jpeg', name: 'External image' }
], comments: [{ id: 'comment-1', author: 'A neighbour', body: '<img onerror=alert(1)>', receivedAt: '2026-10-13T12:00:00Z' }] };
let html = api.renderReport(malicious);
assert.equal(html.includes('<script>'), false);
assert.equal(html.includes('&lt;script&gt;'), true);
assert.equal(html.includes('javascript:'), false);
assert.equal(html.includes('tracker.example.org'), false, 'Report media must come from managed same-origin uploads');
assert.equal(html.includes('<video controls preload="metadata" playsinline'), true);
assert.equal(html.includes('<strong>Unknown</strong>'), true);
assert.equal(html.includes('<strong>0</strong>'), true);
assert.equal(html.includes('not official totals'), true);
assert.equal(html.includes('Delete my report'), false);
assert.equal(api.renderReport(malicious, { own: true }).includes('Delete my report'), true);
assert.equal(html.includes('id="community-report-report-1"'), true);
const csv = api.buildExport([{ ...malicious, author: '=CMD()', description: '+malicious formula' }], 'csv');
assert.equal(csv.content.includes('"\'=CMD()"'), true, 'CSV text cannot turn into a spreadsheet formula');
assert.equal(csv.content.includes('"\'+malicious formula"'), true);
assert.equal(csv.content.includes('"0"'), true);
const geojson = api.buildExport([malicious, { ...malicious, id: 'unknown-location', latitude: null, longitude: null }], 'geojson');
const collection = JSON.parse(geojson.content);
assert.equal(collection.features.length, 1, 'Do not invent coordinates for reports without them');
assert.deepEqual(collection.features[0].geometry.coordinates, [45.31, 2.04]);
assert.equal(collection.features[0].properties.deaths, null);
assert.equal(collection.features[0].properties.injuries, 0);
assert.equal(collection.features[0].properties.status, 'unverified');

responseReports = [malicious];
api.init({ cities });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(calls.at(-1).url, '/api/community/reports?city=mogadishu');
assert.equal(node('community-report-city').value, 'mogadishu');
assert.equal(node('community-feed-title').textContent, 'Mogadishu community reports');
assert.equal(node('community-status').textContent.includes('connected'), true);
assert.equal(node('community-feed-list').innerHTML.includes('&lt;script&gt;'), true);
api.selectCity(1);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(calls.at(-1).url, '/api/community/reports?city=galkayo');
assert.equal(node('community-report-city').value, 'galkayo', 'Global city navigation updates the report form');
node('community-scope').events.change({ target: { value: 'all' } });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(calls.at(-1).url, '/api/community/reports');
failFeed = true;
await api.refresh();
assert.equal(node('community-status').textContent.includes('Service offline'), true);
assert.equal(node('community-feed-list').innerHTML.includes('report-1'), false, 'Unavailable service must not present stale reports as newly fetched');
assert.equal(node('community-refresh').disabled, false);

// Run the frontend's actual form handlers against the real persistence/media API.
// The small DOM adapter supplies native form values; FormData and fetch are real.
const testWorkRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const dataDir = await fs.promises.mkdtemp(path.join(testWorkRoot, 'community-ui-e2e-'));
assert.equal(dataDir.startsWith(testWorkRoot + path.sep), true);
const handler = createCommunityHandler({ dataDir, cities });
const server = http.createServer((req, res) => {
  handler(req, res, new URL(req.url, 'http://localhost')).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }).catch(error => { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); });
});
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const liveNodes = new Map(), locationChanges = [], requests = [], revoked = [], commentForms = [];
  class LiveNode extends Node {
    constructor(id) { super(id); this.attrs = {}; this.dataset = {}; }
    setAttribute(key, value) { this.attrs[key] = value; }
    scrollIntoView() { this.scrolled = true; }
    querySelectorAll(selector) { return selector === '.community-comment-form' ? commentForms : []; }
    querySelector(selector) { return selector.includes('details') ? liveNode('details') : null; }
  }
  const liveNode = id => { if (!liveNodes.has(id)) liveNodes.set(id, new LiveNode(id)); return liveNodes.get(id); };
  const form = liveNode('community-report-form'), elements = [];
  const fields = ['cityId', 'category', 'observedAt', 'author', 'description', 'latitude', 'longitude', 'deaths', 'injuries', 'damagedProperties', 'sourceUrl', 'publicConsent'];
  for (const field of fields) {
    const input = liveNode(field === 'cityId' ? 'community-report-city' : 'field-' + field);
    input.name = field; input.type = field === 'publicConsent' ? 'checkbox' : 'text'; input.checked = false;
    elements.push(input); elements[field] = input;
  }
  elements.push(liveNode('community-submit'));
  form.elements = elements;
  form.reset = () => { elements.forEach(input => { input.value = ''; input.checked = false; }); };
  function BrowserFormData(inputForm) {
    const body = new FormData();
    for (const input of inputForm?.elements || []) if (input.name && !input.disabled && (input.type !== 'checkbox' || input.checked)) body.append(input.name, input.type === 'checkbox' ? 'on' : input.value);
    return body;
  }
  class TrackedURL extends URL {
    static createObjectURL(blob) { return URL.createObjectURL(blob); }
    static revokeObjectURL(url) { revoked.push(url); URL.revokeObjectURL(url); }
  }
  const liveMemory = new Map();
  const liveSandbox = {
    window: { addEventListener() {}, confirm() { return true; } }, document: { getElementById: liveNode },
    location: { href: origin + '/', origin, protocol: 'http:' }, navigator: {},
    localStorage: { getItem(key) { return liveMemory.get(key); }, setItem(key, value) { liveMemory.set(key, value); } },
    Date, URL: TrackedURL, Set, AbortController, setTimeout, clearTimeout, FormData: BrowserFormData, Blob,
    CSS: { escape(value) { return value; } },
    fetch: async (url, options) => { requests.push({ url, options }); try { return await fetch(new URL(url, origin), options); } catch (error) { throw new Error(error.message + ': ' + (error.cause?.message || ''), { cause: error }); } }
  };
  vm.runInNewContext(fs.readFileSync(new URL('./somalia-flood-watch/dist/community.js', import.meta.url), 'utf8'), liveSandbox);
  const liveApi = liveSandbox.window.CommunityReports;
  liveApi.init({ cities, onChange: reports => locationChanges.push(reports) });
  await liveApi.refresh();
  assert.equal(liveNode('community-feed-list').innerHTML.includes('No reports to display'), true);
  assert.equal(liveNode('community-root').innerHTML.includes('maxlength="60"'), true);
  assert.equal(liveNode('community-root').innerHTML.includes('max="100000"'), true);
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+VYAAAAASUVORK5CYII=', 'base64');
  const photo = new Blob([pngBytes], { type: 'image/png' }); photo.name = 'flood.png';
  const secondPhoto = new Blob([pngBytes], { type: 'image/png' }); secondPhoto.name = 'rain.png';
  liveNode('community-media-input').events.change({ target: { files: [photo], value: '' } });
  liveNode('community-media-input').events.change({ target: { files: [secondPhoto], value: '' } });
  assert.equal(liveNode('community-upload-count').textContent.startsWith('2/4 files'), true);
  assert.equal(revoked.length > 0, true, 'Replacing previews revokes the old object URL');
  liveNode('community-media-input').events.change({ target: { files: [{ name: 'unsafe.html', type: 'text/html', size: 10 }], value: '' } });
  assert.equal(liveNode('community-upload-error').textContent.includes('unsafe.html'), true);
  assert.equal(liveNode('community-upload-count').textContent.startsWith('2/4 files'), true);
  const observedLocal = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 16);
  Object.assign(elements.category, { value: 'flood' }); Object.assign(elements.observedAt, { value: observedLocal });
  elements.author.value = 'Local observer'; elements.description.value = 'A real test observation of flooding near the bridge.';
  elements.deaths.value = ''; elements.injuries.value = '0'; elements.damagedProperties.value = '1';
  assert.equal(liveApi.setLocation({ latitude: 2.0469, longitude: 45.3182 }), true);
  assert.equal(liveApi.setLocation({ latitude: 50, longitude: 45.3182 }), false);
  elements.publicConsent.checked = true;
  const submitted = form.events.submit({ currentTarget: form, preventDefault() {} });
  assert.equal(elements.description.disabled, true, 'Lock the form while the upload is in progress');
  await submitted;
  assert.equal(elements.description.disabled, false);
  assert.equal(liveNode('community-form-status').textContent.includes('Report published for Mogadishu'), true, liveNode('community-form-status').textContent);
  assert.equal(liveNode('community-upload-count').textContent.startsWith('Up to 4 files'), true);
  const posted = await (await fetch(origin + '/api/community/reports')).json(), report = posted.reports[0];
  assert.equal(posted.reports.length, 1);
  assert.equal(report.media.length, 2, 'Both native FormData uploads reached the API');
  assert.equal(report.deaths, null); assert.equal(report.injuries, 0);
  assert.equal(report.longitude, 45.3182); assert.equal(report.author, 'Local observer');
  assert.equal(liveNode('community-feed-list').innerHTML.includes('Delete my report'), true);
  assert.equal(liveMemory.has('somalia-community-report-receipts-v1'), true);

  elements.description.value = 'Draft text that should survive city navigation.'; elements.author.value = 'Draft alias';
  liveApi.setLocation({ latitude: 2.04, longitude: 45.31 });
  liveNode('community-media-input').events.change({ target: { files: [photo], value: '' } });
  liveApi.selectCity(1); await liveApi.refresh();
  assert.equal(elements.cityId.value, 'galkayo'); assert.equal(elements.latitude.value, ''); assert.equal(elements.longitude.value, '');
  assert.equal(elements.description.value, 'Draft text that should survive city navigation.');
  assert.equal(elements.author.value, 'Draft alias');
  assert.equal(liveNode('community-upload-count').textContent.startsWith('1/4 files'), true);
  assert.equal(liveNode('community-location-status').textContent.includes('city changed'), true);
  liveNode('community-scope').events.change({ target: { value: 'all' } }); await liveApi.refresh();

  const commentForm = new LiveNode('comment-form'), commentButton = new LiveNode('comment-submit'), commentStatus = new LiveNode('comment-status'), details = liveNode('details');
  commentForm.dataset.commentReport = report.id; details.open = true;
  commentForm.elements = { author: { value: 'Draft neighbour', disabled: false }, body: { value: '<script>Unsent local context</script>', disabled: false } };
  commentForm.closest = selector => selector === '.community-comment-form' ? commentForm : selector === 'details' ? details : null;
  commentForm.querySelector = selector => selector === 'button' ? commentButton : commentStatus;
  commentForms.push(commentForm);
  liveNode('community-category').events.change({ target: { value: 'rain' } });
  assert.equal(locationChanges.at(-1).length, 0, 'Map pins follow the visible report-type filter');
  liveNode('community-category').events.change({ target: { value: 'all' } });
  assert.equal(liveNode('community-feed-list').innerHTML.includes('&lt;script&gt;Unsent local context&lt;/script&gt;'), true, 'Comment drafts survive filters and remain escaped');
  assert.equal(liveNode('community-feed-list').innerHTML.includes('class="community-comments" open'), true);
  const postsBefore = requests.filter(request => request.options?.method === 'POST').length;
  commentForm.elements.author.value = 'N'.repeat(61);
  await liveNode('community-feed-list').events.submit({ target: commentForm, preventDefault() {} });
  assert.equal(requests.filter(request => request.options?.method === 'POST').length, postsBefore, 'Reject overlong names before a request');
  assert.equal(commentStatus.textContent.includes('60 characters'), true);
  commentForm.elements.author.value = 'A neighbour'; commentForm.elements.body.value = 'The side road is also under water.';
  await liveNode('community-feed-list').events.submit({ target: commentForm, preventDefault() {} });
  const commented = await (await fetch(origin + '/api/community/reports')).json();
  assert.equal(commented.reports[0].comments.length, 1);
  assert.equal(commented.reports[0].comments[0].body, 'The side road is also under water.');
  assert.equal(liveNode('community-feed-list').innerHTML.includes('The side road is also under water.'), true, 'The actual {comment} response renders without another list request');
  assert.equal(liveNode('community-status').textContent.includes('Comment published'), true);
  assert.equal(commentForm.elements.body.value, '');

  const deleteButton = new LiveNode('delete-report'); deleteButton.dataset.deleteReport = report.id;
  const deleteTarget = { closest(selector) { return selector === '[data-delete-report]' ? deleteButton : null; } };
  liveNode('community-root').events.click({ target: deleteTarget });
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    if (liveNode('community-status').textContent.includes('were deleted')) break;
  }
  const deleted = await (await fetch(origin + '/api/community/reports')).json();
  assert.equal(deleted.reports.length, 0);
  assert.equal((await fetch(origin + report.media[0].url)).status, 404);
  assert.equal(locationChanges.at(-1).length, 0);
} finally {
  await new Promise(resolve => server.close(resolve));
  assert.equal(dataDir.startsWith(testWorkRoot + path.sep), true);
  await fs.promises.rm(dataDir, { recursive: true, force: true });
}
console.log('Community UI checks passed, including real multipart upload, durable reports, comments and receipt deletion.');
