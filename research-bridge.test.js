import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeResearchUrl, parseResearchReturn, reportUrl, readLinks, saveLink } from './research-bridge.js';
test('handoff preserves Unicode context and fixes the destination origin', () => {
 const url = new URL(makeResearchUrl({ticker:'NVDA',company:'英伟达',category:'算力',key_focus:'订单 & 风险'},true));
 assert.equal(url.origin,'https://super-digger-linked-preview.mastergo.workers.dev');
 const data=JSON.parse(new URLSearchParams(url.hash.split('?')[1]).get('stock'));
 assert.equal(data.question,'订单 & 风险'); assert.equal(data.company,'英伟达');
});
test('rejects invalid callback data and ignores arbitrary URL properties', () => {
 assert.equal(parseResearchReturn('#research=%FF'),null);
 for (const ticker of [undefined, null, 123, {}, [], '<script>']) assert.equal(parseResearchReturn('#research='+encodeURIComponent(JSON.stringify({ticker}))),null);
 assert.equal(parseResearchReturn('#research='+encodeURIComponent(JSON.stringify({ticker:'NVDA',reportId:-1,preview:false}))),null);
 const entry=parseResearchReturn('#research='+encodeURIComponent(JSON.stringify({ticker:'NVDA',reportId:123,preview:false,url:'javascript:alert(1)'})));
 assert.equal(reportUrl(entry),'https://mastersgo.cc/#/?report=123');
});
test('deduplicates report links and tolerates storage failure', () => {
 let value='[]'; const storage={getItem:()=>value,setItem:(_,v)=>{value=v;}};
 const entry={ticker:'NVDA',reportId:123,preview:false};
 assert.equal(saveLink(storage,entry),true); saveLink(storage,entry); assert.equal(readLinks(storage).length,1);
 assert.equal(saveLink({getItem:()=>{throw Error();},setItem:()=>{throw Error();}},entry),false);
});
