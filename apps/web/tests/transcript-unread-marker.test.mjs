import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranscriptUnreadSurface} from '../transcript-unread-surface.js';

test('same-boundary refresh restores exact marker adjacency after delivery removal/reorder without replacing marker or observer',t=>{
 const names=['document','window','CSS','IntersectionObserver'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 class Element{
  constructor(){this.children=[];this.dataset={};this.attributes={};}
  get isConnected(){return this===viewport||Boolean(this.parentNode?.isConnected);}
  get nextElementSibling(){const siblings=this.parentNode?.children||[];return siblings[siblings.indexOf(this)+1]||null;}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  insertBefore(node,before){node.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);node.parentNode=this;}
  before(node){this.parentNode.insertBefore(node,this);}
  remove(){if(!this.parentNode)return;const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}
  setAttribute(name,value){this.attributes[name]=value;}
  getBoundingClientRect(){return {top:10,bottom:20};}
  closest(selector){return selector==='.transcript'?viewport:selector==='.thread-frame'?frame:null;}
  addEventListener(){}
 }
 const viewport=new Element(),frame={querySelector:()=>null},container=new Element(),older=new Element(),target=new Element();viewport.append(container);container.append(older,target);
 const observations=[];let beforeMutations=0,afterMutations=0;
 globalThis.document={body:{},createElement:()=>new Element()};
 globalThis.window={removeEventListener(){}};globalThis.CSS={escape:value=>value};
 globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;this.disconnected=false;observations.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}};
 const host={app:{querySelector:selector=>selector==='.transcript'?viewport:target,querySelectorAll:()=>[]},getConversationKey:()=> 'chat',getUnreadRow:()=>({lastViewedAt:100,lastActivityAt:200}),getUnreadEntries:()=>[{id:'delivery-b',entryId:'run',timestampMs:200,eligible:true}],isTranscriptCovered:()=>true,transcriptReader:{beforeMutation(){beforeMutations++;},afterMutation(){afterMutations++;},subscribe:()=>()=>{},view:()=>({})}};
 const surface=createTranscriptUnreadSurface(host);
 t.after(()=>{surface.destroy();for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 surface.afterRender();const marker=container.children[1],observer=observations[0];
 assert.equal(marker.dataset.unreadEntryId,'delivery-b');assert.equal(marker.nextElementSibling,target);
 // Actual problematic transition: [older,marker,target] -> [target,marker].
 container.insertBefore(target,older);older.remove();assert.deepEqual(container.children,[target,marker]);
 surface.afterRender();assert.deepEqual(container.children,[marker,target]);
 assert.equal(observations.length,1);assert.equal(observations[0],observer);assert.equal(observer.disconnected,false);
 assert.equal(marker.nextElementSibling,target);assert.equal(beforeMutations,2);assert.equal(afterMutations,2);
 surface.afterRender();assert.equal(beforeMutations,2,'already adjacent refresh has no DOM mutation');assert.equal(observations.length,1);
});
