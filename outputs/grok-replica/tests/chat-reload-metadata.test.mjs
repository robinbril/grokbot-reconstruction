import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatStateHost} from '../chat-state-host.js';
import {createChatRunController} from '../chat-run-controller.js';

function seedRun(id, conversationId, generation = 1) {
  const input = {id:`${id}:input`, role:'user', text:'one two'};
  const output = {id:`${id}:output`, role:'bot', text:'ONE', transcript:{schema:1, kind:'send-message', revision:2, status:'streaming', runId:id, generation, replica:{producer:'local-text-v1', operation:'upper'}, payload:{layoutMode:'bubble'}}};
  const run = {schema:1, id, conversationId, submissionId:`${id}:submission`, inputEntryId:input.id, outputEntryId:output.id, noticeEntryIds:[], adapterId:'local-text-v1', operation:'upper', style:'short', styleProfileVersion:'local-answer-v1', generation, lastSeq:1, phase:'running', progress:{processed:3, total:input.text.length}, createdAt:1, updatedAt:2, delivery:null};
  return {run, messages:[input, output]};
}

function harness(initial) {
  let state = initial, denied = false, attempts = 0, executions = 0;
  const writes = [];
  const host = createChatStateHost({getState:()=>state, publishState:next=>{state=next;}, initialSavedState:initial, storageKey:'grok-local-replica-v1', storage:{setItem(key, bytes) {
    assert.equal(key, 'grok-local-replica-v1'); attempts++;
    if (denied) throw new Error('storage denied');
    writes.push(JSON.parse(bytes));
  }}});
  const controller = createChatRunController({getState:()=>state, ...host, adapter:{id:'local-text-v1', async execute() {executions++; throw new Error('Reload must never execute work');}}});
  return {host, controller, writes, get state(){return state;}, get attempts(){return attempts;}, get executions(){return executions;}, deny(value){denied=value;}};
}

for (const placement of ['own', 'inherited']) for (const throws of [false, true]) {
  test(`reload treats ${placement} ${throws ? 'throwing' : 'benign'} generation getter as inert invalid metadata`, async()=>{
    const fixture = seedRun('r', 'c');
    let reads = 0;
    const descriptor = {enumerable:true, configurable:true, get(){reads++; if (throws) throw new Error('Forbidden generation getter'); return 1;}};
    if (placement === 'own') Object.defineProperty(fixture.run, 'generation', descriptor);
    else {delete fixture.run.generation; Object.setPrototypeOf(fixture.run, Object.defineProperty({}, 'generation', descriptor));}
    const messages = {c:fixture.messages}, initial = {version:1, messages, chatRuns:{r:fixture.run}, drafts:{c:'keep draft'}};
    const h = harness(initial), request = {conversationId:'c', runId:'r'};
    try {
      assert.equal(reads, 0, 'Host initialization must not execute hydrated metadata');
      assert.equal(h.controller.getRuntime(request).errorCode, 'unavailable');
      let result;
      await assert.doesNotReject(async()=>{result=await h.controller.reconcileReload();});
      assert.equal(reads, 0, 'Reload must inspect own data descriptors without invoking generation getters');
      assert.deepEqual(result, {ok:true});
      assert.deepEqual(Object.keys(h.state.chatRuns), []);
      assert.equal(h.state.messages, messages);
      assert.equal(h.state.messages.c, fixture.messages);
      assert.equal(h.state.messages.c[1], fixture.messages[1]);
      assert.equal(h.state.messages.c[1].text, 'ONE');
      assert.equal(h.state.messages.c[1].transcript.status, 'streaming');
      assert.equal(h.state.drafts, initial.drafts);
      assert.equal(h.writes.length, 1);
      assert.deepEqual(h.writes[0].chatRuns, {});
      assert.deepEqual(h.writes[0].messages.c, fixture.messages);
      assert.equal(h.host.getChatSaveState(request), null);
      assert.deepEqual(h.controller.getRuntime(request), {effectivePhase:'interrupted', textSaved:false, statusSaved:false, delivered:false, canRetryDelivery:false, canResume:false, errorCode:'unavailable'});
      assert.equal((await h.controller.resume(request)).ok, false);
      assert.equal((await h.controller.retryDelivery(request)).ok, false);
      assert.deepEqual(await h.controller.reconcileReload(), {ok:true});
      assert.equal(h.writes.length, 1, 'Successful repeated reconciliation must be a no-op');
      assert.equal(h.executions, 0);
      assert.equal(reads, 0);
    } finally {h.controller.destroy();}
  });
}

test('retry after denied reload repairs original boot generation without interrupting added or advanced valid runs', async()=>{
  const original = seedRun('original', 'original-chat'), changed = seedRun('changed', 'changed-chat');
  const initial = {version:1, messages:{'original-chat':original.messages, 'changed-chat':changed.messages}, chatRuns:{original:original.run, changed:changed.run}, drafts:{'original-chat':'keep draft'}};
  const h = harness(initial), originalRequest = {conversationId:'original-chat', runId:'original'};
  try {
    h.deny(true);
    assert.deepEqual(await h.controller.reconcileReload(), {ok:false, code:'storage'});
    assert.equal(h.state, initial);
    assert.equal(h.writes.length, 0);
    assert.equal(h.attempts, 1);
    const failed = h.controller.getRuntime(originalRequest);
    assert.equal(failed.effectivePhase, 'interrupted');
    assert.equal(failed.textSaved, true);
    assert.equal(failed.statusSaved, false);
    assert.equal(failed.canResume, false);
    assert.equal(failed.errorCode, 'reload-save-failed');
    assert.equal((await h.controller.resume(originalRequest)).code, 'reload-not-reconciled');
    assert.equal(h.executions, 0);

    // A different writer commits current data while the boot repair awaits explicit retry.
    const advanced = seedRun('changed', 'changed-chat', 2), added = seedRun('added', 'added-chat');
    h.deny(false);
    assert.deepEqual(h.host.commit(latest=>({...latest, chatRuns:{...latest.chatRuns, changed:advanced.run, added:added.run}, messages:{...latest.messages, 'changed-chat':advanced.messages, 'added-chat':added.messages}, drafts:{...latest.drafts, 'added-chat':'concurrent draft'}})), {ok:true});
    const beforeRetry = h.state;
    assert.deepEqual(await h.controller.reconcileReload(), {ok:true});
    assert.equal(h.state.chatRuns.original.phase, 'interrupted');
    assert.equal(h.state.chatRuns.original.generation, 1);
    assert.equal(h.state.messages['original-chat'][1].transcript.status, 'interrupted');
    assert.equal(h.state.messages['original-chat'][1].text, 'ONE');
    assert.deepEqual(h.state.chatRuns.original.progress, {processed:3, total:7});
    assert.equal(h.state.chatRuns.original.lastSeq, 1);
    assert.equal(h.state.chatRuns.original.delivery, null);
    for (const [runId, conversationId, fixture] of [['changed', 'changed-chat', advanced], ['added', 'added-chat', added]]) {
      assert.equal(h.state.chatRuns[runId], fixture.run, 'Post-boot generation must retain its journal identity');
      assert.equal(h.state.messages[conversationId], fixture.messages, 'Post-boot generation must retain exact entries');
      assert.equal(h.state.chatRuns[runId].phase, 'running');
      assert.equal(h.state.messages[conversationId][1].transcript.status, 'streaming');
      const runtime = h.controller.getRuntime({conversationId, runId});
      assert.equal(runtime.effectivePhase, 'interrupted', 'Persisted running text cannot imply active computation');
      assert.equal(runtime.delivered, false);
      assert.equal(runtime.textSaved, true);
      assert.equal(runtime.statusSaved, false);
      assert.equal(runtime.canRetryDelivery, false);
      assert.equal(runtime.canResume, true);
    }
    assert.equal(h.state.drafts, beforeRetry.drafts);
    assert.equal(h.state.drafts['added-chat'], 'concurrent draft');
    const repaired = h.controller.getRuntime(originalRequest);
    assert.equal(repaired.statusSaved, true);
    assert.equal(repaired.canResume, true);
    assert.equal(repaired.errorCode, undefined);
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes.at(-1).chatRuns.original.phase, 'interrupted');
    assert.equal(h.writes.at(-1).chatRuns.changed.phase, 'running');
    assert.equal(h.writes.at(-1).chatRuns.changed.generation, 2);
    assert.equal(h.writes.at(-1).chatRuns.added.phase, 'running');
    const repairedState = h.state;
    assert.deepEqual(await h.controller.reconcileReload(), {ok:true});
    assert.equal(h.state, repairedState);
    assert.equal(h.writes.length, 2);
    assert.equal(h.executions, 0);
  } finally {h.controller.destroy();}
});
