import fs from 'node:fs/promises';
import vm from 'node:vm';
import {harness,assert,BASE} from './somalia-flood-watch/verify.mjs';
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[BASE]))}static now(){return BASE}}
const linksContext=vm.createContext({window:{},Date:FixedDate,URL,URLSearchParams});
vm.runInContext(await fs.readFile(new URL('./somalia-flood-watch/dist/map-context.js',import.meta.url),'utf8'),linksContext);
const helper=linksContext.window.MapContext,contexts=[];
const h=harness({windowGlobals:{MapContext:{render:input=>contexts.push(input),buildCopernicusBrowserUrl:helper.buildCopernicusBrowserUrl}}});
await h.settle();
assert.equal(contexts.at(-1).observationDatetime,'2026-10-12T07:00:00Z');
h.evaluate('setDay(13)');
assert.equal(contexts.at(-1).date,'2026-10-26');
assert.equal(contexts.at(-1).observationDatetime,'2026-10-12T07:00:00Z');
let url=new URL(helper.links(contexts.at(-1)).copernicus);
assert.equal(url.searchParams.get('fromTime'),'2026-10-12T00:00:00.000Z');
assert.equal(url.searchParams.get('toTime'),'2026-10-12T23:59:59.999Z');
assert.ok(!url.searchParams.has('visualizationUrl'));
h.evaluate("sceneFeeds.set(1,{data:null,lastSuccess:null});selected=1;render()");
assert.equal(contexts.at(-1).city[0],'Hargeisa');
assert.equal(contexts.at(-1).observationDatetime,null,'an unloaded city cannot inherit another city’s acquisition date');
url=new URL(helper.links(contexts.at(-1)).copernicus);
assert.equal(url.searchParams.get('lat'),'9.5624');
assert.equal(url.searchParams.get('toTime'),new Date(BASE).toISOString());
h.evaluate("sceneFeeds.set(1,{data:{missions:{optical:{scenes:[{datetime:'2026-10-10T07:00:00Z'}]}}},lastSuccess:new Date().toISOString()});render()");
assert.equal(contexts.at(-1).observationDatetime,'2026-10-10T07:00:00Z');
assert.equal(new URL(helper.links(contexts.at(-1)).copernicus).searchParams.get('fromTime'),'2026-10-10T00:00:00.000Z');
for(const invalid of ['not-a-date','2026-02-30','2026-10-26T07:00:00Z']){
  url=new URL(h.evaluate(`imageryUrl(1,${JSON.stringify(invalid)})`));
  assert.equal(url.searchParams.get('toTime'),new Date(BASE).toISOString());
  assert.ok(Date.parse(url.searchParams.get('fromTime'))<Date.parse(url.searchParams.get('toTime')));
}
console.log('Satellite-link integration passed: source observations, future forecast separation, city isolation and complete clean fallback dates.');
