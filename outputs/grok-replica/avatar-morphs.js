/* Independent numerical reconstruction of pinned 0.71.2 morph equations.
 * Input evidence is inert text; no shipped function, bootstrap or module runs here. */
export const MORPH_KINDS = Object.freeze({ thinking:'dots', orbit:'orbit', radar:'radar', progress:'progress', spawning:'gather', dictating:'wave', sending:'send', receiving:'receive', uploading:'dock', bouncing:'ball', writing:'pencil', alerting:'bang', 'powering-down':'standby' });
export const MORPH_CENTER = 114.2705;
const C=MORPH_CENTER, TAU=Math.PI*2, clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const cubicOut=t=>1-(1-t)**3, backOut=t=>1+2.70158*(t-1)**3+1.70158*(t-1)**2;
const cubicInOut=t=>t<.5?4*t*t*t:1-(-2*t+2)**3/2, smooth=t=>t*t*(3-2*t), wrap=t=>(t%1+1)%1;
const RADII={dots:22,orbit:19,radar:19,progress:19,gather:19,wave:16,send:20,receive:20,dock:20,ball:18,pencil:17,bang:13,standby:13};
const ZOOMS={dots:1.5,orbit:1.14,radar:1.14,progress:1.32,gather:1.15,wave:1.42,send:1.12,receive:1.12,dock:1.3,ball:1.22,pencil:1.18,bang:1.28,standby:1.75};
const randomFor=seed=>{let state=seed|0;return()=>{state=state+1831565813|0;let result=Math.imul(state^state>>>15,state|1);result^=result+Math.imul(result^result>>>7,result|61);return((result^result>>>14)>>>0)/4294967296;};};
const spring=value=>({value,velocity:0,target:value});
function stepSpring(state,frequency,dt){state.velocity+=(-2*frequency*state.velocity-frequency*frequency*(state.value-state.target))*dt;state.value+=state.velocity*dt;if(!Number.isFinite(state.value)||!Number.isFinite(state.velocity)){state.value=state.target;state.velocity=0;}}
export function createMorphDriver({seed=2654435769,isReducedMotion=false}={}){
 const amount=spring(0),swap=spring(1),spin=spring(0),random=randomFor(seed);
 let target=null,previousTarget=null,kind=null,outgoingKind=null,total=0,kindStart=0,shotStart=0,outgoingStart=0,outgoingShotStart=0,rest=false,restStart=0,active=false,spinTarget=0,spinDirection=1;
 function update(){
  const next=target===null?null:MORPH_KINDS[target],previousShotStart=shotStart;
  if(target!==previousTarget){previousTarget=target;if(target!==null){shotStart=total;rest=false;}}
  let nextActive=next!==null;
  if(target==='progress'||target==='spawning'){
   const duration=target==='progress'?2.5:2;
   if(!rest&&total-shotStart>duration){rest=true;restStart=total;}else if(rest&&total-restStart>1.5){rest=false;shotStart=total;}
   nextActive=!rest;
  }
  amount.target=nextActive?1:0;
  if(next!==null&&next!==kind){
   if(kind!==null&&amount.value>.02){outgoingKind=kind;outgoingStart=kindStart;outgoingShotStart=previousShotStart;swap.value=isReducedMotion?1:0;}else{outgoingKind=null;swap.value=1;}
   swap.velocity=0;swap.target=1;kind=next;kindStart=total;
  }
  if(next===null&&amount.value<.004){kind=null;outgoingKind=null;}
  if(swap.value>.996)outgoingKind=null;
  if(nextActive!==active){if(nextActive&&!isReducedMotion)spinDirection=random()<.5?1:-1;if(!isReducedMotion)spinTarget+=Math.PI*spinDirection;spin.target=spinTarget;active=nextActive;}
 }
 return{
  get target(){return target;},
  set(value){if(value!==null&&!Object.hasOwn(MORPH_KINDS,value))throw Error('Onbekende morphstatus');target=value;},
  advance(elapsed){const dt=isReducedMotion?0:Number.isFinite(elapsed)&&elapsed>0?Math.min(.1,elapsed):0;total+=dt;update();const steps=Math.max(1,Math.ceil(dt/(1/120)));for(let i=0;i<steps;i++){stepSpring(amount,14,dt/steps);stepSpring(swap,11,dt/steps);stepSpring(spin,14,dt/steps);}if(isReducedMotion)for(const state of[amount,swap,spin]){state.value=state.target;state.velocity=0;}},
  settle(){update();for(const state of[amount,swap,spin]){state.value=state.target;state.velocity=0;}update();},
  snapshot(){return{amount:clamp(amount.value),spin:spin.value,kind,outgoingKind,outgoing:outgoingKind,swap:clamp(swap.value),clock:{stateTime:total-kindStart,shotTime:total-shotStart},outgoingClock:{stateTime:total-outgoingStart,shotTime:total-outgoingShotStart},reducedMotion:isReducedMotion,isReducedMotion,isSettled:Math.abs(amount.value-amount.target)<.001&&Math.abs(spin.target-spin.value)<.01&&swap.value>.996};}
 };
}
const disc=(key,cx,cy,r,opacity)=>({type:'disc',key,cx,cy,r,opacity});
const ring=(key,r,width,opacity)=>({type:'ring',key,cx:C,cy:C,r,width,opacity});
function dotPulse(clock,index,amount,reduced){const phase=wrap(clock.stateTime/1.4+.119),distance=Math.abs(phase-index/3),nearest=Math.min(distance,1-distance),pulse=reduced?1:Math.exp(-(nearest*nearest)/(2*.15*.15));return{lift:reduced?0:pulse*9*amount,pop:reduced?1:.84+.22*pulse,tone:reduced?1:.5+.5*pulse};}
function pencilPose(ms){const phase=wrap(ms/2500);if(phase<.68){const t=phase/.68,s=t*t*(3-2*t),entry=clamp(t/.08)*clamp((1-t)/.08);return{x:-54+118*s,y:26,wig:Math.sin(t*24)*3.2*entry,rotation:17+Math.sin(ms*.0006)};}const t=cubicInOut((phase-.68)/.32);return{x:64-118*t,y:26-20*Math.sin(t*Math.PI),wig:0,rotation:17-2*Math.sin(t*Math.PI)+Math.sin(ms*.0006)};}
function bounce(time){const gravity=1082.2060353798126,start=Math.sqrt(80/gravity);if(time<start)return .5*gravity*time*time;const phase=wrap((time-start)/.62);return 40-208*phase*(1-phase);}
function capsulePath(width,height){const r=width/2,top=C-height/2+r,bottom=C+height/2-r;return`M${C-r} ${top}A${r} ${r} 0 0 1 ${C+r} ${top}L${C+r} ${bottom}A${r} ${r} 0 0 1 ${C-r} ${bottom}Z`;}
function bangPath(){const a=15,b=8.5,top=C-48,bottom=C+48;return`M${C-a} ${top+a}A${a} ${a} 0 0 1 ${C+a} ${top+a}L${C+b} ${bottom-b}A${b} ${b} 0 0 1 ${C-b} ${bottom-b}Z`;}
const inkPoint=ms=>{const p=pencilPose(ms);return[C+p.x,C+p.y+p.wig+19];};
const inkSamples=[];for(let ms=0;ms<1700;ms++){const point=inkPoint(ms),previous=inkSamples.at(-1);if(!previous||Math.hypot(point[0]-previous.point[0],point[1]-previous.point[1])>2.4)inkSamples.push({at:ms,point});}
function inkTrail(ms){const time=wrap(ms/2500)*2500,end=Math.min(time,1700),samples=inkSamples.filter(sample=>sample.at<=end),last=samples.at(-1)?.at??end,points=[...samples.map(sample=>sample.point),...(end>last?[inkPoint(end)]:[])].slice(-64);return time<1700?points:points.slice(Math.floor((time-1700)/1000*120));}
function curvePath(points){let path=`M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;if(points.length===2)return path+`L${points[1][0].toFixed(1)} ${points[1][1].toFixed(1)}`;for(let i=0;i<points.length-1;i++){const before=points[Math.max(0,i-1)],a=points[i],b=points[i+1],after=points[Math.min(points.length-1,i+2)];path+=`C${(a[0]+(b[0]-before[0])/6).toFixed(1)} ${(a[1]+(b[1]-before[1])/6).toFixed(1)} ${(b[0]-(after[0]-a[0])/6).toFixed(1)} ${(b[1]-(after[1]-a[1])/6).toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;}return path;}
function solveParts(kind,amount,clock,coreRadius,reduced){
 const alpha=cubicOut(amount),ms=clock.stateTime*1000,parts=[];
 switch(kind){
 case'dots':for(let i=0;i<2;i++){const entry=clamp((amount-i*.12)/(1-i*.12));if(entry>.004){const pulse=dotPulse(clock,i===0?0:2,amount,reduced);parts.push(disc(`dots.${i}`,C+(i?62:-62)*backOut(entry),C-pulse.lift,22*cubicOut(entry)*pulse.pop*1.02,cubicOut(entry)*pulse.tone));}}break;
 case'orbit':for(let i=0;i<5;i++){const angle=clock.stateTime*1.7+i*TAU/5,depth=Math.cos(angle),radius=52*backOut(amount);parts.push(disc(`orbit.${i}`,C+radius*Math.sin(angle),C-radius*.42*depth,Math.max(12*(.5+.5*clamp(depth))*alpha,.3),clamp((depth+.4)/.6,.18,1)*alpha));}break;
 case'radar':for(let i=0;i<3;i++){const phase=wrap(ms/1300+i/3);parts.push(ring(`radar.${i}`,coreRadius+(104-coreRadius)*phase,3.4*(1-phase*.55),alpha*(1-phase)*.9));}break;
 case'progress':{const fraction=clamp(clamp(clock.shotTime/2.5)/.85),radius=62*backOut(amount);parts.push(ring('progress.track',radius,5,alpha*.16));if(fraction>0)parts.push({...ring('progress.arc',radius,5,alpha),arc:{fraction,startDeg:-90}});break;}
 case'gather':for(let i=0;i<5;i++){const phase=clamp((clock.shotTime/2-i*.09)/.62);if(phase>=1)continue;const ease=cubicOut(phase),angle=i*2.4+phase*2.2,radius=96*(1-ease);parts.push(disc(`gather.${i}`,C+radius*Math.cos(angle),C+radius*Math.sin(angle)*.8,9*(.5+.5*ease)*alpha,alpha*clamp(phase*5)*(1-ease*.25)));}break;
 case'wave':for(const i of[-2,-1,1,2]){const entry=clamp((amount-Math.abs(i)*.1)/(1-Math.abs(i)*.1));if(entry<=.004)continue;const envelope=.42+.29*Math.sin(ms*.0021)*Math.sin(ms*.0034)+.29*Math.sin(ms*.0013+1.7),wave=envelope*(.55+.45*Math.sin(ms*.012-Math.abs(i)*1.05));parts.push(disc(`wave.${i}`,C+i*44*backOut(entry),C-6*clamp(wave)*entry,(7+9*clamp(wave,.08,1))*cubicOut(entry),entry));}break;
 case'send':{const phase=wrap(ms/1500),packet=clamp((phase-.18)/.55),travel=packet*packet*(.4+.6*packet);if(packet>0&&packet<1)parts.push(disc('send.packet',C+.74*108*travel,C-.62*108*travel,10*(1-travel*.55)*alpha,alpha*(1-travel*travel)));const streak=clamp((phase-.26)/.55),trail=streak*streak*(.4+.6*streak);if(packet>0&&streak>0&&streak<1)parts.push(disc('send.streak',C+.74*108*trail,C-.62*108*trail,5*(1-trail*.6)*alpha,alpha*.3*(1-trail)));const launch=clamp((phase-.18)/.3);if(launch>0&&launch<1)parts.push(ring('send.launch',20+34*cubicOut(launch),2.8*(1-launch),alpha*(1-launch)*.8));break;}
 case'receive':{const angle=-Math.PI*1.25+randomFor(Math.floor(ms/1700))()*Math.PI*1.5,phase=wrap(ms/1700),progress=clamp(phase/.6),ease=cubicOut(progress),radius=108*(1-ease),cos=Math.cos(angle),sin=Math.sin(angle);if(progress<1){const curve=18*Math.sin(progress*Math.PI)*(1-ease*.7);parts.push(disc('receive.packet',C+cos*radius-sin*curve,C+sin*radius+cos*curve,3.5+6.5*ease,alpha*clamp(progress*3.5)*(.3+.7*ease)));}const absorb=clamp((phase-.58)/.32);if(absorb>0&&absorb<1)parts.push(ring('receive.absorb',20+26*cubicOut(absorb),2.8*(1-absorb),alpha*(1-absorb)*.8));break;}
 case'dock':for(let i=0;i<2;i++){const progress=clamp((clock.stateTime-(.2+i*1.3))/.9);if(progress<=0)continue;const ease=cubicOut(progress),angle=clock.stateTime*1.1+i*Math.PI,tx=C+42*Math.sin(angle),ty=C+21*Math.cos(angle)+2*Math.sin(ms*.003+i),sx=C-120+i*30;parts.push(disc(`dock.${i}`,sx+(tx-sx)*ease,C+95+(ty-C-95)*ease,(7+3*ease)*alpha,alpha*clamp(progress*4)));}break;
 case'pencil':{const pose=pencilPose(ms),angle=(pose.rotation-90)*Math.PI/180,px=C+(pose.x+Math.cos(angle)*68)*amount,py=C+(pose.y+pose.wig*.15+Math.sin(angle)*68)*amount;parts.push({type:'path',key:'pencil.shaft',d:capsulePath(30,88),transform:`translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${(pose.rotation*amount).toFixed(1)}) scale(${cubicOut(amount).toFixed(3)}) translate(${-C} ${-C})`,opacity:clamp(amount*1.6-.3)});const trail=inkTrail(ms);if(trail.length>=2)parts.push({type:'stroke',key:'pencil.ink',d:curvePath(trail),width:6,opacity:clamp(amount*1.2)});break;}
 case'bang':{const entry=cubicOut(clamp(amount*1.1)),wobble=Math.sin(clock.stateTime*42)*2.2*Math.exp(-(clock.stateTime%2.2)*5.5);parts.push({type:'path',key:'bang.bar',d:bangPath(),transform:`translate(0 ${(-26-(1-entry)*70).toFixed(1)}) rotate(${wobble.toFixed(2)} ${C} ${(C-74).toFixed(1)}) translate(${C} ${C}) scale(${clamp(amount*1.2).toFixed(3)}) translate(${-C} ${-C})`,opacity:clamp(amount*1.5-.2)});break;}
 case'standby':{const pulse=.5+.5*Math.sin(clock.stateTime*1.6);parts.push(disc('standby.halo',C,C,26+7*pulse,alpha*(.06+.1*pulse)));break;}
 case'ball':break;
 }
 return parts;
}
// Rounded triangular pencil core: construct source quantized quadratic/cubic
// segments, flatten at <=4 units, normalize bounds, then 96 radial intersections.
function pencilCoreRing(){
 const round=n=>Math.round(n*100)/100,R=88,top=C-114,bottom=C+26,ratio=clamp(R/(bottom-top),-1,1),side=Math.sqrt(1-ratio*ratio),a=[C+R*side,bottom-R*ratio],b=[C-R*side,bottom-R*ratio],tip=[C,top];
 const unit=p=>{const length=Math.hypot(p[0]-tip[0],p[1]-tip[1]);return[(p[0]-tip[0])/length,(p[1]-tip[1])/length];},ua=unit(a),ub=unit(b),start=[round(C+ua[0]*18),round(top+ua[1]*18)],finish=[round(C+ub[0]*18),round(top+ub[1]*18)],segments=[{type:'Q',points:[[round(C),round(top)],finish]},{type:'L',points:[b.map(round)]}];
 const angle=Math.atan2(a[1]-bottom,a[0]-C),begin=Math.PI-angle,steps=Math.max(1,Math.ceil(Math.abs(angle-begin)/(Math.PI/2))),delta=(angle-begin)/steps,k=4/3*Math.tan(delta/4);
 for(let i=0;i<steps;i++){const s=begin+i*delta,e=s+delta,p=[C+R*Math.cos(s),bottom+R*Math.sin(s)],q=[C+R*Math.cos(e),bottom+R*Math.sin(e)];segments.push({type:'C',points:[[p[0]-k*R*Math.sin(s),p[1]+k*R*Math.cos(s)],[q[0]+k*R*Math.sin(e),q[1]-k*R*Math.cos(e)],q].map(point=>point.map(round))});}segments.push({type:'L',points:[start]});
 function flatten(origin,commands){let current=origin,points=[origin];for(const segment of commands){const chain=[current,...segment.points],length=chain.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-chain[i][0],p[1]-chain[i][1]),0),count=Math.max(2,Math.ceil(length/4));for(let i=1;i<=count;i++){const t=i/count,u=1-t;if(segment.type==='L')points.push([current[0]+(chain[1][0]-current[0])*t,current[1]+(chain[1][1]-current[1])*t]);else if(segment.type==='Q')points.push([u*u*chain[0][0]+2*u*t*chain[1][0]+t*t*chain[2][0],u*u*chain[0][1]+2*u*t*chain[1][1]+t*t*chain[2][1]]);else points.push([u**3*chain[0][0]+3*u*u*t*chain[1][0]+3*u*t*t*chain[2][0]+t**3*chain[3][0],u**3*chain[0][1]+3*u*u*t*chain[1][1]+3*u*t*t*chain[2][1]+t**3*chain[3][1]]);}current=chain.at(-1);}return points;}
 const raw=flatten(start,segments),xs=raw.map(p=>p[0]),ys=raw.map(p=>p[1]),dx=C-(Math.min(...xs)+Math.max(...xs))/2,dy=C-(Math.min(...ys)+Math.max(...ys))/2,scale=clamp(228.44/Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)),.9,1.35),convert=p=>[round(C+(p[0]+dx-C)*scale),round(C+(p[1]+dy-C)*scale)];
 const outline=flatten(convert(start),segments.map(segment=>({...segment,points:segment.points.map(convert)})));
 const radial=Array.from({length:96},(_,i)=>{const theta=i/96*TAU,x=Math.cos(theta),y=Math.sin(theta);let radius=0;for(let j=0;j<outline.length;j++){const a=outline[j],b=outline[(j+1)%outline.length],ax=a[0]-C,ay=a[1]-C,bx=b[0]-C,by=b[1]-C,det=(bx-ax)*y-(by-ay)*x;if(Math.abs(det)<1e-9)continue;const t=(ax*y-ay*x)/-det;if(t<0||t>1)continue;radius=Math.max(radius,(ax+(bx-ax)*t)*x+(ay+(by-ay)*t)*y);}return[C+x*radius,C+y*radius];});
 return radial.map((_,i)=>{const p=radial[(i+48)%96];return[C-(p[0]-C),C-(p[1]-C)];});
}
const CIRCLE=Array.from({length:96},(_,i)=>[C+Math.cos(i/96*TAU)*C,C+Math.sin(i/96*TAU)*C]),PENCIL_RING=pencilCoreRing();
export function solveMorphFrame(snapshot,size=120){
 const amount=clamp(snapshot.amount),swap=clamp(snapshot.swap),kind=snapshot.kind,outgoing=swap<.999?(snapshot.outgoingKind??snapshot.outgoing):null,reduced=snapshot.reducedMotion??snapshot.isReducedMotion;
 const weight=name=>name===kind?amount*swap:name===outgoing?amount*(1-swap):0,clock=name=>name===kind?snapshot.clock:snapshot.outgoingClock;
 const radius=kind?RADII[kind]*swap+(outgoing?RADII[outgoing]:RADII[kind])*(1-swap):19,dots=weight('dots'),pulse=kind==='dots'||outgoing==='dots'?dotPulse(clock('dots'),1,amount,reduced):{lift:0,pop:1,tone:1};
 let pop=1+(pulse.pop-1)*(dots/Math.max(amount,.001)),dx=0,dy=0,rotation=0;
 const receive=weight('receive');if(receive>.004){const phase=wrap(clock('receive').stateTime/1.7),t=clamp((phase-.58)/.34);pop*=1+.11*Math.sin(t*Math.PI)*receive;}
 const send=weight('send');if(send>.004){const phase=wrap(clock('send').stateTime/1.5),anticipation=phase<.18?-.06*Math.sin(phase/.18*Math.PI):0,release=phase>=.18&&phase<.42?.05*Math.sin((phase-.18)/.24*Math.PI):0;pop*=1+(anticipation+release)*send;}
 const bang=weight('bang');if(bang>.004){pop*=1+.04*Math.exp(-(clock('bang').stateTime%2.2)*5.5)*bang;dy+=58*bang;}
 const pencil=weight('pencil');if(pencil>.004){const pose=pencilPose(clock('pencil').stateTime*1000);dx+=pose.x*pencil;dy+=(pose.y+pose.wig*.5)*pencil;rotation+=pose.rotation*pencil;}
 const ball=weight('ball');if(ball>.004)dy+=bounce(clock('ball').stateTime)*ball;
 const standby=weight('standby'),dim=standby>0?(.28+.2*Math.sin(clock('standby').stateTime*1.6))*standby:0;
 const baseRing=type=>type==='pencil'?PENCIL_RING:CIRCLE,blend=cubicInOut(swap),shapeRing=kind==='pencil'||outgoing==='pencil'?baseRing(kind).map((p,i)=>[baseRing(outgoing)[i][0]+(p[0]-baseRing(outgoing)[i][0])*blend,baseRing(outgoing)[i][1]+(p[1]-baseRing(outgoing)[i][1])*blend]):CIRCLE;
 const core={scale:1-amount+radius/C*pop*amount,dx:dx*amount,dy:-pulse.lift*dots+dy*amount,rotation:rotation*amount,opacity:(1-(1-pulse.tone)*dots)*(1-dim),round:cubicInOut(clamp(amount/.62)),ring:shapeRing};
 const boost=1-smooth(clamp((size-44)/90)),incomingZoom=kind?ZOOMS[kind]:1,outgoingZoom=outgoing?ZOOMS[outgoing]:incomingZoom,zoom=1+(incomingZoom*swap+outgoingZoom*(1-swap)-1)*amount*boost,parts=[];
 for(const type of[outgoing,kind])if(type&&weight(type)>.004)parts.push(...solveParts(type,weight(type),clock(type),radius,reduced));
 return{core,isFaceVisible:amount<.5,zoom,parts:parts.filter(part=>part.opacity>0)};
}
const pathPattern=/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/,transformPattern=/^(?:(?:translate|rotate|scale)\([-+0-9.eE\s,]+\)\s*)*$/;
const number=value=>{if(!Number.isFinite(value))throw Error('Ongeldige morphcoördinaat');return String(value);};
export function renderMorphParts(parts){
 return parts.map(part=>{
  if(!/^[a-zA-Z0-9.-]+$/.test(part.key))throw Error('Ongeldige morphsleutel');
  const opacity=number(clamp(part.opacity)),common=`data-morph-part="${part.key}" opacity="${opacity}"`;
  if(part.type==='disc')return`<circle ${common} cx="${number(part.cx)}" cy="${number(part.cy)}" r="${number(Math.max(0,part.r))}"/>`;
  if(part.type==='ring'){const circumference=TAU*part.r,arc=part.arc?` stroke-dasharray="${number(circumference*clamp(part.arc.fraction))} ${number(circumference)}" transform="rotate(${number(part.arc.startDeg)} ${number(part.cx)} ${number(part.cy)})"`:'';return`<circle ${common} cx="${number(part.cx)}" cy="${number(part.cy)}" r="${number(Math.max(0,part.r))}" fill="none" stroke="currentColor" stroke-width="${number(part.width)}"${arc}/>`;}
  if((part.type==='path'||part.type==='stroke')&&typeof part.d==='string'&&pathPattern.test(part.d)&&!/NaN|Infinity/i.test(part.d)){
   const transform=part.transform||'';if(!transformPattern.test(transform)||/NaN|Infinity/i.test(transform))throw Error('Ongeldige morphtransformatie');
   return`<path ${common} d="${part.d}"${transform?` transform="${transform}"`:''}${part.type==='stroke'?` fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${number(part.width)}"`:''}/>`;
  }
  throw Error('Ongeldig morphpad');
 }).join('');
}
// Compose core geometry into the replica's 100-unit projected avatar viewport.
export function morphAvatarGeometry(frame,morph){
 const coordinates=frame.body.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)?.map(Number)||[],outline=[];
 for(let i=0;i<coordinates.length;i+=2)outline.push([coordinates[i],coordinates[i+1]]);
 const core=morph.core,factor=46/C*(frame.zoom||1),angle=core.rotation*Math.PI/180;
 const transform=([x,y])=>{const px=(x-50)*core.scale,py=(y-50)*core.scale;return[50+(px*Math.cos(angle)-py*Math.sin(angle)+core.dx*factor)*morph.zoom,50+(px*Math.sin(angle)+py*Math.cos(angle)+core.dy*factor)*morph.zoom];};
 const points=core.ring.map((point,index)=>{
  const angle=index/96*TAU,dx=Math.cos(angle),dy=Math.sin(angle);let radius=0;
  for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length],ax=a[0]-50,ay=a[1]-50,ex=b[0]-a[0],ey=b[1]-a[1],det=dx*ey-dy*ex;if(Math.abs(det)<1e-9)continue;const distance=(ax*ey-ay*ex)/det,t=(ax*dy-ay*dx)/det;if(t>=0&&t<=1&&distance>radius)radius=distance;}
  const base=[50+dx*radius,50+dy*radius],target=[50+(point[0]-C)*factor,50+(point[1]-C)*factor];
  return transform([base[0]+(target[0]-base[0])*core.round,base[1]+(target[1]-base[1])*core.round]);
 });
 const path=points=>'M'+points.map(point=>`${point[0].toFixed(3)} ${point[1].toFixed(3)}`).join('L')+'Z';
 const eyes=morph.isFaceVisible?frame.eyes.map(eye=>{const numbers=eye.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)?.map(Number)||[],points=[];for(let i=0;i<numbers.length;i+=2)points.push(transform([numbers[i],numbers[i+1]]));return points.length?path(points):'';}):['',''];
 return{...frame,body:path(points),eyes,morph};
}
