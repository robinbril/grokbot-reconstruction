import test from 'node:test';
import assert from 'node:assert/strict';

async function fixture(){
 const {createTranscriptNavigation}=await import('../transcript-navigation.js');
 let now=0,sequence=0,top=0,rowTop=400,present=true,paused=false;
 const frames=new Map(),deadlines=new Map(),writes=[],settlements=[],changes=[];
 const environment={now:()=>now,requestFrame:fn=>{const id=++sequence;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id),deadline:(fn,ms)=>{const id=++sequence;deadlines.set(id,{fn,at:now+ms});return id;},cancelDeadline:id=>deadlines.delete(id),isFrameClockPaused:()=>paused};
 const snapshot=()=>({totalSizePx:3000,viewport:{scrollTopPx:top,viewportHeightPx:500},rows:present?[{heightPx:100}]:[],indexOf:id=>present&&id==='row'?0:undefined,offsetOf:id=>present&&id==='row'?rowTop:undefined});
 const owner=createTranscriptNavigation({environment,snapshot,write:value=>{top=value;writes.push(value);return top;},settle:target=>{settlements.push(target);if(target.kind==='row')top=rowTop-target.edgeOffsetPx;},changed:value=>changes.push(value),reducedMotion:()=>false});
 function advance(ms){now+=ms;for(const[id,job]of [...deadlines].sort((a,b)=>a[1].at-b[1].at)){if(job.at<=now&&deadlines.delete(id))job.fn();}}
 function frame(ms=16){now+=ms;const pending=[...frames];frames.clear();for(const[,fn]of pending)fn(now);}
 return {owner,frames,deadlines,writes,settlements,changes,advance,frame,get top(){return top;},set top(value){top=value;},set rowTop(value){rowTop=value;},set present(value){present=value;},set paused(value){paused=value;}};
}
const target={kind:'row',rowId:'row',align:'center',offsetPx:0};
test('smooth owner holds against scrollend, retargets, then lands semantically',async()=>{
 const f=await fixture();assert.ok(f.owner.navigate(target,{motion:'smooth'}));
 f.owner.sync();assert.equal(f.owner.view().navigation.kind,'smooth');
 f.rowTop=600;f.owner.sync();
 for(let i=0;i<100&&f.owner.view().navigation.kind!=='idle';i++)f.frame();
 assert.equal(f.top,400);assert.equal(f.owner.view().completion.outcome.kind,'target-reached');
 assert.deepEqual(f.settlements.at(-1),{kind:'row',rowId:'row',edgeOffsetPx:200});f.owner.destroy();
});
test('unresolved replacement preserves owner; replacement and stale callbacks cannot clear current owner',async()=>{
 const f=await fixture(),first=f.owner.navigate(target,{motion:'smooth'}),oldFrames=[...f.frames.values()],oldDeadlines=[...f.deadlines.values()];
 assert.equal(f.owner.navigate({...target,rowId:'missing'},{motion:'smooth'}),null);assert.equal(f.owner.view().navigation.navigationId,first);
 const second=f.owner.navigate(target,{motion:'smooth'});assert.ok(second>first);
 for(const fn of oldFrames)fn(400);for(const job of oldDeadlines)job.fn();
 assert.equal(f.owner.view().navigation.navigationId,second);f.owner.destroy();assert.equal(f.frames.size,0);assert.equal(f.deadlines.size,0);
});
test('user cancellation and disappearing target settle observed free offset',async()=>{
 for(const removed of [false,true]){
  const f=await fixture();f.owner.navigate(target,{motion:'smooth'});f.frame();const top=f.top;
  if(removed){f.present=false;f.owner.sync();}else f.owner.interrupt(-1);
  assert.equal(f.top,top);assert.equal(f.owner.view().navigation.kind,'idle');
  assert.equal(f.owner.view().completion.outcome.kind,removed?'target-unresolved':'user-cancelled');
  assert.deepEqual(f.settlements.at(-1),{kind:'offset',scrollTopPx:top,arrivalMode:{kind:'free',lastUserDirection:removed?0:-1}});f.owner.destroy();
 }
});
test('bounded watchdog lands semantic target while paused frame fallback waits for explicit pause signal',async()=>{
 const f=await fixture();f.owner.navigate(target,{motion:'smooth'});f.advance(250);assert.equal(f.top,0);
 f.paused=true;f.advance(250);assert.equal(f.top,200);assert.equal(f.owner.view().navigation.kind,'idle');f.owner.destroy();
 const g=await fixture();g.owner.navigate(target,{motion:'smooth'});g.owner.pause();g.advance(2100);assert.equal(g.top,0);g.owner.resume();
 assert.equal(g.top,200);assert.equal(g.owner.view().completion.outcome.kind,'watchdog-expired');g.owner.destroy();
});
test('moving target extends original bounded timeout and disposal writes no settlement',async()=>{
 const f=await fixture();f.owner.navigate(target,{motion:'smooth'});f.advance(500);f.rowTop=1000;f.owner.sync();
 assert.equal(f.owner.view().navigation.watchdogDeadlineMs,2500);f.advance(1500);assert.equal(f.owner.view().navigation.kind,'smooth');
 const count=f.settlements.length;f.owner.destroy();assert.equal(f.settlements.length,count);assert.equal(f.owner.view().completion.outcome.kind,'disposed');
});
test('cancelled pre-parking deadline cannot complete the resumed same-id owner',async()=>{
 const f=await fixture();const id=f.owner.navigate(target,{motion:'smooth'}),stale=[...f.deadlines.values()],staleFrames=[...f.frames.values()];
 f.owner.pause();f.advance(100);f.owner.resume();
 for(const job of stale)job.fn();for(const fn of staleFrames)fn(100);
 assert.equal(f.writes.length,0,'cancelled jobs cannot write after same-id resume');
 assert.equal(f.owner.view().navigation.navigationId,id);assert.equal(f.owner.view().navigation.kind,'smooth');f.owner.destroy();
});
test('bounded owner watchdog settles without waiting for a frame-clock pause signal',async()=>{
 const f=await fixture();f.owner.navigate(target,{motion:'smooth'});f.advance(2000);
 assert.equal(f.top,200);assert.equal(f.owner.view().completion.outcome.kind,'watchdog-expired');f.owner.destroy();
});
