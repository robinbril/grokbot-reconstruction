import test from 'node:test';
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import {startHarness} from './fixtures/harness-http.mjs';
const id='history-http-conversation',base='/conversations/'+id;
async function seed(app,client,count=505){
 const created=await client.request(base+'/descriptor',{method:'POST',body:{requestId:'register',clientKey:'marketing',name:'Synthetic history'}});assert.equal(created.status,200,JSON.stringify(created.value));
 const owner=app.handler.store.states.get(id).owner;
 await app.handler.store.transaction(owner,id,state=>{state.entries=Array.from({length:count},(_,index)=>({id:'entry-'+index,role:'assistant',text:'Synthetic '+index,createdAt:1}));});
 return owner;
}
test('real HTTP history is bounded, cursor-addressed and owner isolated with CSRF writes',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client(),stranger=await app.client();await seed(app,client);
 const response=await client.request(base+'/history');assert.equal(response.status,200);assert.equal(response.value.entries.length,500);assert.equal(response.value.entries[0].id,'entry-5');
 const older=await client.request(base+'/history?limit=100&beforeSeq='+response.value.nextBeforeSeq);assert.equal(older.status,200);assert.equal(older.value.entries.length,5);assert.equal(older.value.hasOlder,false);
 assert.equal((await stranger.request(base+'/history')).status,404);assert.equal((await stranger.request(base+'/read')).status,404);
 const forbidden=await client.request(base+'/read',{method:'POST',body:{requestId:'forbidden',throughSeq:response.value.lastHistorySeq},headers:{'x-harness-csrf':'wrong'}});assert.equal(forbidden.status,403);
 const read=await client.request(base+'/read',{method:'POST',body:{requestId:'read',throughSeq:response.value.lastHistorySeq}});assert.equal(read.status,200);assert.equal(read.value.unreadCount,0);
 const catalog=await client.request('/conversations');assert.equal(catalog.status,200);assert.equal(catalog.value.conversations[0].descriptor.clientKey,'marketing');assert.deepEqual((await stranger.request('/conversations')).value.conversations,[]);
 for(const query of ['limit=0','limit=501','beforeSeq=-1','beforeSeq=1.1','beforeSeq=1&beforeSeq=2','limit=2&unexpected=1'])assert.equal((await client.request(base+'/history?'+query)).status,422);
});
test('server read receipt persists after restart and stale device writes cannot unread prior messages',async t=>{
 const first=await startHarness();let second;t.after(async()=>{await second?.close();await first.close();await rm(first.dataDir,{recursive:true,force:true});});const client=await first.client();await seed(first,client,3);const identity={cookie:client.cookie,csrf:client.csrf};const page=(await client.request(base+'/history')).value;
 await client.request(base+'/read',{method:'POST',body:{requestId:'read-new',throughSeq:page.lastHistorySeq}});await first.close({keepData:true});
 second=await startHarness({dataDir:first.dataDir});const resumed=await second.client(identity);
 const stale=await resumed.request(base+'/read',{method:'POST',body:{requestId:'read-stale',throughSeq:0}});assert.equal(stale.status,200);assert.equal(stale.value.throughSeq,page.lastHistorySeq);assert.equal(stale.value.unreadCount,0);
 const snapshot=(await resumed.request(base)).value;assert.equal(Object.hasOwn(snapshot,'historyState'),false,'internal sequence sidecars must not defeat bounded history projections');
});
