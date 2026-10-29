/* Independent procedural geometry. Parameters/literal contours come from pinned static
 * evidence; the mesh sampling and radial silhouette renderer are our own implementation.
 * This is genuine 3D projection, not a claim of parity with the shipped voxel rasterizer. */
import { AVATAR_DATA } from './avatar-data.js';
export const PUBLIC_SHAPES = ['blob','pebble','bean','egg','squircle','tablet','capsule','cylinder','hex','gem','crystal','wedge','shield','dome','arch','cloud','teardrop','leaf','square','sparkle','clover','flower','heart','house','star'];
// Independently derived from the two inert polyhedral eye anchors; cross-checked
// against the literal first frame of Idle_D in the pinned clip table.
export const REST_ROTATION = Object.freeze([-15.8962710432949,33.29315635042976,25.384801274601624]);
export const CANONICAL_SHAPES = ['blob','cloud','square','sparkle','clover','heart','flower','teardrop','tablet','wedge','house','star','hex'];
export const clamp = (v, min = -1, max = 1) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : 0));
const TAU = Math.PI * 2, RAD = Math.PI / 180;
export const gazeAlpha = dt => 1 - Math.pow(1 - .14, clamp(dt, 0, .1) / (1 / 60));
export function pointerGaze(rect, x, y, radiusMultiplier = 2) {
 const radius = Math.max(rect.width, 1) * radiusMultiplier;
 return [clamp((x - rect.left - rect.width / 2) / radius), clamp(-(y - rect.top - rect.height / 2) / radius)];
}
export function gazePose(shape, x, y, playing = false) {
 const sphere = shape === 'blob' || shape === 'sphere', factor = ['heart','heartChubby'].includes(shape) ? .6 : shape === 'wedge' ? .55 : 1, weight = playing ? .55 : 1;
 return { rotation: [-(sphere ? 14 : 19) * factor * y * weight, (sphere ? 18 : 26) * factor * x * weight, 0], offset: [(sphere ? .03 : .07) * x * weight, (sphere ? .024 : .055) * y * weight] };
}
export function cubicEase(x, ease = [.42, 0, .58, 1]) {
 const [a,b,c,d] = ease, curve = (t,p,q) => 3*(1-t)*(1-t)*t*p+3*(1-t)*t*t*q+t*t*t;
 let t = clamp(x, 0, 1);
 for (let i=0;i<8;i++) { const error=curve(t,a,c)-x, derivative=3*(1-t)*(1-t)*a+6*(1-t)*t*(c-a)+3*t*t*(1-c); if(Math.abs(error)<1e-6||Math.abs(derivative)<1e-6)break;t=clamp(t-error/derivative,0,1); }
 return curve(t,b,d);
}
export function sampleTrack(track, time, fallback = []) {
 if (!track?.length) return [...fallback];
 if (time <= track[0].t) return [...track[0].v];
 if (time >= track.at(-1).t) return [...track.at(-1).v];
 let index=0;while(index<track.length-2 && track[index+1].t<=time)index++;
 const from=track[index],to=track[index+1],t=cubicEase((time-from.t)/Math.max(to.t-from.t,1e-9),from.ease);
 return from.v.map((v,i)=>v+(to.v[i]-v)*t);
}
export function rotatePoint([x,y,z], [pitch=0,yaw=0,roll=0] = []) {
 const a=pitch*RAD,b=yaw*RAD,c=roll*RAD;
 const py=y*Math.cos(a)-z*Math.sin(a),pz=y*Math.sin(a)+z*Math.cos(a);
 const px=x*Math.cos(b)+pz*Math.sin(b),qz=-x*Math.sin(b)+pz*Math.cos(b);
 return [px*Math.cos(c)-py*Math.sin(c),px*Math.sin(c)+py*Math.cos(c),qz];
}
const parametric = (fn,count=96) => Array.from({length:count},(_,i)=>fn(i/count*TAU));
const lerp=(a,b,t)=>a+(b-a)*t;
function roundedPolygon(vertices, radius) {
 const out=[];
 for(let i=0;i<vertices.length;i++){
  const p=vertices[(i+vertices.length-1)%vertices.length],v=vertices[i],n=vertices[(i+1)%vertices.length],r=Array.isArray(radius)?radius[i]:radius;
  const plen=Math.hypot(p[0]-v[0],p[1]-v[1]),nlen=Math.hypot(n[0]-v[0],n[1]-v[1]),d=Math.min(r,plen*.48,nlen*.48);
  const a=[v[0]+(p[0]-v[0])*d/plen,v[1]+(p[1]-v[1])*d/plen],b=[v[0]+(n[0]-v[0])*d/nlen,v[1]+(n[1]-v[1])*d/nlen];
  for(let j=0;j<10;j++){const t=j/9,u=1-t;out.push([u*u*a[0]+2*u*t*v[0]+t*t*b[0],u*u*a[1]+2*u*t*v[1]+t*t*b[1]]);}
 }
 return out;
}
function circleUnion(balls,count=120){return parametric(a=>{const dx=Math.cos(a),dy=Math.sin(a);let best=0;for(const [x,y,r]of balls){const dot=dx*x+dy*y,disc=dot*dot-x*x-y*y+r*r;if(disc>0)best=Math.max(best,dot+Math.sqrt(disc));}return[best*dx,best*dy];},count);}
// Literal path sampler for our inert contour assets. It intentionally supports only M/L/C/Q/Z.
function pathPoints(path){
 const tokens=path.match(/[MLCQZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)||[];let index=0,command='',position=[0,0];const out=[];
 const take=()=>Number(tokens[index++]);
 while(index<tokens.length){if(/^[a-z]$/i.test(tokens[index]))command=tokens[index++].toUpperCase();if(command==='Z')break;
  if(command==='M'||command==='L'){position=[take(),take()];out.push(position);if(command==='M')command='L';}
  else if(command==='C'){const a=[take(),take()],b=[take(),take()],end=[take(),take()],start=position;for(let j=1;j<=10;j++){const t=j/10,u=1-t;out.push([u*u*u*start[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t*t*t*end[0],u*u*u*start[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t*t*t*end[1]]);}position=end;}
  else if(command==='Q'){const a=[take(),take()],end=[take(),take()],start=position;for(let j=1;j<=10;j++){const t=j/10,u=1-t;out.push([u*u*start[0]+2*u*t*a[0]+t*t*end[0],u*u*start[1]+2*u*t*a[1]+t*t*end[1]]);}position=end;}
  else break;
 }
 return out;
}
function normalizeOutline(points){
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),scale=clamp(228.44/Math.max(x1-x0,y1-y0),.9,1.35);
 return points.map(([x,y])=>[(x-(x0+x1)/2)*scale/114.2705,-(y-(y0+y1)/2)*scale/114.2705]);
}
function rawOutline(shape){
 switch(shape){
 case 'pebble':return parametric(t=>{const r=108*(1+.075*(.6*Math.sin(2*t+1.1)+.4*Math.sin(3*t-1.1)));return[r*Math.cos(t),.98*r*Math.sin(t)];});
 case 'bean':return parametric(t=>{const bump=a=>{const d=Math.abs(((t-a+Math.PI)%TAU+TAU)%TAU-Math.PI);return Math.exp(-d*d/.4232);},r=1-.34*bump(Math.PI)+.34*.34*bump(2*Math.PI);return[94*Math.cos(t)*r,112*Math.sin(t)*r];});
 case 'egg':return parametric(t=>[98*Math.cos(t)*(1-.22*((1-Math.sin(t))/2)**2),113*Math.sin(t)]);
 case 'gem':case 'squircle':{const n=shape==='gem'?1.5:3.2,x=shape==='gem'?112:107,y=shape==='gem'?113:107;return parametric(t=>[Math.sign(Math.cos(t))*Math.abs(Math.cos(t))**(2/n)*x,Math.sign(Math.sin(t))*Math.abs(Math.sin(t))**(2/n)*y]);}
 case 'square':return roundedPolygon([[-107,-107],[107,-107],[107,107],[-107,107]],28);
 case 'house':return roundedPolygon([[-100,110],[100,110],[100,-32],[0,-110],[-100,-32]],29);
 case 'hex':return roundedPolygon(Array.from({length:6},(_,i)=>[114*Math.cos(Math.PI/6+i*TAU/6),114*Math.sin(Math.PI/6+i*TAU/6)]),20);
 case 'wedge':return roundedPolygon([[0,-130],[112.5833,65],[-112.5833,65]],[80,60,60]);
 case 'tablet':return parametric(t=>[Math.cos(t)*74+Math.sign(Math.cos(t))*40,Math.sin(t)*74]);
 case 'capsule':return parametric(t=>[Math.cos(t)*72,Math.sin(t)*72+Math.sign(Math.sin(t))*41]);
 case 'cylinder':return parametric(t=>[94*Math.cos(t),48*Math.sin(t)+Math.sign(Math.sin(t))*62]);
 case 'leaf':return parametric(t=>[88*Math.cos(t)*Math.max(1-Math.sin(t)**2,0)**.25,113*Math.sin(t)]);
 case 'cloud':return circleUnion([[-62,26,56],[62,26,54],[0,34,62],[-24,-30,62],[38,-26,54]]);
 case 'clover':return circleUnion([[-38,-38,58],[38,-38,58],[38,38,58],[-38,38,58]]);
 case 'heart':return pathPoints(AVATAR_DATA.contours.heart);
 case 'sparkle':return pathPoints(AVATAR_DATA.contours.sparkle);
 case 'star':return pathPoints(AVATAR_DATA.contours.star);
 case 'flower':return circleUnion([[0,0,.36],...Array.from({length:6},(_,i)=>[.58*Math.cos(-Math.PI/2+i*TAU/6),.58*Math.sin(-Math.PI/2+i*TAU/6),.33])]).map(([x,y])=>[x*114.2705,y*114.2705]);
 case 'dome':{const top=Array.from({length:65},(_,i)=>{const t=Math.PI+i/64*Math.PI;return[114*Math.cos(t),56+138*Math.sin(t)];});return [...top,...pathPoints('M114 56C114 82 114 82 88 82L-88 82C-114 82 -114 82 -114 56Z')];}
 case 'arch':{const upper=Array.from({length:49},(_,i)=>{const t=Math.PI+i/48*Math.PI;return[76*Math.cos(t),-37+76*Math.sin(t)];});return [...upper,[76,71],[68,104],[34,113],[-34,113],[-68,104],[-76,71]];}
 case 'shield':return pathPoints('M-98 -78C-98 -110 -49 -118 0 -118C49 -118 98 -110 98 -78C98 45.36 60.76 108 0 108C-60.76 108 -98 45.36 -98 -78Z');
 case 'teardrop':{const radius=88,height=140,k=radius/height,h=Math.sqrt(1-k*k),a=[radius*h,height-radius*k],b=[-radius*h,height-radius*k],corner=roundedPolygon([a,[0,0],b],[0,48,0]).slice(10,20),angle=Math.atan2(a[1]-height,a[0]),arc=Array.from({length:97},(_,i)=>{const t=lerp(Math.PI-angle,angle,i/96);return[radius*Math.cos(t),height+radius*Math.sin(t)];});return[...corner,b,...arc,a];}
 case 'crystal':return [[0,-114],[73,-54],[73,54],[0,114],[-73,54],[-73,-54]];
 default:return parametric(t=>[114*Math.cos(t),114*Math.sin(t)]);
 }
}
const geometryCache=new Map();
const INTERNAL={heart:'heartChubby',flower:'starFlower',star:'star6',blob:'sphere'};
function verticalSpan(outline,y){const hits=[];for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length];if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y))hits.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));}return hits.length?[Math.min(...hits),Math.max(...hits)]:[0,0];}
function inscribedBalls(outline){
 const xs=outline.map(p=>p[0]),ys=outline.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),step=Math.max(x1-x0,y1-y0)/40,candidates=[];
 for(let y=y0+step/2;y<y1;y+=step)for(let x=x0+step/2;x<x1;x+=step){let inside=false;for(let i=0,j=outline.length-1;i<outline.length;j=i++){const a=outline[i],b=outline[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(!inside)continue;const r=Math.min(...outline.map(p=>Math.hypot(p[0]-x,p[1]-y)));if(r>step)candidates.push([x,y,0,r]);}
 candidates.sort((a,b)=>b[3]-a[3]);const kept=[];for(const ball of candidates)if(!kept.some(other=>Math.hypot(ball[0]-other[0],ball[1]-other[1])+ball[3]<=other[3]+step*.25))kept.push(ball);return kept;
}
function ballsSilhouette(balls,rotate){const projected=balls.map(([x,y,z,r])=>[...rotate([x,y,z]),r]);return parametric(angle=>{const dx=Math.cos(angle),dy=Math.sin(angle);let radius=0;for(const[x,y,,r]of projected){const dot=dx*x+dy*y,disc=dot*dot-x*x-y*y+r*r;if(disc>=0)radius=Math.max(radius,dot+Math.sqrt(disc));}return[dx*radius,dy*radius];},120);}
function meshFor(shape){
 if(geometryCache.has(shape))return geometryCache.get(shape);
 const outline=normalizeOutline(rawOutline(shape)),rings=[],balls=shape==='bean'?inscribedBalls(outline):null,revolved=new Set(['pebble','egg','cylinder','gem','wedge','shield','dome','arch','teardrop','leaf','capsule']);
 if(shape==='crystal'){
  const centers=[[0,1.04,0],[0,-1.04,0]];for(const sign of[-1,1])for(let i=0;i<6;i++){const a=i/6*TAU;centers.push([.52*Math.cos(a),sign*.51,.52*Math.sin(a)]);}
  for(const[cx,cy,cz]of centers)for(let latitude=0;latitude<=8;latitude++){const a=latitude/8*Math.PI;rings.push(parametric(t=>[cx+.12*Math.sin(a)*Math.sin(t),cy+.12*Math.cos(a),cz+.12*Math.sin(a)*Math.cos(t)],24));}
 }else if(revolved.has(shape)){
  const ymin=Math.min(...outline.map(p=>p[1])),ymax=Math.max(...outline.map(p=>p[1]));
  for(let k=0;k<=24;k++){const y=lerp(ymin+.00001,ymax-.00001,(1-Math.cos(k/24*Math.PI))/2),span=verticalSpan(outline,y),r=Math.max(.0001,(span[1]-span[0])/2);rings.push(parametric(t=>[Math.cos(t)*r,y,Math.sin(t)*r],64));}
 }else if(shape==='tablet'){
  for(let k=0;k<=24;k++){const x=lerp(-1,1,k/24),r=Math.sqrt(Math.max(0,.65**2-Math.max(0,Math.abs(x)-.35)**2));rings.push(parametric(t=>[x,r*Math.cos(t),r*Math.sin(t)],64));}
 }else{
  const loft=shape==='heart'||shape==='cloud',depth=shape==='heart'?.62:shape==='cloud'?.72:shape==='star'?.3:shape==='squircle'?.28:.36,bevel=shape==='star'?.18:shape==='squircle'?.11:.22;
  if(loft){for(let k=0;k<=18;k++){const theta=-Math.PI/2+k/18*Math.PI,z=depth*Math.sin(theta),scale=Math.pow(Math.max(0,Math.cos(theta)),.72);rings.push(outline.map(([x,y])=>[x*scale,y*scale,z]));}}
  else{const half=Math.max(.0001,Math.min((Math.max(...outline.map(p=>p[0]))-Math.min(...outline.map(p=>p[0])))/2,(Math.max(...outline.map(p=>p[1]))-Math.min(...outline.map(p=>p[1])))/2));for(const side of[-1,1])for(let k=0;k<=4;k++){const angle=k/4*Math.PI/2,z=side*(depth-bevel+bevel*Math.sin(angle)),scale=1-bevel/half*(1-Math.cos(angle));rings.push(outline.map(([x,y])=>[x*scale,y*scale,z]));}}

 }
 const recipe={outline,rings,balls,internal:INTERNAL[shape]||shape,revolved};geometryCache.set(shape,recipe);return recipe;
}
function pathFrom(points){return points.length?'M'+points.map(([x,y])=>`${x.toFixed(3)} ${y.toFixed(3)}`).join('L')+'Z':'';}
// Union's farthest ray/edge intersections retain concave star-shaped outlines. A convex
// hull would erase the heart notch, flower petals and clover bays and is not used here.
function silhouette(rings,project){
 const loops=rings.map(r=>r.map(project)),edges=[];
 for(let k=0;k<loops.length;k++)for(let i=0;i<loops[k].length;i++){edges.push([loops[k][i],loops[k][(i+1)%loops[k].length]]);if(k)edges.push([loops[k-1][Math.min(i,loops[k-1].length-1)],loops[k][i]]);}
 return parametric(angle=>{const dx=Math.cos(angle),dy=Math.sin(angle);let radius=0;for(const[a,b]of edges){const ex=b[0]-a[0],ey=b[1]-a[1],det=dx*ey-dy*ex;if(Math.abs(det)<1e-9)continue;const r=(a[0]*ey-a[1]*ex)/det,u=(a[0]*dy-a[1]*dx)/det;if(r>radius&&u>=-1e-6&&u<=1+1e-6)radius=r;}return[dx*radius,dy*radius];},120);
}
function capsuleLoop(width,height,tilt=0,cx=0,cy=0){const r=width/2,h=Math.max(0,height/2-r);return parametric(t=>{const x=r*Math.cos(t),y=r*Math.sin(t)+Math.sign(Math.sin(t))*h,a=tilt*RAD;return[cx+x*Math.cos(a)-y*Math.sin(a),cy+x*Math.sin(a)+y*Math.cos(a)];},56);}
function faceLoop(expression,width,height,side){
 switch(expression){
 case 'surprised':return capsuleLoop(width*.42/.26,height*.86/.57);
 case 'sad':return capsuleLoop(width,height*.5/.57,-28*side,-.05,0);
 case 'squinted':return capsuleLoop(width,height*.5/.57,90,.01,0);
 case 'calm':return parametric(t=>[Math.cos(t)*width*.296/.26,Math.sin(t)*height*.247/.57]);
 case 'inspecting':{const s=side<0?.54:.36;return capsuleLoop(width*s/.26,height*s/.57,0,.04,0);}
 case 'happy':return curvedEye(width,height,[[-.16,-.04],[0,.12],[.16,-.04]],.03);
 case 'sleepy':return curvedEye(width,height,[[-.11,.025],[0,-.05],[.11,.025]],.01);
 case 'confused':return curvedEye(width,height,[[.01,.16],[-.17,0],[.01,-.16]],-.1);
 default:return capsuleLoop(width,height);
 }
}
function curvedEye(width,height,spine,shift){const center=[],normals=[];for(let i=0;i<=24;i++){const t=i/24,u=1-t;center.push([(u*u*spine[0][0]+2*u*t*spine[1][0]+t*t*spine[2][0]+shift)*width/.26,(u*u*spine[0][1]+2*u*t*spine[1][1]+t*t*spine[2][1])*height/.57]);const dx=2*u*(spine[1][0]-spine[0][0])+2*t*(spine[2][0]-spine[1][0]),dy=2*u*(spine[1][1]-spine[0][1])+2*t*(spine[2][1]-spine[1][1]),length=Math.hypot(dx,dy)||1;normals.push([-dy/length,dx/length]);}const radius=width*.30;return [...center.map((p,i)=>[p[0]+normals[i][0]*radius,p[1]+normals[i][1]*radius]),...center.map((p,i)=>[p[0]-normals[i][0]*radius,p[1]-normals[i][1]*radius]).reverse()];}
export function renderAvatarFrame({shape='blob',rotation=[0,0,0],offset=[0,0],squash=[1,1],squashAnchor=0,zoom=1,expression='neutral',lids=0,fromExpression=null,expressionMix=1,expressionPath='direct',eyeScaleY=1}={}){
 if(!PUBLIC_SHAPES.includes(shape))shape='blob';
 const recipe=meshFor(shape),sphere=shape==='blob',internal=recipe.internal,seat=AVATAR_DATA.eyeSeats[internal]||{width:.26,height:.57,gap:.58,shiftY:0};
 const rotate=p=>rotatePoint(p,rotation),scale=46*clamp(zoom,.25,2.5),toSVG=([x,y])=>[50+(x*squash[0]+offset[0])*scale,50-(y*squash[1]+offset[1]+squashAnchor*(1-squash[1]))*scale];
 const bodyPoints=sphere?parametric(a=>[Math.cos(a),Math.sin(a)],120):recipe.balls?ballsSilhouette(recipe.balls,rotate):silhouette(recipe.rings,p=>rotate(p));
 const eyes=[-1,1].map(side=>{
  let loop=faceLoop(expression,seat.width,seat.height,side);
  if(fromExpression&&fromExpression!==expression){const previous=faceLoop(fromExpression,seat.width,seat.height,side),count=Math.max(previous.length,loop.length),sample=(points,i)=>{const f=i/count*points.length,k=Math.floor(f),t=f-k;return[lerp(points[k%points.length][0],points[(k+1)%points.length][0],t),lerp(points[k%points.length][1],points[(k+1)%points.length][1],t)];};loop=Array.from({length:count},(_,i)=>{const a=sample(previous,i),b=sample(loop,i);return[lerp(a[0],b[0],expressionMix),lerp(a[1],b[1],expressionMix)];});}
  const points=[];
  for(const [lx,ly]of loop){let x=side*seat.gap/2+lx,y=ly*Math.max(.025,1-clamp(lids,0,1))*Math.max(0,eyeScaleY)-seat.shiftY,z=.36;
   if(sphere){x=side*.30+lx;y=ly*Math.max(.025,1-clamp(lids,0,1))*Math.max(0,eyeScaleY)+.14;z=Math.sqrt(Math.max(.02,1-x*x-y*y));}
   else if(recipe.balls){z=0;for(const[cx,cy,cz,r]of recipe.balls){const disc=r*r-(x-cx)**2-(y-cy)**2;if(disc>0)z=Math.max(z,cz+Math.sqrt(disc));}}
   else if(recipe.revolved.has(shape)){const span=verticalSpan(recipe.outline,clamp(y,-.98,.98)),radius=Math.max(.12,(span[1]-span[0])/2),angle=clamp(x/radius,-2.6,2.6);x=radius*Math.sin(angle);z=radius*Math.cos(angle);}
   else if(shape==='tablet'){const radius=Math.sqrt(Math.max(.02,.65**2-Math.max(0,Math.abs(x)-.35)**2)),angle=y/.65;y=radius*Math.sin(angle);z=radius*Math.cos(angle);}
   else if(shape==='cloud'||shape==='heart'){const depth=shape==='cloud'?.72:.62;z=depth*Math.sqrt(Math.max(.02,1-x*x-y*y));}
   else if(shape==='squircle')z=.28;else if(shape==='star')z=.3;else if(shape==='crystal')z=.64*Math.sqrt(3)/2;
   const point=rotate([x,y,z]);if(point[2]>-.02)points.push(toSVG(point));
  }
  return pathFrom(points);
 });
 return{shape,body:pathFrom(bodyPoints.map(toSVG)),eyes,rotation:[...rotation],offset:[...offset],squash:[...squash],squashAnchor,zoom,expression,lids,fromExpression,expressionMix,expressionPath,eyeScaleY};
}
