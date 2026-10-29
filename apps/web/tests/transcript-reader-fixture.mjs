class Element extends EventTarget {
 constructor(doc,tag='DIV'){super();this.ownerDocument=doc;this.tagName=tag;this.isContentEditable=false;this.isConnected=true;this.attributes={};}
 closest(selector){if(selector==='input, textarea, select')return ['INPUT','TEXTAREA','SELECT'].includes(this.tagName)?this:null;if(selector==='button')return this.tagName==='BUTTON'?this:null;if(selector==='[contenteditable]')return this.attributes.contenteditable===undefined?null:this;return null;}
 getAttribute(name){return this.attributes[name]??null;}
}
export function fixture(){
 let now=0,nextId=0,key='first';const frames=new Map(),deadlines=new Map(),observers=[];
 const doc=new EventTarget();doc.defaultView={HTMLElement:Element};
 class Transcript extends Element {
  constructor(){super(doc);this.clientWidth=800;this.clientHeight=500;this.top=0;this.height=2000;this.writes=[];this.smooth=[];this.rows=Array.from({length:10},(_,i)=>{const node=new Element(doc);node.dataset={messageId:'r'+i};node.offset=i*200;node.height=200;node.getBoundingClientRect=()=>({top:100+node.offset-this.top,bottom:100+node.offset-this.top+node.height,height:node.height});return node;});}
  get scrollHeight(){return this.height;}
  get scrollTop(){return this.top;}
  set scrollTop(value){this.top=Math.max(0,Math.min(value,this.height-this.clientHeight));this.writes.push(value);if(this.echo)this.dispatchEvent(new Event('scroll'));}
  getBoundingClientRect(){return {top:100,bottom:100+this.clientHeight,height:this.clientHeight};}
  querySelectorAll(){return this.rows;}
  scrollTo({top,behavior}){this.smooth.push({top,behavior});if(behavior!=='smooth')this.scrollTop=top;}
 }
 let transcript=new Transcript();const app={querySelector:selector=>selector==='.transcript'?transcript:null};
 const environment={now:()=>now,requestFrame:fn=>{const id=++nextId;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id),deadline:(fn,ms)=>{const id=++nextId;deadlines.set(id,{fn,at:now+ms});return id;},cancelDeadline:id=>deadlines.delete(id),resize:fn=>{const observed=new Set();const observer={observed,observe:node=>observed.add(node),unobserve:node=>observed.delete(node),disconnect:()=>observed.clear(),fire:()=>fn([])};observers.push(observer);return observer;}};
 function flush(){for(let turns=0;frames.size;turns++){if(turns>100)throw Error('Unbounded owned frame loop');const pending=[...frames];frames.clear();for(const[,fn]of pending)fn(now);}}
 function advance(ms){now+=ms;for(let turns=0;turns<100;turns++){const due=[...deadlines].filter(([,job])=>job.at<=now).sort((a,b)=>a[1].at-b[1].at);if(!due.length)return;for(const[id,job]of due){if(!deadlines.delete(id))continue;job.fn();}}throw Error('Unbounded owned deadline loop');}
 function event(name,properties={},target=transcript){const value=new Event(name,{cancelable:true});Object.assign(value,properties);target.dispatchEvent(value);return value;}
 function keyEvent(key,properties={},target=transcript){const value=new Event('keydown',{cancelable:true});Object.assign(value,{key,...properties});Object.defineProperty(value,'target',{value:target});transcript.dispatchEvent(value);return value;}
 function gesture(away){event('wheel',{deltaY:-away,ctrlKey:false});transcript.top-=away;event('scroll');flush();}
 function growBelow(px){transcript.height+=px;}
 function growAbove(px){transcript.height+=px;for(const row of transcript.rows)row.offset+=px;}
 function replace(nextKey=key){transcript.isConnected=false;transcript=new Transcript();key=nextKey;return transcript;}
 return {app,environment,getConversationKey:()=>key,get transcript(){return transcript;},doc,observers,frames,deadlines,event,keyEvent,gesture,growBelow,growAbove,replace,flush,advance,field:tag=>new Element(doc,tag)};
}
