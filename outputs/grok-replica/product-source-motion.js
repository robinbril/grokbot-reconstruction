import { validateCatalogueData, sourceRuleCSS, assertInertCSS } from './ui-motion-catalogue-data.js';
// Source JavaScript is never loaded. These pinned CSS recipes are inert evidence.
export function createSourceMotion() {
  let recipes, descriptors, reduced = null, inspect = false, disposed = false;
  const instances = new Map(), definitions = new Map(), owned = new Set(), bound = new Map(), nodeBindings=new WeakMap(), roleChannels=new WeakMap(),reducedListeners=new Set();
  const style = document.createElement('style'); style.dataset.productSourceStyles = ''; document.head.append(style);
  const media = matchMedia('(prefers-reduced-motion:reduce)');
  const mode = () => (reduced === null ? media.matches : reduced) ? 'reduced' : 'normal';
  function renderCSS() {
    if (!recipes || disposed) return;
    const rules = new Map([...recipes.rules, ...descriptors.support_rules].map(r => [r.id, r]));
    const variables = new Map([...recipes.custom_variables, ...descriptors.variables].map(v => [`${v.rule}|${v.selector}|${v.property}|${(v.conditions||[]).join()}`,v]));
    const variableCSS = [...variables.values()].sort((a,b)=>Number(a.rule?.slice(4)||0)-Number(b.rule?.slice(4)||0)).map(v => sourceRuleCSS({selector:v.selector,declarations:[{property:v.property,value:v.value}],stateconditions:v.conditions||[]},mode())).join('\n');
    style.textContent = variableCSS+'\n@scope (:is(#app,#overlay,#popover-root,[data-product-portal])) {\n'+[...rules.values()].sort((a,b)=>Number(a.id.slice(4))-Number(b.id.slice(4))).map(r=>sourceRuleCSS({...r,selector:`${r.selector},:scope:is(${r.selector})`},mode())).join('\n')+'\n}\n'+recipes.keyframes.map(k=>k.css).join('\n');
  }
  const ready = Promise.all([fetch('./assets/ui-motion-recipes.json').then(r=>{if(!r.ok)throw Error('Motion recipes unavailable');return r.json();}),fetch('./assets/ui-motion-fixtures.json').then(r=>{if(!r.ok)throw Error('Motion descriptors unavailable');return r.json();})]).then(([data,fixture])=>{
    if(disposed)return; recipes=validateCatalogueData(data); descriptors=fixture;
    if(!Array.isArray(fixture.instances)||!Array.isArray(fixture.support_rules)||!Array.isArray(fixture.variables))throw TypeError('Invalid motion descriptors');
    for(const r of fixture.support_rules){assertInertCSS(r.selector);for(const d of r.declarations)assertInertCSS(d.value);}
    for(const i of recipes.instances)instances.set(i.id,i);for(const d of fixture.instances)definitions.set(d.id,d);renderCSS();bindTree(document);return api;
  });
  function classes(id,{full=false}={}) { return (full?definitions.get(id)?.classes:instances.get(id)?.source_classes)?.join(' ')||''; }
  function bind(node,id,{full=false,classes:branch}={}) {
    if(!node||!instances.has(id))return node;
    const tokens=branch===undefined?classes(id,{full}).split(' '):Array.isArray(branch)?branch:String(branch).split(' ');
    if(branch!==undefined)node.dataset.sourceClasses=tokens.join(' ');
    const bindings=nodeBindings.get(node)||new Map();bindings.set(id,new Set(tokens));nodeBindings.set(node,bindings);
    for(const token of tokens)if(/^(?:ui|sand)-[\w-]+$/.test(token))node.classList.add(token);
    node.dataset.sourceBound='';const ids=new Set((node.dataset.sourceInstance||'').split(/\s+/).filter(Boolean));ids.add(id);node.dataset.sourceInstance=[...ids].join(' ');
    bound.set(node,{ids:[...ids],role:node.dataset.sourceRole||node.getAttribute('role')||node.tagName.toLowerCase()});pauseTree(node);return node;
  }
  function unbind(node,id){
    if(!node)return;const bindings=nodeBindings.get(node)||new Map(),tokens=bindings.get(id)||new Set(classes(id).split(' '));bindings.delete(id);
    for(const token of tokens)if(token&&![...bindings.values()].some(set=>set.has(token)))node.classList.remove(token);
    const ids=(node.dataset.sourceInstance||'').split(/\s+/).filter(value=>value&&value!==id);if(ids.length)node.dataset.sourceInstance=ids.join(' ');else{delete node.dataset.sourceInstance;delete node.dataset.sourceBound;bound.delete(node);}
    const record=bound.get(node);if(record)record.ids=ids;
  }
  function replace(node,id,{channel='state',from=[],...options}={}){
    const channels=roleChannels.get(node)||new Map(),old=channels.get(channel);for(const previous of new Set([old,...from].filter(Boolean)))if(previous!==id)unbind(node,previous);
    if(options.classes===undefined)delete node.dataset.sourceClasses;channels.set(channel,id);roleChannels.set(node,channels);return bind(node,id,options);
  }
  function bindTree(root) {
    if(!root||!recipes)return;
    const nodes=[...(root.matches?.('[data-source-instance]')?[root]:[]),...root.querySelectorAll('[data-source-instance]')];
    for(const node of nodes)for(const id of node.dataset.sourceInstance.split(/\s+/))bind(node,id,{full:node.hasAttribute('data-source-full'),classes:node.dataset.sourceClasses});
    for(const node of bound.keys())if(!node.isConnected)bound.delete(node);
    pauseTree(root);
  }
  function pauseTree(root) { if(!inspect)return;for(const a of root.getAnimations?.({subtree:true})||[])if(a.playState!=='finished'){a.pause();if(a.currentTime===null)a.currentTime=0;} }
  function animate(node,frames,timing,meta={}) {
    const animation=node.animate(frames,timing);owned.add(animation);animation.productMeta=meta;
    animation.productReducedPolicy=meta.reducedPolicy||(meta.family==='transcript-placeholder-and-scrim'?{behavior:'retain',reason:'Source219/220 opacity160 retained under reduced motion'}:{behavior:'settle',reason:'Owner transform/layout/reveal source reduced branch'});
    if(mode()==='reduced'&&animation.productReducedPolicy.behavior!=='retain')animation.finish();
    else if(inspect){animation.pause();animation.currentTime=0;}
    animation.finished.then(()=>owned.delete(animation),()=>owned.delete(animation));return animation;
  }
  function setInspect(value){inspect=Boolean(value);for(const a of owned){if(inspect){a.pause();if(a.currentTime===null)a.currentTime=0;}else if(a.playState==='paused')a.play();}if(inspect)pauseTree(document);else for(const n of bound.keys())for(const a of n.getAnimations())if(a.playState==='paused')a.play();}
  function setReducedMotion(value){reduced=value===null?null:Boolean(value);if(mode()==='reduced')for(const animation of [...owned]){const policy=animation.productReducedPolicy;if(policy?.behavior==='retain'){if(Number.isFinite(policy.duration))animation.effect.updateTiming({duration:policy.duration});continue;}if(policy?.behavior==='cancel')animation.cancel();else try{animation.finish();}catch{animation.cancel();}}renderCSS();for(const listener of reducedListeners)listener(mode()==='reduced');}
  function diagnostics(){return {ready:Boolean(recipes),inspect,reduced:mode()==='reduced',bound:[...bound].filter(([n])=>n.isConnected).map(([n,b])=>({...b,connected:n.isConnected})),ownedAnimations:owned.size,sourceFamilies:recipes?.families.length||0,sourceInstances:recipes?.instances.length||0,nativeParityClaim:false};}
  const onMedia=()=>{if(reduced===null)setReducedMotion(null);};media.addEventListener('change',onMedia);
  function destroy(){disposed=true;for(const a of owned)a.cancel();owned.clear();bound.clear();reducedListeners.clear();style.remove();media.removeEventListener('change',onMedia);}
  const api={ready,classes,bind,unbind,replace,bindTree,animate,setInspect,setReducedMotion,onReducedMotion(listener){reducedListeners.add(listener);return()=>reducedListeners.delete(listener);},diagnostics,destroy,get reduced(){return mode()==='reduced';},get inspect(){return inspect;}};return api;
}
