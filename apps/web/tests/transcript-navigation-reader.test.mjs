import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranscriptReader} from '../transcript-reader.js';
import {fixture} from './transcript-reader-fixture.mjs';

function setup(options={}){const f=fixture(),reader=createTranscriptReader({...f,...options});reader.afterRender();f.transcript.writes=[];return {f,reader};}
test('shared reader navigates far row instantly and retains its semantic anchor across growth',()=>{
 const {f,reader}=setup();
 assert.equal(typeof reader.navigateToTarget,'function','shared owner must expose native navigation');
 assert.ok(reader.navigateToTarget(()=>f.transcript.rows[1]));
 assert.equal(f.transcript.top,50);
 assert.deepEqual(reader.view().mode,{kind:'anchored',rowId:'r1',edgeOffsetPx:150});
 reader.beforeMutation();f.growAbove(120);reader.afterMutation();
 assert.equal(f.transcript.top,170);reader.destroy();
});
test('near auto navigation uses owned spring frames and reduced motion lands immediately',()=>{
 for(const reduce of [false,true]){
  const {f,reader}=setup({reducedMotion:()=>reduce});
  assert.equal(typeof reader.navigateToTarget,'function');
  assert.ok(reader.navigateToTarget(()=>f.transcript.rows[7]));
  assert.equal(f.transcript.top,reduce?1250:1500);
  assert.equal(reader.view().isPinnedToBottom,false);
  if(reduce)assert.equal(reader.view().completion.outcome.kind,'reduced-motion');
  else assert.deepEqual(reader.view().mode,{kind:'free',lastUserDirection:-1});
  assert.equal(f.transcript.smooth.some(write=>write.behavior==='smooth'),false);
  if(!reduce){f.advance(16);const pending=[...f.frames];f.frames.clear();for(const[,fn]of pending)fn(16);assert.ok(f.transcript.top<1500&&f.transcript.top>1250);}
  reader.destroy();assert.equal(f.frames.size,0);assert.equal(f.deadlines.size,0);
 }
});
test('instant and already-arrived requests never publish a transient released owner',()=>{
 for(const index of [1,8]){
  const {f,reader}=setup(),seen=[];reader.subscribe(value=>seen.push(value));
  if(index===8)f.transcript.rows[index].offset=1650;
  reader.navigateToTarget(()=>f.transcript.rows[index]);
  assert.ok(seen.every(value=>value.navigation.kind==='idle'),'only actual smooth travel publishes acquisition');
  reader.destroy();
 }
});
test('active navigation survives same-key full render and excludes ordinary anchor correction',()=>{
 const {f,reader}=setup();assert.equal(typeof reader.navigateToTarget,'function');
 reader.navigateToTarget(()=>f.transcript.rows[7]);
 const id=reader.view().navigation.navigationId,token=reader.beforeRender();
 f.advance(100);f.replace();reader.afterRender({renderToken:token});
 assert.equal(reader.view().navigation.navigationId,id);assert.equal(reader.view().navigation.kind,'smooth');
 assert.equal(f.transcript.top,1500,'replacement viewport restores captured actual offset before spring resumes');
 const writes=f.transcript.writes.length;
 reader.beforeMutation();f.growAbove(50);reader.afterMutation();
 assert.equal(f.transcript.writes.length,writes,'ordinary structural anchoring must yield to active pacer');
 f.event('wheel',{deltaY:-1,ctrlKey:false});
 assert.equal(reader.view().navigation.kind,'idle');assert.equal(reader.view().completion.outcome.kind,'user-cancelled');reader.destroy();
});
test('distinct live deliveries become semantic rows rather than their aggregate message',()=>{
 const {f,reader}=setup();assert.equal(typeof reader.navigateToTarget,'function');
 const aggregate=f.transcript.rows[1],delivery={dataset:{liveMessageId:'bot-reply-2'},isConnected:true,getBoundingClientRect:()=>({top:100+300-f.transcript.top,height:40})};
 aggregate.querySelectorAll=()=>[delivery];
 reader.navigateToTarget(()=>delivery);
 assert.deepEqual(reader.view().mode,{kind:'anchored',rowId:'live:bot-reply-2',edgeOffsetPx:230});
 assert.equal(f.transcript.top,70);reader.destroy();
});
test('zero-height parking pauses paced work and visibility restoration resumes same owner',()=>{
 const {f,reader}=setup();reader.navigateToTarget(()=>f.transcript.rows[7]);const id=reader.view().navigation.navigationId;
 f.transcript.clientHeight=0;f.observers.at(-1).fire();
 const pending=[...f.frames];f.frames.clear();for(const[,fn]of pending)fn(16);
 f.advance(100);assert.equal(f.transcript.top,1500);
 f.transcript.clientHeight=500;f.observers.at(-1).fire();
 const resumed=[...f.frames];f.frames.clear();for(const[,fn]of resumed)fn(116);
 assert.equal(reader.view().navigation.navigationId,id);assert.ok(f.frames.size>0);reader.destroy();
});
test('conversation replacement disposes navigation without settling into the new viewport',()=>{
 const {f,reader}=setup();reader.navigateToTarget(()=>f.transcript.rows[7]);
 const oldFrames=[...f.frames.values()],oldDeadlines=[...f.deadlines.values()],token=reader.beforeRender();
 f.replace('next-conversation');reader.afterRender({renderToken:token});
 assert.equal(reader.view().navigation.kind,'idle');assert.equal(reader.view().completion.outcome.kind,'disposed');
 assert.equal(reader.view().isPinnedToBottom,true);const writes=f.transcript.writes.length;
 for(const fn of oldFrames)fn(100);for(const job of oldDeadlines)job.fn();
 assert.equal(f.transcript.writes.length,writes);reader.destroy();
});
test('outside-viewport pointer handoff belongs to latest dock, while find controls retain ownership',()=>{
 const f=fixture(),root=new EventTarget(),find=f.field('INPUT'),dock=f.field('BUTTON');
 f.transcript.closest=selector=>selector==='.thread-frame'?root:null;
 f.transcript.contains=node=>node===f.transcript;
 dock.closest=selector=>selector==='[data-product-jump-dock]'?dock:null;
 const reader=createTranscriptReader(f);reader.afterRender();reader.navigateToTarget(()=>f.transcript.rows[7]);
 function pointer(target){const event=new Event('pointerdown');Object.defineProperty(event,'target',{value:target});root.dispatchEvent(event);}
 pointer(find);assert.equal(reader.view().navigation.kind,'smooth','find bar is outside the native scroll-area root');
 pointer(dock);assert.equal(reader.view().navigation.kind,'idle');assert.equal(reader.view().completion.outcome.kind,'user-cancelled');reader.destroy();
});
