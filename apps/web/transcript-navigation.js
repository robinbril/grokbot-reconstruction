import {navigationMotion,startNavigation,completeNavigation,retargetNavigation,selectNavigationMotion,navigationPace,createNavigationSpring,retargetNavigationSpring,stepNavigationSpring} from './transcript-navigation-state.js';

// The shared reader owns writes and semantic settlement; this module owns only paced navigation.
export function createTranscriptNavigation({environment,snapshot,write,settle,changed=()=>{},reducedMotion=()=>false}){
 let state={kind:'idle'},completion,spring,watchdog,sequence=0,paused=false,disposed=false;
 const view=()=>({navigation:{...state},completion});
 const publish=()=>changed(view());
 const live=()=>snapshot()?.viewport.scrollTopPx;
 function cancelSpringJobs(job){
  environment.cancelFrame(job.frame);environment.cancelDeadline(job.deadline);job.frameToken=undefined;job.deadlineToken=undefined;
 }
 function cancelSpring(){
  if(!spring)return;
  cancelSpringJobs(spring);spring=undefined;
 }
 function cancelWatchdog(){if(watchdog!==undefined)environment.cancelDeadline(watchdog.id);watchdog=undefined;}
 function finish(id,outcome,disposition='semantic-target',direction=0){
  const result=completeNavigation(state,{navigationId:id,outcome});if(result.kind==='stale')return false;
  const current=state,g=snapshot();let target;
  if(disposition==='semantic-target'&&g){const next=retargetNavigation({state:current,snapshot:g});if(next.kind==='retargeted')target=next.state.resolvedTarget.arrivalTarget;}
  if(!target&&disposition!=='none'&&g)target={kind:'offset',scrollTopPx:g.viewport.scrollTopPx,arrivalMode:{kind:'free',lastUserDirection:direction}};
  cancelWatchdog();state=result.state;cancelSpring();completion={navigationId:id,outcome};
  if(target)settle(target);publish();return true;
 }
 function armWatchdog(){
  cancelWatchdog();if(paused||state.kind!=='smooth')return;
  const id=state.navigationId,job={};watchdog=job;
  job.id=environment.deadline(()=>{if(watchdog===job&&state.navigationId===id&&!paused)finish(id,{kind:'watchdog-expired'});},Math.max(0,state.watchdogDeadlineMs-environment.now()));
 }
 function atClamp(target){
  return state.kind==='smooth'&&Math.abs(live()-target)>1&&finish(state.navigationId,{kind:'target-reached'});
 }
 function armFrameDeadline(job){
  environment.cancelDeadline(job.deadline);
  const token={};job.deadlineToken=token;
  job.deadline=environment.deadline(()=>{
   if(spring!==job||job.deadlineToken!==token||paused)return;
   if(environment.isFrameClockPaused?.()!==true){armFrameDeadline(job);return;}
   environment.cancelFrame(job.frame);spring=undefined;
   const landed=Math.abs(job.targetScrollTopPx-live())<1;
   if(!landed)write(job.targetScrollTopPx);
   if(!atClamp(job.targetScrollTopPx))sync();
  },250);
 }
 function schedule(job){
  const token={};job.frameToken=token;
  job.frame=environment.requestFrame(now=>{if(spring===job&&job.frameToken===token&&!paused)tick(job,now);});armFrameDeadline(job);
 }
 function tick(job,now){
  if(!snapshot()){pause();return;}
  const elapsed=Math.max(now-job.lastTickMs,0);job.lastTickMs=now;
  const observed=live();if(Math.abs(observed-job.landedPx)>1)job.positionPx=observed;
  const next=stepNavigationSpring(job,job.targetScrollTopPx,elapsed);Object.assign(job,next);
  if(Math.abs(job.targetScrollTopPx-job.positionPx)<1){
   environment.cancelDeadline(job.deadline);spring=undefined;write(job.targetScrollTopPx);
   if(!atClamp(job.targetScrollTopPx))sync();return;
  }
  write(job.positionPx);if(spring!==job)return;job.landedPx=live();schedule(job);
 }
 function sync(){
  if(paused||state.kind!=='smooth')return;
  const g=snapshot();if(!g)return;
  const next=retargetNavigation({state,snapshot:g});
  if(next.kind==='unresolved'){finish(state.navigationId,{kind:'target-unresolved'},'observed-offset');return;}
  const observed=g.viewport.scrollTopPx,target=next.state.resolvedTarget.targetScrollTopPx;
  if(spring&&Math.abs(target-observed)>Math.abs(spring.targetScrollTopPx-spring.positionPx)+1){
   next.state.watchdogDeadlineMs=Math.max(next.state.watchdogDeadlineMs,environment.now()+state.timeoutMs);
  }
  const deadlineChanged=next.state.watchdogDeadlineMs!==state.watchdogDeadlineMs;state=next.state;
  if(deadlineChanged)armWatchdog();
  if(Math.abs(observed-target)<=1){finish(state.navigationId,{kind:'target-reached'});return;}
  const pace={maxVelocityPxPerMs:navigationPace({distancePx:target-observed,remainingTravelMs:state.startedAtMs+800-environment.now()})};
  if(spring){retargetNavigationSpring(spring,{targetPx:target,pace});return;}
  spring=createNavigationSpring({targetScrollTopPx:target,startScrollTopPx:observed,nowMs:environment.now(),pace});schedule(spring);
 }
 function navigate(target,{motion='auto',origin='find-in-chat',timeoutMs=2000}={}){
  if(disposed)return null;const g=snapshot();if(!g)return null;
  const kind=motion==='instant'?'instant':target.kind==='row'?selectNavigationMotion(g,target.rowId,motion):motion==='smooth'?'smooth':'instant';
  const request={kind,target,origin,...kind==='smooth'?{watchdog:{kind:'bounded',timeoutMs}}:{}};
  const result=startNavigation({navigationId:sequence+1,motion:navigationMotion({request,reducedMotion:{kind:reducedMotion()?'reduce':'no-preference'}}),snapshot:g,startedAtMs:environment.now()});
  if(result.kind==='unresolved')return null;
  if(state.kind!=='idle')finish(state.navigationId,{kind:'replaced',replacementNavigationId:sequence+1},'none');
  sequence++;state={...result.state,timeoutMs};
  if(state.kind==='instant')finish(state.navigationId,{kind:state.reason==='reduced-motion'?'reduced-motion':'target-reached'});
  else if(Math.abs(live()-state.resolvedTarget.targetScrollTopPx)<=1)finish(state.navigationId,{kind:'target-reached'});
  else{publish();armWatchdog();sync();}return sequence;
 }
 function interrupt(direction=0){return state.kind!=='idle'&&finish(state.navigationId,{kind:'user-cancelled'},'observed-offset',direction);}
 function pause(){if(paused)return;paused=true;if(spring)cancelSpringJobs(spring);cancelWatchdog();}
 function resume(){if(!paused||disposed)return;paused=false;if(state.kind!=='smooth')return;
  if(environment.now()>=state.watchdogDeadlineMs){finish(state.navigationId,{kind:'watchdog-expired'});return;}
  const job=spring;armWatchdog();sync();if(job&&spring===job)schedule(job);
 }
 function disposeActive(){if(state.kind!=='idle')finish(state.navigationId,{kind:'disposed'},'none');cancelWatchdog();cancelSpring();}
 function destroy(){if(disposed)return;disposed=true;disposeActive();}
 return {navigate,sync,interrupt,pause,resume,disposeActive,destroy,view};
}
