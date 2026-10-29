// Real browser writer + fsync-backed ledger + engine + production surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createChatStateHost} from '../chat-state-host.js';
import {createLiveWorkflowsSurface} from '../live-workflows-surface.js';
import {WorkflowEngine} from '../harness/workflows.mjs';
import {HarnessStore} from '../harness/store.mjs';

const owner='owned-action-ack',canonical=id=>'server-'+id;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const seed=()=>({version:1,selected:'A',messages:{A:[],B:[]},drafts:{A:'KEEP_A',B:'KEEP_B'},liveHarness:{serverIds:{A:'server-A',B:'server-B'}}});
const requests=state=>state.liveHarness.workflowRequests||{};
const pending=ui=>structuredClone(requests(ui.state));
async function fixture(t){
 const dataDir=await mkdtemp(path.join(tmpdir(),'workflow-action-ack-'));
 const store=await new HarnessStore({dataDir}).init();
 const engine=await new WorkflowEngine({store,runtime:{active:()=>true},autoStart:false,clock:()=>new Date('2026-10-19T12:00:00Z')}).init();
 t.after(async()=>{await engine.close();await rm(dataDir,{recursive:true,force:true});});
 async function schedule(id='A'){
  return (await engine.createSchedule(owner,canonical(id),{requestId:'seed-'+id,title:'Owned '+id,payload:{text:'OWNED_'+id},rule:{kind:'once',at:'2026-10-25T09:00:00Z',timeZone:'UTC'},enabled:true})).schedule;
 }
 function mount({saved=seed(),fault=null,waitForReply=null}={}){
  let state=structuredClone(saved),bytes=JSON.stringify(saved),version=0,markup='',loseReply=fault==='network',refreshFailure=null;
  const errors=[],calls=[],notifications=[],snapshots=new Map();
  const storage={failRetirement:fault==='ack',failAll:false,setItem(_key,nextBytes){
   const next=JSON.parse(nextBytes),before=requests(JSON.parse(bytes)),after=requests(next);
   if(this.failAll||this.failRetirement&&Object.keys(before).some(key=>!Object.hasOwn(after,key)))throw new Error('Owned ACK retirement storage fault');
   bytes=nextBytes;
  }};
  const writer=createChatStateHost({getState:()=>state,publishState:next=>{state=next;},storage,storageKey:'owned-action-ack',initialSavedState:saved,onSaveResult:result=>notifications.push(result)});
  const errorNode={textContent:''};
  const host={...writer,esc,getState:()=>state,getConversationKey:()=>state.selected,getDialogVersion:()=>version,draftAttachments:()=>[],closePopover(){},render(){},
   app:{querySelector:()=>null},overlay:{open:true,querySelector:selector=>selector==='[data-live-routine-error]'?errorNode:null,querySelectorAll:()=>[]},
   showDialog(_kind,_title,html){version++;markup=html;errorNode.textContent='';},closeDialog(){version++;}};
  async function refresh(id=state.selected){if(refreshFailure){const error=refreshFailure;refreshFailure=null;throw error;}const row=store.get(owner,canonical(id));snapshots.set(id,row?store.snapshot(row):{queue:[],schedules:[],runs:[],workflow:{}});}
  async function invoke(kind,id,target,command){
   calls.push({kind,id,target,command:structuredClone(command)});
   const result=kind==='resume'?await engine.resume(owner,id,command.requestId):kind==='cancel'?await engine.cancel(owner,id,target,command.requestId):await engine.scheduleAction(owner,id,target,kind,command);
   if(waitForReply)await waitForReply;
   if(loseReply){loseReply=false;throw new TypeError('Owned unknown reply after real durable acceptance');}
   return result;
  }
  const client={scheduleAction:(id,target,kind,command)=>invoke(kind,id,target,command),resumeQueue:(id,requestId)=>invoke('resume',id,'',{requestId}),cancelQueued:(id,target,requestId)=>invoke('cancel',id,target,{requestId})};
  const surface=createLiveWorkflowsSurface({host,client,key:()=>state.selected,serverId:id=>canonical(id),isLive:()=>true,
   snapshot:(id=state.selected)=>snapshots.get(id)||{queue:[],schedules:[],runs:[],workflow:{}},refresh,setError:(id,error)=>errors.push({id,error}),activeRun:()=>null});
  t.after(()=>surface.destroy());
  return {host,surface,storage,calls,errors,notifications,refresh,get state(){return state;},get durable(){return JSON.parse(bytes);},get markup(){return markup;},errorNode,
   action:(kind,id='')=>surface.handleAction({action:'live-workflow-'+kind,id}),failNextRefresh(error){refreshFailure=error;},
   select(id){assert.equal(writer.commit(s=>({...s,selected:id}),{reason:'owned-navigation'}).ok,true);}};
 }
 return {engine,store,schedule,mount,snapshot:(id='A')=>store.snapshot(store.get(owner,canonical(id)))};
}
function assertStorageNotice(ui){
 assert.ok(ui.notifications.some(row=>!row.ok&&row.error?.code==='storage'),'The actual writer must have encountered the targeted durable cleanup fault');
 assert.ok(ui.errors.some(row=>/opgeslagen|opslag|bewar/i.test(row.error.message)),'Known server acceptance with failed local retirement must expose recovery, not silently succeed');
}
async function checkReceipt(ui){
 const markup=ui.markup+ui.surface.queueMarkup();
 const button=[...markup.matchAll(/<button\b([^>]+)>([\s\S]*?)<\/button>/g)].find(match=>/Ontvangst controleren/i.test(match[2]));
 assert.ok(button,'The pending action must expose an explicit Ontvangst controleren recovery control');
 const action=button[1].match(/data-action="([^"]+)"/)?.[1],id=button[1].match(/data-id="([^"]*)"/)?.[1]||'';
 assert.ok(action,'The recovery control must use the actual delegated action boundary');
 await ui.surface.handleAction({action,id});
}

test('accepted pause whose local ACK retirement fails remains durable and exposes recovery',async t=>{
 const f=await fixture(t),row=await f.schedule(),ui=f.mount({fault:'ack'});await ui.refresh();ui.action('open',row.id);await ui.action('pause',row.id);
 assert.equal(f.snapshot().schedules[0].enabled,false);assert.equal(f.snapshot().schedules[0].revision,2);
 assert.deepEqual(pending(ui),requests(ui.durable));assert.equal(Object.keys(pending(ui)).length,1);
 assertStorageNotice(ui);assert.notEqual(ui.errorNode.textContent,'','The originating open routine must visibly report failed retirement');
});

test('an accepted stale pause identity cannot satisfy a fresh pause after enable and remount',async t=>{
 const f=await fixture(t),row=await f.schedule(),first=f.mount({fault:'ack'});await first.refresh();await first.action('pause',row.id);
 const original=first.calls[0].command,receipt=structuredClone(f.store.get(owner,canonical('A')).requests);
 first.surface.destroy();const ui=f.mount({saved:first.durable});await ui.refresh();ui.action('open',row.id);await checkReceipt(ui);assert.equal(Object.keys(pending(ui)).length,0);
 await ui.action('enable',row.id);assert.equal(f.snapshot().schedules[0].enabled,true);
 const revision=f.snapshot().schedules[0].revision;await ui.action('pause',row.id);
 assert.equal(f.snapshot().schedules[0].enabled,false,'Fresh Pause must actually pause the now-enabled job, rather than replay an old receipt');
 assert.equal(f.snapshot().schedules[0].revision,revision+1);
 const last=ui.calls.filter(call=>call.kind==='pause').at(-1);assert.notEqual(last.command.requestId,original.requestId);assert.equal(last.command.expectedRevision,revision);
 for(const [key,value]of Object.entries(receipt))assert.deepEqual(f.store.get(owner,canonical('A')).requests[key],value,'Already accepted backend receipts are immutable');
});

test('run-now recovers its original occurrence once, then a distinct explicit invocation creates one new occurrence',async t=>{
 const f=await fixture(t),row=await f.schedule(),first=f.mount({fault:'ack'});await first.refresh();await first.action('run-now',row.id);
 const original=first.calls[0].command;assert.equal(f.snapshot().queue.length,1);assert.equal(Object.keys(pending(first)).length,1);assertStorageNotice(first);
 first.surface.destroy();const ui=f.mount({saved:first.durable});await ui.refresh();ui.action('open',row.id);await checkReceipt(ui);
 assert.equal(f.snapshot().queue.length,1,'Receipt recovery must not enqueue again');assert.deepEqual(ui.calls[0].command,original);assert.equal(Object.keys(pending(ui)).length,0);
 await ui.action('run-now',row.id);assert.equal(f.snapshot().queue.length,2,'A later explicit invocation needs its own real occurrence');
 assert.notEqual(ui.calls[1].command.requestId,original.requestId);assert.deepEqual(Object.keys(ui.calls[1].command).sort(),['expectedRevision','requestId']);assert.notEqual(f.snapshot().queue[0].id,f.snapshot().queue[1].id);
 assert.deepEqual(f.snapshot().queue.map(item=>item.payload.text),['OWNED_A','OWNED_A']);
});

test('unknown accepted reply and failed retry storage retain the exact original body across remount',async t=>{
 const f=await fixture(t),row=await f.schedule(),first=f.mount({fault:'network'});await first.refresh();await first.action('pause',row.id);
 const original=first.calls[0].command,journal=pending(first);assert.equal(Object.keys(journal).length,1);assert.equal(f.snapshot().schedules[0].revision,2);
 first.surface.destroy();const ui=f.mount({saved:first.durable});await ui.refresh();ui.action('open',row.id);ui.storage.failAll=true;await checkReceipt(ui);
 assert.deepEqual(pending(ui),journal);assert.deepEqual(requests(ui.durable),journal);
 for(const call of ui.calls)assert.deepEqual(call.command,original,'Never substitute a newer revision or identity for an uncertain original');
 ui.storage.failAll=false;await checkReceipt(ui);assert.deepEqual(ui.calls.at(-1).command,original);assert.equal(f.snapshot().schedules[0].revision,2);assert.equal(Object.keys(pending(ui)).length,0);
});

test('late accepted action with failed ACK retirement cannot replace another conversation dialog or draft',async t=>{
 const f=await fixture(t),a=await f.schedule('A'),b=await f.schedule('B');let release;
 const reply=new Promise(resolve=>{release=resolve;}),ui=f.mount({fault:'ack',waitForReply:reply});await ui.refresh('A');await ui.refresh('B');ui.action('open',a.id);
 const operation=ui.action('pause',a.id);await Promise.resolve();ui.select('B');ui.action('open',b.id);const later=ui.markup;
 release();await operation;assert.equal(ui.markup,later);assert.deepEqual(ui.state.drafts,{A:'KEEP_A',B:'KEEP_B'});assert.equal(ui.state.selected,'B');
 assert.equal(ui.errorNode.textContent,'','Origin A must not paint its error into B');assert.ok(ui.errors.every(row=>row.id==='A'));assertStorageNotice(ui);
 assert.equal(f.snapshot('A').schedules[0].enabled,false);assert.equal(f.snapshot('B').schedules[0].enabled,true);assert.equal(Object.keys(pending(ui)).length,1);
});

test('a later genuine queue hold is not swallowed by a stale accepted resume identity',async t=>{
 const f=await fixture(t);await f.schedule();
 async function hold(runId){await f.store.transaction(owner,canonical('A'),state=>{state.workflow.hold={runId,message:'Owned uncertain predecessor '+runId};});}
 await hold('owned-first');const first=f.mount({fault:'ack'});await first.refresh();await first.action('resume');assert.equal(f.snapshot().workflow.hold,null);
 const original=first.calls[0].command;await hold('owned-second');first.surface.destroy();const ui=f.mount({saved:first.durable});await ui.refresh();
 await checkReceipt(ui);assert.equal(f.snapshot().workflow.hold.runId,'owned-second','Recovering an old receipt cannot release a later hold');
 await ui.action('resume');
 assert.equal(f.snapshot().workflow.hold,null);assert.ok(f.snapshot().workflow.reviewedRunIds.includes('owned-second'));
 assert.notEqual(ui.calls.at(-1).command.requestId,original.requestId,'The later hold requires a newly admitted resume');
});

test('legacy flat persisted action identity recovers the exact accepted original before admitting a fresh pause',async t=>{
 const f=await fixture(t),row=await f.schedule(),command={requestId:'owned-legacy-pause',expectedRevision:1};
 await f.engine.scheduleAction(owner,canonical('A'),row.id,'pause',command);
 const saved=seed();saved.liveHarness.workflowRequests={['A:pause:'+row.id]:command};
 const ui=f.mount({saved});await ui.refresh();ui.action('open',row.id);await checkReceipt(ui);
 assert.equal(ui.calls.length,1);assert.deepEqual(ui.calls[0].command,command);assert.equal(f.snapshot().schedules[0].revision,2);assert.equal(Object.keys(pending(ui)).length,0);
 await ui.action('enable',row.id);await ui.action('pause',row.id);assert.equal(f.snapshot().schedules[0].enabled,false);assert.equal(f.snapshot().schedules[0].revision,4);
 assert.notEqual(ui.calls.at(-1).command.requestId,command.requestId);
});

test('unconfirmed action blocks a conflicting new intent until explicit durable receipt recovery',async t=>{
 const f=await fixture(t),row=await f.schedule(),ui=f.mount({fault:'network'});await ui.refresh();ui.action('open',row.id);await ui.action('pause',row.id);
 const journal=pending(ui),calls=ui.calls.length;await ui.action('enable',row.id);await ui.action('run-now',row.id);
 assert.equal(ui.calls.length,calls,'Unknown original acceptance cannot authorize another action or nonce');assert.deepEqual(pending(ui),journal);
 assert.equal(f.snapshot().schedules[0].enabled,false);assert.equal(f.snapshot().queue.length,0);assert.ok(ui.errors.length>0);
 await checkReceipt(ui);assert.equal(Object.keys(pending(ui)).length,0);await ui.action('enable',row.id);assert.equal(f.snapshot().schedules[0].enabled,true);
});

test('original mutation revision conflict is known nonadmission and durable retirement permits a fresh retry',async t=>{
 const f=await fixture(t),row=await f.schedule(),ui=f.mount({fault:'ack'});await ui.refresh();ui.action('open',row.id);
 await f.engine.scheduleAction(owner,canonical('A'),row.id,'pause',{requestId:'owned-external-pause',expectedRevision:1});
 await ui.action('pause',row.id);const rejected=ui.calls[0].command;
 assert.ok(ui.errors.some(row=>row.error.code==='REVISION_CONFLICT'));assert.equal(f.snapshot().schedules[0].revision,2);
 assert.equal(Object.hasOwn(f.store.get(owner,canonical('A')).requests,'workflow-schedule-action:'+row.id+':'+rejected.requestId),false,'The original mutation never admitted this request');
 assert.equal(Object.keys(pending(ui)).length,1,'Failed rejected-intent retirement must keep the original pinned');
 ui.storage.failRetirement=false;await checkReceipt(ui);assert.equal(Object.keys(pending(ui)).length,0);assert.equal(f.snapshot().schedules[0].revision,2);
 await ui.action('pause',row.id);assert.equal(f.snapshot().schedules[0].revision,3);assert.equal(f.snapshot().schedules[0].enabled,false);
 assert.notEqual(ui.calls.at(-1).command.requestId,rejected.requestId);assert.equal(ui.calls.at(-1).command.expectedRevision,2);
});

test('revision-conflict-shaped refresh failure after accepted pause cannot retire its original identity',async t=>{
 const f=await fixture(t),row=await f.schedule(),ui=f.mount();await ui.refresh();ui.action('open',row.id);
 ui.failNextRefresh(Object.assign(new Error('Owned snapshot failure after accepted pause'),{code:'REVISION_CONFLICT'}));
 await ui.action('pause',row.id);const original=ui.calls[0].command,journal=pending(ui);
 assert.equal(f.snapshot().schedules[0].revision,2);assert.equal(f.snapshot().schedules[0].enabled,false);
 const receiptKey='workflow-schedule-action:'+row.id+':'+original.requestId,receipt=structuredClone(f.store.get(owner,canonical('A')).requests[receiptKey]);
 assert.ok(receipt,'The real original mutation was durably accepted');assert.equal(Object.keys(journal).length,1,'A refresh error cannot establish original nonadmission');
 assert.deepEqual(requests(ui.durable),journal);assert.ok(ui.errors.some(row=>row.error.code==='REVISION_CONFLICT'));
 await checkReceipt(ui);assert.deepEqual(ui.calls.at(-1).command,original);assert.equal(ui.calls.length,2);assert.equal(f.snapshot().schedules[0].revision,2);
 assert.deepEqual(f.store.get(owner,canonical('A')).requests[receiptKey],receipt);assert.equal(Object.keys(pending(ui)).length,0);
});

test('accepted cancellation remains explicitly recoverable when no visible queue rows or hold survive',async t=>{
 const f=await fixture(t),accepted=await f.engine.enqueue(owner,canonical('A'),{requestId:'owned-cancel-head',text:'OWNED_CANCEL_HEAD'});
 const ui=f.mount({fault:'ack'});await ui.refresh();assert.match(ui.surface.queueMarkup(),/OWNED_CANCEL_HEAD/);
 await ui.action('cancel',accepted.queueId);const original=ui.calls[0].command,snapshot=f.snapshot();
 assert.equal(snapshot.queue.length,1);assert.equal(snapshot.queue[0].status,'cancelled');assert.equal(snapshot.queue[0].runId,undefined);assert.equal(snapshot.workflow.hold,null);
 assertStorageNotice(ui);assert.equal(Object.keys(pending(ui)).length,1);const markup=ui.surface.queueMarkup();
 assert.doesNotMatch(markup,/<article\b[^>]*data-live-queue-id=/,'The cancelled canonical row is no longer an actionable queue row');assert.match(markup,/Ontvangst controleren/i,'Pending cancellation recovery survives an otherwise empty queue');
 const receiptKey='workflow-cancel:'+accepted.queueId+':'+original.requestId,receipt=structuredClone(f.store.get(owner,canonical('A')).requests[receiptKey]);assert.ok(receipt);
 ui.storage.failRetirement=false;await checkReceipt(ui);assert.equal(ui.calls.length,2);assert.deepEqual(ui.calls[1].command,original);assert.deepEqual(Object.keys(ui.calls[1].command),['requestId']);
 assert.equal(Object.keys(pending(ui)).length,0);assert.equal(f.snapshot().queue.length,1);assert.equal(f.snapshot().queue[0].status,'cancelled');assert.deepEqual(f.store.get(owner,canonical('A')).requests[receiptKey],receipt);
});
