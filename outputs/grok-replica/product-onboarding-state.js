import { LOGO_FLIGHT_SPRING, ONBOARDING_SLOW, ONBOARDING_BOUNCE } from './product-workspace-motion.js';
// Independent declarative port of inert Fn/Qn/ea/sa/Xa/Ka/De constants, 0.71.2.
export const MEET_TEXT='Geef elke taak uit handen aan je team van Bots';
export const GRAPHEMES=[...new Intl.Segmenter('nl',{granularity:'grapheme'}).segment(MEET_TEXT)].map(x=>x.segment);
export const STEPS=['meet','computer-demo','jobs','role','hand-off'];
export const CLOCKS=Object.freeze({meet:35,vigil:3000,demo:900,jobs:800,handOff:500,stepExit:200});
export const DEMO=[{x:-78.3,y:-62.3,pressed:null},{x:-78.3,y:-62.3,pressed:'a-tile-2'},{x:62.8,y:-62.3,pressed:null},{x:62.8,y:-62.3,pressed:'a-tile-4'},{x:-178.4,y:-105.5,pressed:null},{x:-178.4,y:-105.5,pressed:'a-close'},{x:77.4,y:71.8,pressed:null},{x:77.4,y:71.8,pressed:'b-button'}];
export const JOBS=[{id:'invoice-chaser',name:'Factuurjager',color:'red',x:0,y:-112},{id:'weekly-standup',name:'Wekelijkse stand-up',color:'cyan',x:-132,y:27},{id:'sales-forecast',name:'Verkoopprognose',color:'blue',x:138,y:7}];
const OUTER={'invoice-chaser':{x:-172,y:-328,scale:.4},'weekly-standup':{x:-278,y:-255,scale:.45},'sales-forecast':{x:246,y:-275,scale:.5}};
export const BOBS={'invoice-chaser':{amplitudePx:3,periodMs:5200,delayMs:-1200},'weekly-standup':{amplitudePx:5,periodMs:7300,delayMs:-4700},'sales-forecast':{amplitudePx:4,periodMs:6400,delayMs:-2600}};
export const TRANSITIONS={standard:{duration:531,easing:LOGO_FLIGHT_SPRING},slow:ONBOARDING_SLOW,bounce:ONBOARDING_BOUNCE,exit:{duration:300,easing:'cubic-bezier(0.4, 0, 1, 1)'},none:{duration:0,easing:'linear'}};
export function initialScene(reduced=false){return {step:'meet',meetTick:reduced?GRAPHEMES.length+60:0,vigil:0,demoBeat:reduced?7:-1,jobsBeat:reduced?2:0,handOffBeat:reduced?4:0,role:null,createColor:'blue',createShape:'blob',avatarTarget:null,isAvatarLanded:false,reduced};}
export function meetPhase(scene,active=scene.step==='meet'&&!scene.reduced){const tick=active?scene.meetTick:GRAPHEMES.length+60,typedCount=Math.min(Math.max(-1,tick-20),GRAPHEMES.length),isSent=tick>=GRAPHEMES.length+40,isThinking=tick>=GRAPHEMES.length+60;return {typedCount,isSent,isThinking,sendState:isSent?(active?'pressing':'sent'):'pending',meetBeat:isThinking?(scene.vigil%2===0?2:3):tick>=12?1:0};}
export function actorsFor(scene){const phase=meetPhase(scene),hidden={x:0,y:-20,scale:.3,opacity:0},hero={id:'hero',color:'black',shape:'blob',recolor:null,isGazing:false,bob:null,state:'idle',transition:'none',...hidden};
 if(scene.step==='landing')Object.assign(hero,{y:-75});
 else if(scene.step==='meet')Object.assign(hero,{x:0,y:-75,scale:.8,opacity:1,state:phase.meetBeat===2?'thinking':phase.meetBeat===3||phase.meetBeat===0?'idle':'listening',transition:'bounce',isGazing:true});
 else if(scene.step==='computer-demo'){const cursor=DEMO[scene.demoBeat]||{x:0,y:30};Object.assign(hero,{x:cursor.x-(-59.8*.55),y:-21+cursor.y-(-58.6*.55),scale:.55,opacity:1,state:scene.demoBeat<0?'thinking':'working',transition:'slow',surfaceTheme:'light'});}
 else if(scene.step==='jobs')Object.assign(hero,{x:0,y:-20,scale:scene.jobsBeat<1?1:1.2,opacity:scene.jobsBeat<1?1:0,state:scene.jobsBeat===0?'excited':scene.jobsBeat<1?'happy':'celebrate',transition:scene.jobsBeat<1?'standard':'exit',isGazing:scene.jobsBeat<1});
 const partners=JOBS.map(job=>{const item={id:job.id,color:job.color,shape:'blob',recolor:null,isGazing:false,bob:null,state:'sleeping',transition:'none',...hidden},slot={x:job.x,y:job.y},outer=OUTER[job.id];
  if(scene.step==='jobs'&&scene.jobsBeat>=1)Object.assign(item,slot,{scale:1,opacity:1,state:scene.jobsBeat===1?'excited':'happy',transition:'bounce',isGazing:true});
  else if(['role','tools'].includes(scene.step))Object.assign(item,outer,{opacity:1,state:'idle',transition:'standard',bob:BOBS[job.id]});
  else if(scene.step==='create'){if(job.id!=='sales-forecast')Object.assign(item,{x:outer.x,y:outer.y-40,scale:outer.scale*.8,opacity:0,transition:'exit'});else{const target=scene.avatarTarget;Object.assign(item,target?{x:target.x,y:target.y,scale:target.sizePx/80}:outer,{color:scene.createColor,shape:scene.createShape,opacity:scene.isAvatarLanded?0:1,state:'happy',transition:scene.isAvatarLanded?'none':'standard'});}}
  else if(scene.step==='hand-off'){if(scene.handOffBeat>=0)Object.assign(item,slot,{scale:job.id==='invoice-chaser'?1:.8,opacity:job.id==='invoice-chaser'?1:0,state:job.id==='invoice-chaser'?'happy':'sleeping',recolor:job.id==='invoice-chaser'?'black':null,transition:job.id==='invoice-chaser'?'standard':'exit',isGazing:job.id==='invoice-chaser'});}
  return item;});return [hero,...partners].map(p=>({...p,duration:scene.reduced?0:TRANSITIONS[p.transition].duration,easing:TRANSITIONS[p.transition].easing}));
}
