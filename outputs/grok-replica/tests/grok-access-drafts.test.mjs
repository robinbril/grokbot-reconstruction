// Surface/controller regression. DOM and transport doubles do not prove live account access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveAccessSurface} from '../live-access-surface.js';

function dialogEnvironment(t){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 const document={activeElement:null};globalThis.document=document;
 let root,version=0;
 function mount(){
  if(root)for(const input of root.inputs)input.isConnected=false;
  document.activeElement=null;
  const next={inputs:[],contains:input=>next.inputs.includes(input),querySelectorAll:()=>next.inputs,set outerHTML(value){mount();}};
  next.inputs=['teamName','invitation'].map(name=>({dataset:{accessField:name},value:'',isConnected:true,
   focus(){document.activeElement=this;},replaceWith(input){next.inputs[next.inputs.indexOf(this)]=input;this.isConnected=false;input.isConnected=true;}}));
  root=next;
 }
 const overlay={open:true,querySelector:selector=>selector==='[data-live-access-root]'?root:root?.inputs.find(input=>selector===`[data-access-field="${input.dataset.accessField}"]`),querySelectorAll:()=>root?.inputs||[]};
 const host={esc:String,overlay,closePopover(){},showDialog(){version++;mount();},getDialogVersion:()=>version};
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 return {host,document,field:name=>overlay.querySelector(`[data-access-field="${name}"]`)};
}

test('async access refresh preserves the actual field targeted by an in-flight fill before team creation',async t=>{
 const e=dialogEnvironment(t),requests=[];
 let release,reads=0,created=false;
 const initial=new Promise(resolve=>{release=resolve;}),overview=()=>({principal:{id:'owner',name:'Local profile'},teams:created?[{id:'team',name:'Access proof team',role:'owner',members:[]}]:[],bots:[],grants:[]});
 const surface=createLiveAccessSurface({host:e.host,isLive:()=>true,key:()=> 'bot',client:{
  accounts:async()=>({accounts:[]}),accessOverview:()=>reads++===0?initial:Promise.resolve(overview()),
  createTeam:async(name,requestId)=>{requests.push({name,requestId});if(!name)throw new Error('Name must contain 1–100 printable characters');created=true;return {team:{id:'team'}};},
 }});
 t.after(()=>surface.destroy());surface.handleAction({action:'live-access-open'});
 const filling=e.field('teamName'),invitation=e.field('invitation');filling.focus();invitation.value='Unsubmitted invitation';
 // A native fill may resolve its input before a background refresh, then write after it.
 release(overview());await new Promise(setImmediate);filling.value='Access proof team';
 await surface.handleAction({action:'live-access-team-create'});
 assert.equal(requests.length,1);assert.equal(requests[0].name,'Access proof team','the server receives the value written to the original live control');
 assert.equal(e.field('teamName'),filling,'canonical reads and mutation status paints preserve the input node');
 assert.equal(e.document.activeElement,filling,'refresh keeps keyboard focus on the original input');
 assert.equal(e.field('invitation'),invitation);assert.equal(invitation.value,'Unsubmitted invitation');
});
