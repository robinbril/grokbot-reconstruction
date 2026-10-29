import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {planPendingReveal,historyEntryMatches,shouldLoadOlderHistory,createHistoryLoadProbe} from '../transcript-history-state.js';
import {createTranscriptHistory} from '../transcript-history.js';

const evidence=JSON.parse(readFileSync(new URL('./fixtures/source-reference/transcript-history.json',import.meta.url)));
const native=vm.runInNewContext(evidence.records.find(r=>r.id==='pending-policy').excerpt+';jXe');
const request={agentId:'other',entryId:'target',fromAgentId:'current',pagesRequested:0,parkedAtMs:100};
test('pending reveal matches all native plan branches including strict timeout and 20-page boundary',()=>{
 for(const currentAgentId of ['other','current','unrelated',null])for(const nowMs of [100,30100,30101])for(const isEntryInWindow of [false,true])for(const isWindowLoading of [false,true])for(const hasOlderHistory of [false,true])for(const isLoadingOlderHistory of [false,true])for(const pagesRequested of [0,19,20]){
  const req={...request,pagesRequested},env={currentAgentId,nowMs,isEntryInWindow,isWindowLoading,hasOlderHistory,isLoadingOlderHistory};
  assert.deepEqual(planPendingReveal(req,env),JSON.parse(JSON.stringify(native(req,env))));
 }
});
test('history row identity resolves exact canonical delivery without aliasing unrelated content',()=>{
 assert.equal(historyEntryMatches({id:'outer',liveHarness:{messages:[{id:'delivery'}]}},'delivery'),true);
 assert.equal(historyEntryMatches({id:'outer',liveHarness:{messages:[{id:'delivery'}]}},'missing'),false);
 assert.equal(historyEntryMatches({id:'outer'},'outer'),true);
});
function fixture(){
 let key='current',now=0,failNextRead=false;const entries={current:Array.from({length:750},(_,i)=>({id:'c'+i,text:'Synthetic '+i})),other:Array.from({length:620},(_,i)=>({id:'o'+i,text:'Synthetic other '+i}))},calls=[];
 let history;const host={getConversationKey:()=>key,getEntries:k=>{if(failNextRead){failNextRead=false;throw Error('Synthetic persisted-history read failure');}return entries[k]??[];},selectConversation:k=>{key=k;history.afterRender();return true;},render:()=>{calls.push(['render',key]);history.afterRender();},navigateToEntry:(id,motion)=>{calls.push(['navigate',key,id,motion]);return history.isVisibleEntry(key,id);},closeExchange:()=>calls.push(['close']),onError:error=>calls.push(['error',error.message]),now:()=>now};
 history=createTranscriptHistory(host);return {history,host,entries,calls,setKey:k=>{key=k;history.afterRender();},setNow:n=>now=n,failNextRead:()=>failNextRead=true};
}
const idle=()=>new Promise(resolve=>setImmediate(resolve));
test('actual retained data starts with native 500-row tail and loads genuine preceding 100-row pages without duplicates',async()=>{
 const {history,entries}=fixture();assert.equal(history.entriesFor('current',entries.current).length,500);assert.equal(history.entriesFor('current')[0].id,'c250');
 const first=history.loadOlder('current'),same=history.loadOlder('current');assert.equal(first,same);await first;
 assert.equal(history.entriesFor('current').length,600);assert.equal(history.entriesFor('current')[0].id,'c150');
 await history.loadOlder('current');await history.loadOlder('current');assert.equal(history.entriesFor('current').length,750);assert.equal(history.diagnostics().hasOlder,false);
 entries.current.push({id:'new'});assert.equal(history.entriesFor('current').at(-1).id,'new');assert.equal(new Set(history.entriesFor('current').map(e=>e.id)).size,751);history.destroy();
});
test('missing in-window quote loads persisted older pages and navigates only when exact target is visible',async()=>{
 const {history,calls}=fixture();assert.equal(history.revealEntry('current','c20'),true);await idle();
 assert.deepEqual(calls.filter(x=>x[0]==='navigate'),[['navigate','current','c20','auto']]);assert.equal(history.entriesFor('current')[0].id,'c0');assert.equal(history.diagnostics().pending,null);history.destroy();
});
test('cross-conversation reveal switches actual owner, waits through render and resolves canonical delivery exactly',async()=>{
 const {history,entries,calls}=fixture();entries.other[3].liveHarness={messages:[{id:'delivery3'}]};history.revealEntry('other','delivery3');await idle();
 assert.deepEqual(calls.filter(x=>x[0]==='navigate'),[['navigate','other','delivery3','auto']]);assert.equal(history.diagnostics().pending,null);history.destroy();
});
test('unresolved target exhausts real history rather than manufacturing a source or navigating another row',async()=>{
 const {history,calls}=fixture();history.revealEntry('current','does-not-exist');await idle();
 assert.equal(history.diagnostics().pending,null);assert.deepEqual(calls.filter(x=>x[0]==='navigate'),[]);assert.equal(history.diagnostics().lastDrop,'unresolved');history.destroy();
});
test('boundary reveal uses separate smooth route and cancellation removes only boundary pending requests',async()=>{
 const {history,calls}=fixture();history.revealEntry('current','c20',{boundaryAt:123});await idle();assert.equal(calls.find(x=>x[0]==='navigate')[3],'smooth');
 history.revealEntry('current','c30');history.cancelBoundary();await idle();assert.equal(calls.some(x=>x[0]==='navigate'&&x[2]==='c30'),true);history.destroy();
});
test('dispose or unrelated navigation invalidates queued older work without navigating stale target',async()=>{
 for(const dispose of [false,true]){const {history,calls,setKey}=fixture();history.revealEntry('current','c20');if(dispose)history.destroy();else setKey('other');await idle();assert.equal(calls.some(x=>x[0]==='navigate'),false);}
});

test('failed older read clears that pending reveal before any automatic retry or navigation',async()=>{
 const {history,calls,failNextRead}=fixture();history.revealEntry('current','c20');failNextRead();await idle();
 assert.equal(history.diagnostics().pending,null);assert.equal(history.diagnostics().lastDrop,'load-failed');assert.deepEqual(calls.filter(x=>x[0]==='navigate'),[]);assert.equal(calls.filter(x=>x[0]==='error').length,1);history.destroy();
});

test('native older probe uses600px inclusive boundary and promotes only a changed nonnull viewport',()=>{
 for(const top of [-1,0,599.99,600,600.01,1000])for(const hasOlder of [false,true])for(const isLoadingOlder of [false,true])assert.equal(shouldLoadOlderHistory({scrollTop:top,hasOlder,isLoadingOlder}),hasOlder&&!isLoadingOlder&&top<=600);
 const probe=createHistoryLoadProbe(),first={},second={};let count=0;probe.promote({wiringKey:first,maybeLoadOlder:()=>count++});assert.equal(count,1);probe.promote({wiringKey:first,maybeLoadOlder:()=>count+=2});assert.equal(count,1);probe.probe();assert.equal(count,3);probe.promote({wiringKey:null,maybeLoadOlder:()=>count++});assert.equal(count,3);probe.promote({wiringKey:second,maybeLoadOlder:()=>count++});assert.equal(count,4);
});
test('actual near-top probe requests real older persisted rows once while loading',async()=>{
 const {history}=fixture();assert.equal(history.probe({scrollTop:601}),null);const one=history.probe({scrollTop:600});assert.ok(one);assert.equal(history.probe({scrollTop:0}),null);await one;assert.equal(history.entriesFor('current').length,600);history.destroy();
});

test('native unread-divider special target waits for real boundary row availability and takes smooth route',async()=>{
 const {history,host,calls}=fixture();
 host.isEntryInWindow=(request,key,visible)=>request.entryId==='unread-divider'&&visible.some(entry=>entry.id==='c20');
 host.navigateToEntry=(id,motion)=>{calls.push(['navigate','current',id,motion]);return true;};
 history.revealEntry('current','unread-divider',{boundaryAt:123});await idle();
 assert.deepEqual(calls.filter(x=>x[0]==='navigate'),[['navigate','current','unread-divider','smooth']]);assert.equal(history.diagnostics().pending,null);history.destroy();
});

test('actual pending chase stops after20 real older pages without manufacturing an out-of-budget target',async()=>{
 const {history,entries,calls}=fixture();entries.current=Array.from({length:3500},(_,i)=>({id:'c'+i}));history.revealEntry('current','c0');await idle();
 assert.equal(history.entriesFor('current').length,2500);assert.equal(history.entriesFor('current')[0].id,'c1000');assert.equal(history.diagnostics().pending,null);assert.equal(history.diagnostics().hasOlder,true);assert.deepEqual(calls.filter(x=>x[0]==='navigate'),[]);history.destroy();
});
test('pending cross-agent request expires only outside target agent afterstrict30second threshold',()=>{
 const {history,host,setNow}=fixture();host.selectConversation=()=>undefined;history.revealEntry('other','o20');setNow(30000);history.afterRender();assert.ok(history.diagnostics().pending);setNow(30001);history.afterRender();assert.equal(history.diagnostics().pending,null);history.destroy();
});
