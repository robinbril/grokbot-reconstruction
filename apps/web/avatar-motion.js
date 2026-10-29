/* Independent local avatar runtime. No shipped JS is imported or evaluated. */
import { createMorphDriver, solveMorphFrame, renderMorphParts, morphAvatarGeometry, MORPH_CENTER } from './avatar-morphs.js';
import { AVATAR_DATA } from './avatar-data.js';
import { CANONICAL_SHAPES, PUBLIC_SHAPES, REST_ROTATION, clamp, gazeAlpha, gazePose, pointerGaze, sampleTrack, renderAvatarFrame, cubicEase } from './avatar-math.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const controllers=new Map();let data=null,dataPromise=null,raf=0,lastFrame=0,observer=null,intersection=null,started=false;
export function loadMotionData(){
 if(!dataPromise)dataPromise=fetch(new URL('./assets/avatar-motion-data.json',import.meta.url)).then(response=>{if(!response.ok)throw Error('Bewegingsgegevens laden mislukt');return response.json();}).then(result=>{data=result.data;for(const controller of controllers.values())controller.dataReady();return data;}).catch(error=>{dataPromise=null;for(const controller of controllers.values())controller.element.dataset.motionError='data-unavailable';throw error;});
 return dataPromise;
}
const now=()=>performance.now();
function wake(){if(!raf&&!document.hidden&&[...controllers.values()].some(c=>c.needsFrame())){lastFrame=now();raf=requestAnimationFrame(tick);}}
function tick(timestamp){raf=0;const dt=(timestamp-lastFrame)/1000;if(dt<1/30-.001){raf=requestAnimationFrame(tick);return;}lastFrame=timestamp;for(const c of controllers.values())if(c.needsFrame())c.advance(dt);if([...controllers.values()].some(c=>c.needsFrame())&&!document.hidden)raf=requestAnimationFrame(tick);}
function seedFor(text){let value=2166136261;for(const character of text)value=Math.imul(value^character.charCodeAt(0),16777619);return value>>>0;}
function randomFor(seed){let state=seed|0;return()=>{state=(state+1831565813)|0;let n=Math.imul(state^(state>>>15),state|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
function resolvedInk(color){const palette=AVATAR_DATA.themeColors||{},selection=AVATAR_DATA.selectionColors||{};let name=Object.keys(selection).find(key=>String(selection[key]).toLowerCase()===String(color).toLowerCase());if(!name){const old=['#000000','#a57137','#ff293f','#ff8c1a','#ffcf24','#38b76b','#35b6cd','#1680f3','#9354ff','#e458b3','#949494'];name=['black','brown','red','orange','yellow','green','cyan','blue','violet','magenta','gray'][old.indexOf(String(color).toLowerCase())];}const dark=document.documentElement.dataset.theme==='dark'||document.documentElement.classList.contains('dark');return palette[name]?.[dark?'dark':'light']||color||'#000000';}
const neutralCache=new Map();
// Native tracks use On=.6; this SVG projection already includes fill=.92.
// KN's Yr(fill)=fill/On therefore requires raw track zoom / On here.
const SOURCE_BASE_ZOOM=.6;
export function avatarMarkup(agent={},extra=''){
 if(agent.photo&&/^data:image\//.test(agent.photo))return`<span class="avatar photo-avatar ${escape(extra)}" aria-hidden="true"><img src="${escape(agent.photo)}" alt=""></span>`;
 const shape=PUBLIC_SHAPES.includes(agent.shape)?agent.shape:CANONICAL_SHAPES[Number(agent.shape)||0]||'blob',color=/^#[0-9a-f]{3,8}$/i.test(agent.color||'')?agent.color:'#000000';
 const staticPose=extra.includes('static'),cacheKey=shape+(staticPose?'-rest':'');let frame=neutralCache.get(cacheKey);if(!frame){frame=renderAvatarFrame({shape,rotation:staticPose?REST_ROTATION:[0,0,0]});neutralCache.set(cacheKey,frame);}
 const pointer=agent.pointerMode||'auto';
 return `<span class="avatar motion-avatar ${escape(extra)}" data-body="${shape}" data-motion-state="${escape(agent.motionState||'idle')}" data-pointer="${staticPose?'none':pointer}" data-static="${staticPose}" data-color="${escape(color)}" data-motion-seed="${escape(agent.id||agent.name||shape)}" aria-hidden="true"><svg class="avatar-geometry" viewBox="0 0 100 100"><path data-avatar-body d="${frame.body+frame.eyes.join('')}" fill="${resolvedInk(color)}" fill-rule="evenodd"/><path data-avatar-eye="0" d="${frame.eyes[0]}" fill="none"/><path data-avatar-eye="1" d="${frame.eyes[1]}" fill="none"/><g data-avatar-morphs></g></svg></span>`;
}
const aliases={thinking:'sad',strange:'inspecting',angry:'neutral',inspect:'inspecting',squint:'squinted',idle:'neutral',smile:'happy',sleep:'sleepy'};
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
function blinkAt(time,start,duration=.26){const phase=(time-start)/duration;if(phase<0||phase>=1)return 0;const hold=Math.min(.28,(2/60)/Math.max(duration,.05)),a=(1-hold)*.42,b=a+hold;return phase<a?smooth(phase/a):phase<=b?1:1-smooth((phase-b)/(1-b));}
class AvatarController{
 constructor(element){
  this.element=element;this.body=element.querySelector('[data-avatar-body]');this.eyeNodes=[...element.querySelectorAll('[data-avatar-eye]')];this.frameCount=0;this.time=0;this.stateElapsed=0;this.loopCount=0;this.shape=element.dataset.body;this.motionState=element.dataset.motionState||'idle';this.isStatic=element.dataset.static==='true';this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.playing=!this.isStatic&&!this.reduced;this.visible=true;this.target=null;this.gaze=[0,0];this.hold=0;this.clip=null;this.manual=false;this.bags=new Map();this.random=randomFor(seedFor(element.dataset.motionSeed||this.shape));const sourcePointer=element.dataset.pointer,backedPlacement=Boolean(element.closest('.agent-row,.identity-avatar,.context-avatar'));this.pointerEnabled=sourcePointer!=='none'&&(sourcePointer!=='auto'||backedPlacement);this.pointerMode=sourcePointer==='global'?'global':'local';this.cleanups=[];
  this.pointerTarget=element.closest('[data-pointer-stage],.agent-row,.identity-avatar,.context-avatar')||element;
  this.morphDriver=createMorphDriver({seed:seedFor(element.dataset.motionSeed||this.shape),isReducedMotion:this.reduced});this.morphRotation=null;this.morphParts=element.querySelector('[data-avatar-morphs]');this.pointerCleanups=[];this.bindPointer();
  this.dataReady();this.draw();intersection?.observe(element);
 }
 bindPointer(){
  this.pointerCleanups.forEach(cleanup=>cleanup());this.pointerCleanups=[];
  const move=event=>{if(!this.pointerEnabled||this.reduced||this.isStatic)return;const rect=this.element.getBoundingClientRect();const point=pointerGaze(rect,event.clientX,event.clientY,this.pointerMode==='global'?2:.5);if(this.hold===0)this.gaze=[...point];this.target=point;wake();};
  const release=()=>{this.target=null;wake();},target=this.pointerMode==='global'?window:this.pointerTarget;
  target.addEventListener('pointermove',move,{passive:true});this.pointerCleanups.push(()=>target.removeEventListener('pointermove',move));
  if(this.pointerMode==='local'){target.addEventListener('pointerleave',release,{passive:true});this.pointerCleanups.push(()=>target.removeEventListener('pointerleave',release));}
 }
 setPointerMode(mode){if(!['local','global'].includes(mode)||this.pointerMode===mode)return;this.pointerMode=mode;this.target=null;this.bindPointer();this.updateMetadata();wake();}
 dataReady(){if(data&&!this.clip){this.selectStateClip();this.syncMorph();if(!this.reduced&&!this.isStatic&&this.clip)this.time=this.random()*this.clip.duration;}wake();}
 chooseFromBag(names){let bag=this.bags.get(names);if(!bag?.length){bag=[...names];for(let i=bag.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}const different=bag.findIndex(name=>name!==this.clip?.name);if(different>0)[bag[0],bag[different]]=[bag[different],bag[0]];this.bags.set(names,bag);}return bag.shift();}
 selectStateClip(){const definition=data?.states[this.motionState];if(!definition)return;const compact=this.element.getBoundingClientRect().width<48,names=compact&&definition.compactClips?definition.compactClips:definition.clips;const sequential=definition.next&&!definition.holdSeconds;const name=sequential?names[Math.min(this.loopCount,names.length-1)]:this.chooseFromBag(names);this.clip=data.clips.find(clip=>clip.name===name)||null;}
 syncMorph(){this.morphDriver.set(this.manual||this.isStatic?null:data?.states[this.motionState]?.morph||null);this.morphDriver.advance(0);if(this.reduced)this.morphDriver.settle();}
 needsFrame(){return this.element.isConnected&&this.visible&&!this.reduced&&!this.isStatic&&(this.playing||this.hold!==(this.target?1:0)||Boolean(this.target&&(this.gaze[0]!==this.target[0]||this.gaze[1]!==this.target[1])));}
 updateMetadata(){for(const target of [this.element,this.element.closest('[data-testid="motion-preview"]')].filter(Boolean)){target.dataset.playing=String(this.playing&&!this.reduced&&!this.isStatic);target.dataset.reducedMotion=String(this.reduced);target.dataset.frameCount=String(this.frameCount);target.dataset.clipTime=String(this.time);target.dataset.clip=this.clip?.name||'';target.dataset.body=this.shape;target.dataset.motionState=this.motionState;target.dataset.pointerMode=this.pointerMode;target.dataset.morphKind=this.morphDriver.snapshot().kind||'';target.dataset.morphAmount=String(this.morphDriver.snapshot().amount);target.dataset.morphOutgoing=this.morphDriver.snapshot().outgoingKind||'';}}
 advance(elapsed){
  if(this.reduced||this.isStatic||document.hidden||!this.visible)return;
  const dt=clamp(elapsed,0,.1),alpha=gazeAlpha(dt),approach=(a,b)=>Math.abs(b-(a+(b-a)*alpha))<.001?b:a+(b-a)*alpha;
  this.hold=approach(this.hold,this.target?1:0);if(this.target)this.gaze=this.gaze.map((v,i)=>approach(v,this.target[i]));
  if(this.playing)this.morphDriver.advance(dt);
  if(this.playing&&this.clip){this.time+=dt*(1-this.morphDriver.snapshot().amount);this.stateElapsed+=dt;const definition=data?.states[this.motionState];if(!this.manual&&definition?.next&&definition.holdSeconds&&this.stateElapsed>=definition.holdSeconds){this.setState(definition.next);return;}if(this.time>=this.clip.duration){this.time%=this.clip.duration;this.loopCount++;if(!this.manual){if(definition?.next&&!definition.holdSeconds&&this.loopCount>=definition.clips.length){this.setState(definition.next);return;}this.selectStateClip();}}}
  this.draw();
 }
 frame(){
  if(this.isStatic)return renderAvatarFrame({shape:this.shape,rotation:REST_ROTATION});
  const tracks=this.clip?.tracks||{},position=sampleTrack(tracks.position,this.time,[0,0]),rotation=sampleTrack(tracks.rotation,this.time,[0,0,0]),squash=sampleTrack(tracks.squash,this.time,[1,1]),rawZoom=sampleTrack(tracks.scale||tracks.zoom,this.time,[SOURCE_BASE_ZOOM])[0],zoom=clamp(rawZoom,.25,2.5)/SOURCE_BASE_ZOOM;
  const gaze=gazePose(this.shape,this.gaze[0],this.gaze[1],this.playing);for(let i=0;i<3;i++){const base=rotation[i]||0;rotation[i]=this.playing?base+gaze.rotation[i]*this.hold:base+(gaze.rotation[i]-base)*this.hold;}for(let i=0;i<2;i++){const base=position[i]||0;position[i]=this.playing?base+gaze.offset[i]*this.hold:base+(gaze.offset[i]-base)*this.hold;}
  const heldFace=!this.manual&&data?.states[this.motionState]?.face;let expression='neutral',fromExpression=null,expressionMix=1,expressionPath='direct',blink=0,lidMorph=0,eyeScaleY=1;
  for(const event of tracks.expression||[]){
   if(event.v==='blink'){blink=Math.max(blink,blinkAt(this.time,event.t));continue;}
   if(event.t>this.time)continue;
   const next=aliases[event.v]||event.v;if(next===expression)continue;fromExpression=expression;expression=next;
   const elapsed=this.time-event.t,throughBlink=event.cut===false&&!['sad','happy','confused','squinted','sleepy'].includes(expression)&&!['sad','happy','confused','squinted','sleepy'].includes(fromExpression);
   expressionPath=throughBlink?'lid-morph':'expression-morph';
   if(throughBlink){const phase=clamp(elapsed/.35,0,1),hold=Math.min(.28,(4.25/60)/.35),a=(1-hold)*.42,b=a+hold;if(phase<a){expression=fromExpression;expressionMix=1;lidMorph=smooth(phase/a);}else if(phase<=b){expressionMix=1;lidMorph=1;}else{const t=(phase-b)/(1-b),opening=t<.7?(1-(1-t/.7)**2)*1.06:1.06+(1-1.06)*smooth((t-.7)/.3);expressionMix=1;lidMorph=Math.max(0,1-opening);eyeScaleY=Math.max(1,opening);}}
   else expressionMix=cubicEase(clamp(elapsed/.28,0,1),[.4,.06,.18,1]);
  }
  if(heldFace){expression=heldFace;fromExpression=null;expressionMix=1;}
  const lids=Math.max(blink,lidMorph,sampleTrack(tracks.lids,this.time,[0])[0]||0);

  const morphSnapshot=this.morphDriver.snapshot(),amount=morphSnapshot.amount;
  if(amount>0||!morphSnapshot.isSettled){if(!this.morphRotation)this.morphRotation=[...rotation];for(let i=0;i<3;i++)rotation[i]=this.morphRotation[i]+(rotation[i]-this.morphRotation[i])*(1-amount);rotation[1]+=morphSnapshot.spin*180/Math.PI;for(let i=0;i<2;i++){position[i]*=1-amount;squash[i]=1+(squash[i]-1)*(1-amount);}}else this.morphRotation=null;
  const frame=renderAvatarFrame({shape:this.shape,rotation,offset:position,squash,squashAnchor:this.clip?.squashAnchor||0,zoom,expression,lids,fromExpression,expressionMix,expressionPath,eyeScaleY});
  return morphSnapshot.kind===null&&morphSnapshot.isSettled?frame:morphAvatarGeometry(frame,solveMorphFrame(morphSnapshot,this.element.getBoundingClientRect().width));
 }
 draw(){
  if(!this.element.isConnected)return;const frame=this.frame();this.lastSnapshot=frame;this.body.setAttribute('d',frame.body+frame.eyes.join(''));const ink=resolvedInk(this.element.dataset.color);this.body.setAttribute('fill',ink);this.body.setAttribute('opacity',String(frame.morph?.core.opacity??1));this.element.style.color=ink;if(this.morphParts){this.morphParts.innerHTML=frame.morph?renderMorphParts(frame.morph.parts):'';const factor=46/MORPH_CENTER*(frame.morph?.zoom||1)*(frame.zoom||1);this.morphParts.setAttribute('transform',`translate(50 50) scale(${factor}) translate(${-MORPH_CENTER} ${-MORPH_CENTER})`);this.morphParts.setAttribute('fill',ink);}this.eyeNodes.forEach((node,i)=>node.setAttribute('d',frame.eyes[i]||''));this.frameCount++;this.updateMetadata();this.element.dispatchEvent(new CustomEvent('avatarframe',{detail:frame}));
 }
 setShape(shape){if(PUBLIC_SHAPES.includes(shape)){this.shape=shape;this.draw();wake();}}
 setClip(name){const clip=data?.clips.find(item=>item.name===name);if(clip){this.manual=true;this.clip=clip;this.time=0;this.syncMorph();this.morphDriver.settle();this.draw();wake();}}
 setState(state){if(!data?.states[state])return;this.motionState=state;this.manual=false;this.time=0;this.loopCount=0;this.stateElapsed=0;this.selectStateClip();this.syncMorph();this.draw();wake();}
 play(){if(!this.reduced&&!this.isStatic){this.playing=true;this.updateMetadata();wake();}}
 pause(){this.playing=false;this.updateMetadata();wake();}
 reset(){this.playing=false;this.time=0;this.motionState='idle';this.manual=true;this.target=null;this.gaze=[0,0];this.hold=0;this.morphDriver=createMorphDriver({seed:seedFor(this.element.dataset.motionSeed||this.shape),isReducedMotion:this.reduced});this.syncMorph();this.morphDriver.settle();this.morphRotation=null;this.draw();wake();}
 setPointer(enabled){this.pointerEnabled=Boolean(enabled);if(!enabled)this.target=null;wake();}
 snapshot(){return{...this.lastSnapshot,time:this.time,clip:this.clip?.name||null,playing:this.playing,reducedMotion:this.reduced,frameCount:this.frameCount,gaze:[...this.gaze],hold:this.hold,pointerMode:this.pointerMode};}
 dispose(){this.cleanups.forEach(cleanup=>cleanup());this.pointerCleanups.forEach(cleanup=>cleanup());intersection?.unobserve(this.element);controllers.delete(this.element);this.target=null;}
}
export function hydrateAvatars(root=document){
 for(const [element,controller]of controllers)if(!element.isConnected)controller.dispose();
 for(const element of root.querySelectorAll('.motion-avatar'))if(!controllers.has(element))controllers.set(element,new AvatarController(element));
 wake();
}
export function controllerFor(element){if(!element)return null;const avatar=element.matches('.motion-avatar')?element:element.querySelector('.motion-avatar');if(!avatar)return null;if(!controllers.has(avatar))controllers.set(avatar,new AvatarController(avatar));return controllers.get(avatar);}
export function motionDiagnostics(){return{controllers:controllers.size,active:[...controllers.values()].filter(c=>c.needsFrame()).length,rafPending:Boolean(raf),hidden:document.hidden,sourceVersion:'0.71.2',frameRate:30,clipCount:data?.clips.length||0,geometryParity:'independent-projection-unverified-raster'};}
export function startAvatarMotion(){
 if(started)return;started=true;
 intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const entry of entries){const c=controllers.get(entry.target);if(c)c.visible=entry.isIntersecting;}wake();}):null;
 observer=new MutationObserver(()=>hydrateAvatars());observer.observe(document.body,{childList:true,subtree:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else wake();});
 new MutationObserver(()=>{for(const c of controllers.values())c.draw();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class']});
 hydrateAvatars();loadMotionData().catch(()=>{});
}
