import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HarnessStore} from '../harness/store.mjs';
import {createConversationHistory} from '../harness/conversation-history.mjs';
async function fixture(t,entries=[]){
 const dataDir=await mkdtemp(path.join(tmpdir(),'conversation-history-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const store=await new HarnessStore({dataDir}).init();await store.transaction('owner','conversation',state=>{state.entries=entries;});
 return {dataDir,store,history:createConversationHistory({store,clock:()=>10000})};
}
const message=(id,text=id)=>({id,role:'assistant',kind:'message',text,createdAt:'2026-10-23T12:00:00.000Z'});
test('server pages canonical history with stable cursors across append deletion and restart',async t=>{
 const entries=Array.from({length:605},(_,index)=>message('entry-'+index));const {store,history,dataDir}=await fixture(t,entries);
 const latest=await history.page('owner','conversation',{});assert.equal(latest.entries.length,500);assert.equal(latest.entries[0].id,'entry-105');assert.equal(latest.hasOlder,true);
 assert.equal(Object.hasOwn(store.get('owner','conversation').entries[0],'historySeq'),false);
 await store.transaction('owner','conversation',state=>{state.entries.push(message('new-arrival'));state.entries=state.entries.filter(entry=>entry.id!=='entry-55');});
 const older=await history.page('owner','conversation',{beforeSeq:latest.nextBeforeSeq,limit:100});assert.equal(older.entries.length,100);assert.equal(older.entries.at(-1).id,'entry-104');assert.equal(older.entries.some(entry=>entry.id==='new-arrival'),false);
 const final=await history.page('owner','conversation',{beforeSeq:older.nextBeforeSeq,limit:100});assert.equal(final.entries.length,4);assert.equal(final.hasOlder,false);
 const restored=await new HarnessStore({dataDir}).init(),reloaded=createConversationHistory({store:restored});const again=await reloaded.page('owner','conversation',{beforeSeq:latest.nextBeforeSeq,limit:100});assert.deepEqual(again.entries.map(entry=>[entry.id,entry.historySeq]),older.entries.map(entry=>[entry.id,entry.historySeq]));
 assert.equal(new Set([...latest.entries,...older.entries,...final.entries].map(entry=>entry.id)).size,604);
});
test('read watermark is durable monotonic and future-clamped across late deliveries and stale devices',async t=>{
 const {store,history,dataDir}=await fixture(t,[{...message('answer'),messages:[{id:'first',type:'text',content:'First',createdAt:1}]}]);
 const first=await history.page('owner','conversation',{});assert.equal(first.readStatus.unreadCount,1);
 const read=await history.markRead('owner','conversation',{throughSeq:999999,requestId:'read-first'});assert.equal(read.throughSeq,first.lastHistorySeq);assert.equal(read.unreadCount,0);
 await store.transaction('owner','conversation',state=>state.entries[0].messages.push({id:'second',type:'text',content:'Second',createdAt:1}));
 const next=await history.page('owner','conversation',{});assert.equal(next.readStatus.unreadCount,1);assert.equal(next.readStatus.firstUnread.messageId,'second');assert.ok(next.readStatus.firstUnread.seq>read.throughSeq);
 const stale=await history.markRead('owner','conversation',{throughSeq:0,requestId:'read-stale'});assert.equal(stale.throughSeq,read.throughSeq);assert.equal(stale.unreadCount,1);
 await history.markRead('owner','conversation',{throughSeq:next.lastHistorySeq,requestId:'read-second'});
 const restored=await new HarnessStore({dataDir}).init();assert.equal((await createConversationHistory({store:restored}).readStatus('owner','conversation')).unreadCount,0);
});
test('owner isolation and malformed boundaries reject without creating conversations',async t=>{
 const {store,history}=await fixture(t,[message('one')]);
 for(const call of [()=>history.page('other','conversation',{}),()=>history.readStatus('other','conversation'),()=>history.markRead('other','conversation',{throughSeq:1,requestId:'read'})])await assert.rejects(call,error=>error.status===404);
 for(const input of [{limit:0},{limit:501},{limit:'10'},{beforeSeq:0},{beforeSeq:-1},{beforeSeq:1.5}])await assert.rejects(()=>history.page('owner','conversation',input),error=>error.code==='INVALID_HISTORY_CURSOR');
 await assert.rejects(()=>history.page('owner','missing',{}),error=>error.status===404);assert.equal(store.states.has('missing'),false);
});
test('current metadata eligibility excludes outgoing tools suppressed channels and drafts',async t=>{
 const entries=[{id:'user',role:'user',text:'Outgoing'}, {...message('tool'),kind:'tool-call'}, {...message('hidden'),suppressed:false}, {...message('voice'),channel:'voice:test'}, {...message('branched'),branched:true}, {...message('pending'),messages:[]}, {...message('answer'),messages:[{id:'actual',type:'text',content:'Eligible',createdAt:2}]}];
 const {store,history}=await fixture(t,entries);const before=await history.readStatus('owner','conversation');assert.equal(before.unreadCount,1);assert.equal(before.firstUnread.messageId,'actual');
 await store.transaction('owner','conversation',state=>{delete state.entries.find(entry=>entry.id==='hidden').suppressed;state.entries.find(entry=>entry.id==='answer').messages=[];});
 const after=await history.readStatus('owner','conversation');assert.equal(after.unreadCount,1);assert.equal(after.firstUnread.messageId,'hidden');
});
test('empty history descriptor catalog and idempotent registration stay owner scoped',async t=>{
 const {history}=await fixture(t,[]);const empty=await history.page('owner','conversation',{});assert.deepEqual(empty.entries,[]);assert.equal(empty.nextBeforeSeq,null);assert.equal(empty.lastHistorySeq,0);assert.equal(empty.readStatus.unreadCount,0);
 const descriptor={requestId:'register',clientKey:'marketing',name:'Synthetic bot',color:'#123456'};assert.deepEqual((await history.descriptor('owner','new',descriptor)).descriptor,{clientKey:'marketing',name:'Synthetic bot',color:'#123456'});
 assert.deepEqual(await history.descriptor('owner','new',descriptor),await history.descriptor('owner','new',descriptor));
 await assert.rejects(()=>history.descriptor('owner','new',{...descriptor,name:'Changed'}),error=>error.code==='IDEMPOTENCY_CONFLICT');
 const catalog=await history.catalog('owner');assert.equal(catalog.conversations.length,2);assert.equal(catalog.conversations.find(row=>row.conversationId==='new').descriptor.name,'Synthetic bot');assert.deepEqual((await history.catalog('stranger')).conversations,[]);
});
test('read acknowledgements serialize and a failed disk write does not advance the durable watermark',async t=>{
 const {store,history}=await fixture(t,[message('first'),message('second')]);const page=await history.page('owner','conversation',{});
 await Promise.all([history.markRead('owner','conversation',{throughSeq:page.lastHistorySeq,requestId:'newer'}),history.markRead('owner','conversation',{throughSeq:0,requestId:'older'})]);
 const stable=await history.readStatus('owner','conversation');assert.equal(stable.throughSeq,page.lastHistorySeq);
 await store.transaction('owner','conversation',state=>state.entries.push(message('third')));const next=await history.page('owner','conversation',{}),write=store.write;
 store.write=async()=>{throw Error('synthetic disk failure');};await assert.rejects(()=>history.markRead('owner','conversation',{throughSeq:next.lastHistorySeq,requestId:'failed'}),/disk failure/);store.write=write;
 assert.equal((await history.readStatus('owner','conversation')).throughSeq,page.lastHistorySeq);
 const captured=await history.page('owner','conversation',{unreadAfterSeq:0});assert.equal(captured.unreadSince.unreadCount,3);assert.equal(captured.readStatus.unreadCount,1);
});
test('retrying a future-clamped read cannot consume deliveries that arrived after its first acknowledgement',async t=>{
 const {store,history}=await fixture(t,[message('first')]);const request={throughSeq:999999,requestId:'same-read-request'};
 const before=await history.markRead('owner','conversation',request);
 await store.transaction('owner','conversation',state=>state.entries.push(message('later')));
 const retried=await history.markRead('owner','conversation',request);assert.equal(retried.throughSeq,before.throughSeq);assert.equal(retried.unreadCount,1);
 await assert.rejects(()=>history.markRead('owner','conversation',{...request,throughSeq:0}),error=>error.code==='IDEMPOTENCY_CONFLICT');
});
test('unchanged page status and catalog reads do not rewrite canonical storage',async t=>{
 const {store,history}=await fixture(t,[message('first')]);await history.page('owner','conversation',{});
 const write=store.write;let writes=0;store.write=async function(...args){writes++;return write.apply(this,args);};
 await history.page('owner','conversation',{});await history.readStatus('owner','conversation');await history.catalog('owner');assert.equal(writes,0);
});
test('accepted and streamed canonical run placeholders are not delivered messages',async t=>{
 const {store,history}=await fixture(t,[{id:'pending-output',role:'assistant',runId:'run',text:'',status:'accepted',createdAt:1}]);
 assert.equal((await history.readStatus('owner','conversation')).unreadCount,0);
 await store.transaction('owner','conversation',state=>{Object.assign(state.entries[0],{status:'running',text:'Uncommitted stream',streaming:true,messageDrafts:[{callId:'call',text:'Uncommitted stream',status:'streaming'}]});});
 assert.equal((await history.readStatus('owner','conversation')).unreadCount,0);
 await store.transaction('owner','conversation',state=>{Object.assign(state.entries[0],{status:'completed',text:'',streaming:false,messageDrafts:[]});});
 assert.equal((await history.readStatus('owner','conversation')).unreadCount,0);
 await store.transaction('owner','conversation',state=>{state.entries[0].messages=[{id:'confirmed-message',callId:'call',type:'text',content:'Committed reply',createdAt:2}];});
 const committed=await history.readStatus('owner','conversation');assert.equal(committed.unreadCount,1);assert.equal(committed.firstUnread.messageId,'confirmed-message');
});
