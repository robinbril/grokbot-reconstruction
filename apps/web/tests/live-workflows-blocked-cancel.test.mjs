// Actual durable store + attachment validation + engine + production render/action.
// The runtime boundary never submits a provider request or fabricates completion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,rename} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {HarnessStore} from '../harness/store.mjs';
import {AttachmentStore} from '../harness/attachments.mjs';
import {WorkflowEngine} from '../harness/workflows.mjs';
import {createLiveWorkflowsSurface} from '../live-workflows-surface.js';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('blocked never-sent manual head exposes Cancel and releases its healthy successor',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'workflow-blocked-cancel-'));
 const owner='owned-blocked-cancel',id='owned-conversation',store=await new HarnessStore({dataDir}).init();
 const attachments=await new AttachmentStore({dataDir,store}).init();let occupied=true;
 const attempts=[];
 const runtime={active:()=>occupied,withLifecycle:async(_id,fn)=>fn(),connect:async()=>{},startUnlocked:async(_owner,_id,payload)=>{attempts.push(payload.text);throw Object.assign(new Error('No-provider probe stops at dispatch boundary'),{code:'PROBE_NO_PROVIDER'});}};
 const engine=await new WorkflowEngine({store,attachments,runtime,autoStart:false}).init();
 t.after(async()=>{await engine.close();await rm(dataDir,{recursive:true,force:true});});
 const bytes=Buffer.from('owned original attachment'),reserved=await attachments.reserve(owner,id,{requestId:'reserve',name:'owned.txt',type:'text/plain',size:bytes.length,sha256:digest(bytes)});
 await attachments.put(owner,id,reserved.attachmentId,(async function*(){yield bytes;})());
 const first=await engine.enqueue(owner,id,{requestId:'first',text:'BLOCKED_FILE_HEAD',attachmentRefs:[{attachmentId:reserved.attachmentId,size:bytes.length,sha256:digest(bytes)}]});
 const second=await engine.enqueue(owner,id,{requestId:'second',text:'HEALTHY_TEXT_SUCCESSOR'});
 await Promise.all([...engine.pumps.values()]);
 const original=path.join(dataDir,'attachments',id,reserved.attachmentId,'source'),aside=original+'.owned-test-aside';
 await rename(original,aside);
 try{
  occupied=false;await engine.pump(id);
  const snapshot=()=>store.snapshot(store.get(owner,id)),row=qid=>snapshot().queue.find(item=>item.id===qid);
  assert.equal(row(first.queueId).status,'blocked');assert.equal(row(first.queueId).error.code,'ATTACHMENT_UNAVAILABLE');assert.equal(row(first.queueId).runId,undefined);assert.equal(row(second.queueId).status,'queued');assert.deepEqual(attempts,[]);
  let state={liveHarness:{}};
  const host={esc,getState:()=>state,getDialogVersion:()=>0,commit(fn){state=fn(state);return {ok:true};},app:{querySelector:()=>null},overlay:{querySelector:()=>null,querySelectorAll:()=>[]},draftAttachments:()=>[]};
  const surface=createLiveWorkflowsSurface({host,client:{cancelQueued:(_id,qid,rid)=>engine.cancel(owner,id,qid,rid)},key:()=>id,serverId:()=>id,isLive:()=>true,snapshot,refresh:async()=>{},setError:(_id,error)=>{throw error;},activeRun:()=>null});
  t.after(()=>surface.destroy());
  const article=surface.queueMarkup().match(new RegExp('<article[^>]+data-live-queue-id="'+first.queueId+'"[\\s\\S]*?<\\/article>'))?.[0];
  assert.ok(article,'Render the actual blocked row');
  const rendered=[...article.matchAll(/<button\b([^>]+)>/g)].map(match=>({action:match[1].match(/data-action="([^"]+)"/)?.[1],id:match[1].match(/data-id="([^"]+)"/)?.[1]}));
  const cancel=rendered.find(button=>button.action==='live-workflow-cancel');
  assert.ok(cancel,'Blocked never-sent work must expose a Cancel button, not only Retry');assert.equal(cancel.id,first.queueId);
  await surface.handleAction(cancel);await Promise.all([...engine.pumps.values()]);
  assert.equal(row(first.queueId).status,'cancelled');assert.equal(row(first.queueId).runId,undefined);assert.deepEqual(attempts,['HEALTHY_TEXT_SUCCESSOR'],'Cancelling the head must release the exact following payload to the runtime boundary');
 }finally{await rename(aside,original);}
});
