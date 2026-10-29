// Local compiler instrumentation, not the unrecovered native canvas runtime.
// Element metadata is source data, never authorization or a parent-DOM capability.
const annotation='data-rea-canvas-source';
const name=/^[A-Za-z_$][\w$-]*(?:\.[A-Za-z_$][\w$-]*)*$/;
const propName=/^[A-Za-z_$][\w$-]*$/;
export function annotateCanvasElement(type,props,source){
 if(typeof type!=='string'||type.length>64||!name.test(type)||!source||source.fileName!=='source.canvas.tsx'||!Number.isSafeInteger(source.lineNumber)||source.lineNumber<1||!Number.isSafeInteger(source.columnNumber)||source.columnNumber<1)return props;
 const safe=Object.create(null);for(const [key,value]of Object.entries(props??{})){
  if(Object.keys(safe).length===16)break;
  if(key.length>64||!propName.test(key)||['key','ref','children'].includes(key))continue;
  if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))safe[key]=value;
  else if(typeof value==='string')safe[key]=value.slice(0,120);
 }
 return {...props,[annotation]:JSON.stringify({kind:'element',name:type,anchor:{line:source.lineNumber,column:source.columnNumber},props:safe})};
}
function record(element){
 const raw=element.getAttribute(annotation);if(!raw||raw.length>6000)return null;
 try{const value=JSON.parse(raw);if(value.kind!=='element'||typeof value.name!=='string'||value.name.length>64||!name.test(value.name)||!Number.isSafeInteger(value.anchor?.line)||value.anchor.line<1||!Number.isSafeInteger(value.anchor?.column)||value.anchor.column<1)return null;return value;}catch{return null;}
}
export function activateCanvasDesign(){
 let enabled=false,selected=null,chain=[],overlay=null;
 const send=selection=>parent.postMessage({type:'cursor-canvas-design-picked',selection},'*');
 function elements(target){const stack=[];for(let element=target instanceof Element?target:null;element&&element.id!=='canvas-root';element=element.parentElement)if(record(element))stack.push(element);return stack.slice(0,12);}
 function selection(element){const stack=elements(element).map(record),rect=element.getBoundingClientRect();return stack.length?{stack,tag:element.localName.toLowerCase().slice(0,32),text:(element.textContent??'').slice(0,200),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}:null;}
 function highlight(element){
  if(!overlay){overlay=document.createElement('div');overlay.dataset.canvasDesignHighlight='';Object.assign(overlay.style,{position:'fixed',pointerEvents:'none',zIndex:'2147483647',border:'2px solid #1683ff',boxSizing:'border-box',borderRadius:'2px'});document.body.append(overlay);}
  if(!element||!enabled){overlay.hidden=true;return;}const rect=element.getBoundingClientRect();Object.assign(overlay.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});overlay.hidden=false;
 }
 function pick(element){selected=element;chain=element?elements(element):[];highlight(element);send(element?selection(element):null);}
 function clear(){selected=null;chain=[];highlight(null);send(null);}
 window.addEventListener('message',event=>{
  if(event.source!==parent||!event.data||typeof event.data!=='object')return;
  const value=event.data;
  if(value.type==='cursor-canvas-design-mode'&&typeof value.enabled==='boolean'){enabled=value.enabled;clear();}
  else if(enabled&&value.type==='cursor-canvas-design-clear')clear();
  else if(enabled&&value.type==='cursor-canvas-design-select'&&Number.isSafeInteger(value.depth)&&value.depth>=0&&value.depth<chain.length)pick(chain[value.depth]);
 });
 window.addEventListener('pointermove',event=>{if(enabled&&event.isTrusted)highlight(elements(event.target)[0]??selected);},true);
 for(const type of ['pointerdown','pointerup','mousedown','mouseup','dblclick'])window.addEventListener(type,event=>{if(enabled&&event.isTrusted){event.preventDefault();event.stopImmediatePropagation();}},true);
 window.addEventListener('click',event=>{if(!enabled||!event.isTrusted)return;event.preventDefault();event.stopImmediatePropagation();chain=elements(event.target);pick(chain[0]??null);},true);
 window.addEventListener('keydown',event=>{if(enabled&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();clear();}},true);
 const refresh=()=>{if(enabled&&selected){if(selected.isConnected)pick(selected);else clear();}};
 window.addEventListener('resize',refresh);window.addEventListener('scroll',refresh,true);
 requestAnimationFrame(()=>parent.postMessage({type:'cursor-canvas-design-capable',sourceFile:'source.canvas.tsx'},'*'));
}
