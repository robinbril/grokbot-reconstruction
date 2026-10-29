// Preserve one managed canvas browsing context without moving or disconnecting
// its ancestor path. Everything outside that path follows the normal HTML render.
const managed='[data-live-canvas-stage] iframe[title="Canvasvoorbeeld"]';
function pathTo(node,root){const nodes=[];while(node&&node!==root){nodes.unshift(node);node=node.parentNode;}return node===root?nodes:null;}
function attributes(target,source){
 for(const name of target.getAttributeNames())if(!source.hasAttribute(name))target.removeAttribute(name);
 for(const name of source.getAttributeNames()){const value=source.getAttribute(name);if(target.getAttribute(name)!==value)target.setAttribute(name,value);}
}
function replaceAround(target,source,path,index){
 if(target.nodeType===1&&source.nodeType===1)attributes(target,source);
 if(index===path.old.length)return;
 const kept=path.old[index],replacement=path.next[index],children=[...source.childNodes];
 for(const child of [...target.childNodes])if(child!==kept)child.remove();
 let after=false;
 for(const child of children){if(child===replacement){after=true;continue;}if(after)target.append(child);else target.insertBefore(child,kept);}
 replaceAround(kept,replacement,path,index+1);
}
export function renderAppWithCanvas(app,html){
 const frame=app.querySelector(managed);
 if(!frame){app.innerHTML=html;return;}
 const template=document.createElement('template');template.innerHTML=html;const next=template.content.querySelector(managed);
 const key=node=>node?.closest('[data-live-canvas-stage]')?.dataset.canvasKey;
 const sameAttributes=next&&frame.getAttributeNames().length===next.getAttributeNames().length&&frame.getAttributeNames().every(name=>frame.getAttribute(name)===next.getAttribute(name));
 const preserve=app.querySelectorAll(managed).length===1&&template.content.querySelectorAll(managed).length===1&&next&&key(frame)&&key(frame)===key(next)&&sameAttributes&&frame.getAttribute('sandbox')==='allow-scripts'&&next.getAttribute('sandbox')==='allow-scripts';
 const old=preserve?pathTo(frame,app):null,fresh=preserve?pathTo(next,template.content):null;
 if(!old||!fresh||old.length!==fresh.length||old.some((node,index)=>node.nodeType!==fresh[index].nodeType||node.nodeName!==fresh[index].nodeName)){app.innerHTML=html;return;}
 replaceAround(app,template.content,{old,next:fresh},0);
}
