import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const evidence=JSON.parse(fs.readFileSync(new URL('./fixtures/source-reference/transcript-navigation.json',import.meta.url)));
const ids=['W_','U_','Yn','jp','K_','X_','qp','Y_','Xd','Z_','Q_','Yd','motion-selector','navigation-spring-helpers'];
const native=vm.createContext({});
vm.runInContext(ids.map(id=>evidence.records.find(record=>record.id===id).excerpt).join('\n'),native);
const value=code=>JSON.parse(JSON.stringify(vm.runInContext(code,native)));
const snapshot={totalSizePx:2000,viewport:{scrollTopPx:200,viewportHeightPx:400},rows:[{heightPx:100},{heightPx:100}],indexOf:id=>({a:0,b:1}[id]),offsetOf:id=>({a:300,b:1000}[id])};
vm.runInContext('const snap={totalSizePx:2000,viewport:{scrollTopPx:200,viewportHeightPx:400},rows:[{heightPx:100},{heightPx:100}],indexOf:id=>({a:0,b:1}[id]),offsetOf:id=>({a:300,b:1000}[id])};',native);

test('replica matches extracted native resolution, motion, lifecycle and spring helpers',async()=>{
 const api=await import('../transcript-navigation-state.js');
 for(const id of ['a','b','missing'])assert.equal(api.selectNavigationMotion(snapshot,id),value(`iYe(snap,${JSON.stringify(id)})`));
 for(const align of ['start','center','end','nearest']){
  const target={kind:'row',rowId:'a',align,offsetPx:17};
  assert.deepEqual(api.resolveNavigationTarget({snapshot,target}),value(`U_({snapshot:snap,target:${JSON.stringify(target)}})`));
 }
 const request={kind:'smooth',target:{kind:'row',rowId:'a',align:'center',offsetPx:0},origin:'find-in-chat',watchdog:{kind:'bounded',timeoutMs:2000}};
 assert.deepEqual(api.navigationMotion({request,reducedMotion:{kind:'reduce'}}),value(`W_({request:${JSON.stringify(request)},reducedMotion:{kind:'reduce'}})`));
 const state=api.startNavigation({navigationId:3,motion:request,snapshot,startedAtMs:100}).state;
 assert.equal(state.watchdogDeadlineMs,2100);
 assert.equal(api.completeNavigation(state,{navigationId:2,outcome:{kind:'target-reached'}}).kind,'stale');
 assert.equal(api.retargetNavigation({state,snapshot:{...snapshot,indexOf:()=>undefined}}).kind,'unresolved');
 for(const distancePx of [-4000,-1,0,100,4000])for(const remainingTravelMs of [-1,250,800]){
  const pace={distancePx,remainingTravelMs};assert.equal(api.navigationPace(pace),value(`rC(${JSON.stringify(pace)})`));
 }
 for(const positionPx of [-100,0,99.8,100,200])for(const velocityPxPerMs of [-8,0,8])for(const elapsed of [0,1,16,40,400]){
  const spring={positionPx,velocityPxPerMs,maxVelocityPxPerMs:4.2};
  assert.deepEqual(api.stepNavigationSpring(spring,100,elapsed),value(`lC(${JSON.stringify(spring)},100,${elapsed})`));
 }
});
