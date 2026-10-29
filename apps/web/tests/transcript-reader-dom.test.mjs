import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranscriptReader} from '../transcript-reader.js';
import {fixture} from './transcript-reader-fixture.mjs';
function setup(){const f=fixture(),reader=createTranscriptReader(f);reader.afterRender();f.transcript.writes=[];return {f,reader};}
for(const away of [1,60])test(`one shared DOM owner preserves ${away}px read position in both update seams`,()=>{
 const {f,reader}=setup();f.gesture(away);assert.equal(reader.view().isPinnedToBottom,false);
 const before=f.transcript.top;reader.beforeMutation();f.growBelow(100);reader.afterMutation({cause:'stream-delta'});assert.equal(f.transcript.top,before);
 reader.beforeMutation();reader.beforeMutation();f.growBelow(100);reader.afterRender();reader.afterMutation({cause:'stream-delta'});assert.equal(f.transcript.top,before);reader.afterMutation({cause:'stream-delta'});assert.equal(f.transcript.top,before);assert.deepEqual(f.transcript.writes,[]);reader.destroy();
});
test('latest repins then new content follows, upward reader releases again',()=>{
 const {f,reader}=setup();f.gesture(60);f.advance(300);assert.equal(reader.jumpToBottom(),true);assert.equal(f.transcript.top,1500);
 reader.beforeMutation();f.growBelow(100);reader.afterMutation({cause:'stream-delta'});assert.equal(f.transcript.top,1600);
 f.gesture(1);reader.beforeMutation();f.growBelow(100);reader.afterMutation({cause:'stream-delta'});assert.equal(f.transcript.top,1599);reader.destroy();
});
test('same-key whole app render restores the anchor after all parking and view mutations',()=>{
 const {f,reader}=setup();f.gesture(60);f.advance(300);const renderToken=reader.beforeRender();const old=f.transcript;f.replace();f.growAbove(100);reader.afterRender({renderToken});assert.equal(f.transcript.top,1540);assert.equal(reader.view().isPinnedToBottom,false);
 const writes=f.transcript.writes.length;old.top=0;old.dispatchEvent(new Event('scroll'));f.flush();assert.equal(f.transcript.writes.length,writes);reader.destroy();
});
test('semantic latest wins over parked anchor during nested mutation render',()=>{
 const {f,reader}=setup();f.gesture(60);reader.beforeMutation();const renderToken=reader.beforeRender();assert.equal(reader.jumpToBottom(),true);f.replace();f.growBelow(200);reader.afterRender({renderToken});assert.equal(f.transcript.top,0);reader.afterMutation();assert.equal(f.transcript.top,1700);assert.equal(reader.view().isPinnedToBottom,true);reader.destroy();
});
test('state notification is emitted after final reconcile including no-scroll top-edge release',()=>{
 const {f,reader}=setup(),seen=[];reader.subscribe(view=>seen.push({pinned:view.isPinnedToBottom,top:f.transcript.top}));
 const renderToken=reader.beforeRender();f.replace();reader.afterRender({renderToken});assert.deepEqual(seen.at(-1),{pinned:true,top:1500});
 f.transcript.top=0;reader.jumpToBottom();f.transcript.height=2000;f.transcript.top=0;reader.setNavigation(true);f.event('wheel',{deltaY:-1,ctrlKey:false});f.flush();assert.equal(reader.view().isPinnedToBottom,false);assert.equal(seen.at(-1).pinned,false);reader.destroy();
});
test('synchronous own-write scroll echo never becomes reader release',()=>{
 const {f,reader}=setup();f.transcript.echo=true;f.gesture(60);f.advance(300);reader.jumpToBottom();f.flush();assert.equal(reader.view().isPinnedToBottom,true);
 reader.beforeMutation();f.growBelow(100);reader.afterMutation();f.flush();assert.equal(f.transcript.top,1600);assert.equal(reader.view().isPinnedToBottom,true);reader.destroy();
});
test('observer handles height growth and pointer held period then quiet expiry',()=>{
 const {f,reader}=setup();f.event('wheel',{deltaY:-1,ctrlKey:false});f.growBelow(100);f.observers.at(-1).fire();f.flush();assert.equal(f.transcript.top,1500);assert.equal(reader.view().deferred,true);
 f.event('pointerdown');f.advance(1000);assert.equal(f.transcript.top,1500);f.event('pointerup',{},f.doc);f.flush();f.advance(251);assert.equal(f.transcript.top,1600);reader.destroy();
});
test('editable keys and modifiers stay with owners; actual unmodified reader key attributes direction',()=>{
 const {f,reader}=setup();
 for(const [key,props,target]of [['ArrowUp',{shiftKey:true}],['End',{ctrlKey:true}],['ArrowUp',{},f.field('INPUT')],['ArrowUp',{},f.field('TEXTAREA')],['ArrowUp',{},f.field('SELECT')],[' ',{},f.field('BUTTON')]]){f.keyEvent(key,props,target);f.growBelow(10);f.observers.at(-1).fire();f.flush();assert.equal(reader.view().deferred,false);}
 f.keyEvent('ArrowUp');f.growBelow(20);f.observers.at(-1).fire();f.flush();assert.equal(reader.view().deferred,true);reader.destroy();
});
test('Ctrl-wheel zoom input does not invent top-edge scroll release',()=>{
 const {f,reader}=setup();f.transcript.top=0;f.event('wheel',{deltaY:-1,ctrlKey:true});f.flush();assert.equal(reader.view().isPinnedToBottom,true);assert.equal(reader.view().pinResolution.event.kind,'neutral');reader.destroy();
});
test('zero-height parking cannot replace state or jump before visible restore',()=>{
 const {f,reader}=setup();f.gesture(60);f.advance(300);f.transcript.clientHeight=0;f.observers.at(-1).fire();f.flush();assert.equal(reader.view().isPinnedToBottom,false);
 f.transcript.clientHeight=500;f.observers.at(-1).fire();f.flush();assert.equal(f.transcript.top,1440);reader.destroy();
});
test('Bot switch starts source-backed pinned mode with no invented remembered anchor',()=>{
 const {f,reader}=setup();f.gesture(60);let renderToken=reader.beforeRender();f.replace('second');reader.afterRender({renderToken});assert.equal(f.transcript.top,1500);assert.equal(reader.view().isPinnedToBottom,true);renderToken=reader.beforeRender();f.replace('first');reader.afterRender({renderToken});assert.equal(f.transcript.top,1500);reader.destroy();
});
test('destroy stops only owned observer frames deadlines and event handlers',()=>{
 const {f,reader}=setup();f.event('wheel',{deltaY:-1});f.growBelow(100);f.observers.at(-1).fire();f.flush();reader.destroy();const top=f.transcript.top,writes=f.transcript.writes.length;
 f.event('wheel',{deltaY:1});f.event('scroll');f.observers.at(-1).fire();f.flush();f.advance(1000);assert.equal(f.transcript.top,top);assert.equal(f.transcript.writes.length,writes);assert.equal(f.frames.size,0);assert.equal(f.deadlines.size,0);assert.ok(f.observers.every(observer=>observer.observed.size===0));
});
test('old Bot scroll-idle deadline cannot publish into the replacement transcript',()=>{
 const {f,reader}=setup();f.gesture(60);let renderToken=reader.beforeRender();f.replace('second');reader.afterRender({renderToken});const seen=[];reader.subscribe(view=>seen.push(view));f.advance(1000);assert.deepEqual(seen,[]);reader.destroy();
});
test('queued old observer callback cannot schedule work after its binding was replaced',()=>{
 const {f,reader}=setup(),old=f.observers.at(-1);const renderToken=reader.beforeRender();f.replace();reader.afterRender({renderToken});assert.equal(f.frames.size,0);old.fire();assert.equal(f.frames.size,0);reader.destroy();
});

test('adapter retains fractional raw bottom offsets and never rounds a subpixel correction',()=>{
 const {f,reader}=setup();f.transcript.height=7006;f.transcript.clientHeight=874;f.transcript.top=6132.5;f.observers.at(-1).fire();f.flush();assert.equal(f.transcript.top,6132.5);assert.deepEqual(f.transcript.writes,[]);assert.equal(reader.view().isPinnedToBottom,true);
 f.gesture(1);assert.equal(f.transcript.top,6131.5);assert.equal(reader.view().isPinnedToBottom,false);reader.destroy();
});
test('nested paired renders wait for both opaque captures before any reconciliation',()=>{
 const {f,reader}=setup(),outer=reader.beforeRender(),inner=reader.beforeRender();f.replace();f.growBelow(100);reader.afterRender({renderToken:inner});assert.deepEqual(f.transcript.writes,[]);reader.afterRender({renderToken:outer});assert.equal(f.transcript.top,1600);reader.destroy();
});
test('unpaired source-ready or surface-change cannot close an outer render capture',()=>{
 const {f,reader}=setup(),outer=reader.beforeRender();f.replace();f.growBelow(100);reader.afterRender({cause:'measured-verification'});assert.deepEqual(f.transcript.writes,[]);reader.afterRender({renderToken:outer});assert.equal(f.transcript.top,1600);reader.destroy();
});

test('explicit latest uses one synchronous instant scrollTo; measured corrections use geometry writes',()=>{
 const {f,reader}=setup();f.transcript.smooth=[];f.gesture(60);f.advance(300);reader.jumpToBottom();assert.deepEqual(f.transcript.smooth,[{top:1500,behavior:'instant'}]);assert.equal(f.transcript.top,1500);reader.beforeMutation();f.growBelow(100);reader.afterMutation({cause:'stream-delta'});assert.equal(f.transcript.top,1600);assert.equal(f.transcript.smooth.length,1);reader.destroy();
});
for(const reduced of [false,true])test(`injectable eligible follow honors reduced motion ${reduced}`,()=>{
 const f=fixture(),reader=createTranscriptReader({...f,streamingFollowEligible:()=>true,reducedMotion:()=>reduced});reader.afterRender();f.transcript.smooth=[];reader.beforeMutation();f.growBelow(100);reader.afterMutation({cause:'stream-delta'});assert.deepEqual(f.transcript.smooth,reduced?[]:[{top:1600,behavior:'smooth'}]);assert.equal(f.transcript.top,reduced?1600:1500);reader.destroy();
});
