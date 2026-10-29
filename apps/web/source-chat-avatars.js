// Exact shipped 0.75.5 engine, loaded only by the explicit synthetic reference.
const MODULE='./assets/vendor/grok-0755/index.eager-common-F4Y1-gMW.js';
const COLORS={'#a57137':'brown','#ff293f':'red','#ff8c1a':'orange','#ffcf24':'yellow','#38b76b':'green','#35b6cd':'cyan','#1680f3':'blue','#9354ff':'violet','#e458b3':'magenta','#949494':'gray'};
let modulePromise,instanceSequence=0;
const load=()=>modulePromise??=import(MODULE);
function paletteColor(module,node,sleeping){
 const tokens=module.v(module.b.light);
 if(sleeping)return tokens['--sand-text-tertiary'];
 const color=node.dataset.color?.toLowerCase(),name=COLORS[color];
 return name?tokens[`--sand-bg-${name}-bright`]??color:color??'#000000';
}
function sourceOptions(module,node,size,sleeping){
 const paused=sleeping||node.dataset.static==='true'||matchMedia('(prefers-reduced-motion: reduce)').matches;
 return {id:`source-reference-${++instanceSequence}`,seed:String(node.dataset.motionSeed||node.dataset.body||'blob'),
  body:module.T(node.dataset.body||'blob'),appearance:module.E(paletteColor(module,node,sleeping)),
  size,fill:module.j,resolution:192,state:sleeping?'sleeping':node.dataset.motionState||'idle',
  isFollowingPointer:!paused,isPlaying:!paused};
}
function replaceAvatar(module,node){
 const sleeping=Boolean(node.closest('[data-stage="asleep"]'));
 const size=sleeping?32:parseFloat(getComputedStyle(node).width);
 if(!Number.isFinite(size)||size<=0)return null;
 const host=node.cloneNode(false);host.classList.remove('motion-avatar');
 host.classList.add('source-native-avatar');host.dataset.originalAvatar='0.75.5';
 host.dataset.originalAvatarState=sleeping?'sleeping':'idle';
 const canvas=document.createElement('span');canvas.className='source-native-avatar-canvas';
 const extent=`${module.M(module.j)*100}%`;canvas.style.width=extent;canvas.style.height=extent;host.append(canvas);
 const engine=module.w(sourceOptions(module,node,size,sleeping));
 node.replaceWith(host);const detach=engine.attach({host,canvas});
 if(sleeping){engine.gaze([0,0]);engine.setExpression('sleepy');}
 const timer=sleeping?setTimeout(()=>{if(host.isConnected){engine.gaze([0,0]);engine.setExpression('sleepy');}},450):null;
 return {host,dispose(){if(timer!==null)clearTimeout(timer);detach();}};
}
const GLYPHS={plus:'\uea60',mic:'\uec12',close:'\ued82',waveform:'\uf48c',share:'\uec25'};
function replaceGlyphs(shell){
 for(const node of shell.querySelectorAll('.icon[data-icon-semantic]')){
  const name=node.dataset.iconSemantic,glyph=GLYPHS[name];if(!glyph)continue;
  const replacement=node.cloneNode(false);replacement.removeAttribute('data-icon-semantic');
  replacement.classList.add('source-native-glyph');replacement.dataset.originalIcon=name;
  replacement.textContent=glyph;node.replaceWith(replacement);
 }
}
export function createSourceChatAvatars(){
 const instances=new Map();let generation=0,observer;
 const prune=()=>{for(const [host,instance]of instances)if(!host.isConnected){instance.dispose();instances.delete(host);}};
 function clear(){generation++;for(const instance of instances.values())instance.dispose();instances.clear();observer?.disconnect();observer=null;}
 async function mount(shell){
  const current=++generation;
  if(location.hash!=='#reference-chat'||!shell?.hasAttribute('data-reference-chat')){clear();return;}
  try{
   const module=await load();
   if(current!==generation||!shell.isConnected||location.hash!=='#reference-chat')return;
   prune();replaceGlyphs(shell);
   for(const node of shell.querySelectorAll('.avatar.motion-avatar')){
    const instance=replaceAvatar(module,node);if(instance)instances.set(instance.host,instance);
   }
   if(!observer){observer=new MutationObserver(prune);observer.observe(document.body,{childList:true,subtree:true});}
   shell.dataset.originalAvatarEngine='0.75.5';
  }catch{if(shell.isConnected)shell.dataset.originalAvatarError='unavailable';}
 }
 window.addEventListener('pagehide',clear,{once:true});
 return {mount,clear};
}
