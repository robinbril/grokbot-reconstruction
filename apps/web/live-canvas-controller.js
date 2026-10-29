// Canvas content is authoritative on the harness. Only unacknowledged edits live here.
const storageKey='grok-canvas-drafts-v1';
const blankSource='export default function Canvas() {\n  return <main />;\n}\n';
const clone=value=>structuredClone(value);
const validString=(value,max)=>typeof value==='string'&&value.length<=max&&!value.includes('\0');
const same=(draft,body)=>draft.title===body.title&&draft.source===body.source;
function restoreDraft(value){
 if(!value||typeof value!=='object'||!validString(value.title,200)||!validString(value.source,65536))return null;
 if(value.id!==null&&(!validString(value.id,96)||!Number.isSafeInteger(value.revision)))return null;
 if(!validString(value.savedTitle??'',200)||!validString(value.savedSource??'',65536))return null;
 const draft={...value,busy:false,error:'',conflict:false};
 if(draft.request&&(!validString(draft.request.requestId,96)||!validString(draft.request.title,200)||!validString(draft.request.source,65536)))draft.request=null;
 return draft;
}
export function createCanvasController({client,onChange=()=>{},storage=globalThis.localStorage,uuid=()=>crypto.randomUUID()}={}){
 const scopes=new Map();let selected=null,disposed=false,openEpoch=0,error='';
 try{const saved=JSON.parse(storage?.getItem(storageKey)??'{}');for(const [id,value]of Object.entries(saved)){if(!value||typeof value!=='object')continue;const drafts=new Map();for(const [key,raw]of Object.entries(value.drafts??{})){const draft=restoreDraft(raw);if(draft)drafts.set(key,draft);}scopes.set(id,{items:[],drafts,active:drafts.has(value.active)?value.active:null,loading:false,reads:0,listError:'',epoch:0});}}catch{error='Het lokale canvasconcept kon niet worden gelezen.';}
 const scope=()=>{if(!selected)return null;if(!scopes.has(selected))scopes.set(selected,{items:[],drafts:new Map(),active:null,loading:false,reads:0,listError:'',epoch:0});return scopes.get(selected);};
 const editor=()=>{const state=scope();return state?.drafts.get(state.active)??null;};
 const notify=()=>{if(!disposed)onChange();};
 function persist(){
  try{const value=Object.fromEntries([...scopes].map(([id,s])=>[id,{active:s.active,drafts:Object.fromEntries([...s.drafts].filter(([,d])=>d.request||d.source!==d.savedSource||d.title!==d.savedTitle).map(([key,d])=>[key,{id:d.id,title:d.title,source:d.source,revision:d.revision,savedTitle:d.savedTitle,savedSource:d.savedSource,request:d.request}]))}]));const encoded=JSON.stringify(value);if(encoded.length>2*1024*1024)throw Error();storage?.setItem(storageKey,encoded);error='';return true;}catch{error='Het canvasconcept kon niet veilig worden opgeslagen. Je tekst blijft in dit venster; probeer opnieuw.';return false;}
 }
 function state(){const current=scope(),draft=editor();return {scope:selected,items:clone(current?.items??[]),loading:Boolean(current?.loading||current?.reads),error:error||current?.listError||'',editor:draft?{...clone(draft),pending:Boolean(draft.request),remoteRevision:current.items.find(item=>item.id===draft.id)?.revision??draft.revision,dirty:draft.id===null||draft.title!==draft.savedTitle||draft.source!==draft.savedSource}:null};}
 function selectScope(id){if(id===selected)return;selected=id;openEpoch++;scope();notify();}
 async function refresh(){
  const id=selected,current=scope();if(!id||current.loading||disposed)return;current.loading=true;current.listError='';const epoch=++current.epoch;notify();
  try{const result=await client.canvasList(id);if(current.epoch===epoch)current.items=clone(result.canvases??[]);}catch(problem){if(current.epoch===epoch)current.listError=problem.message||'Canvassen konden niet worden geladen.';}
  finally{if(current.epoch===epoch)current.loading=false;if(selected===id)notify();}
 }
 function newCanvas(){const current=scope();if(!current)return;openEpoch++;if(!current.drafts.has('new'))current.drafts.set('new',{id:null,title:'Nieuw canvas',source:blankSource,revision:null,savedTitle:'',savedSource:'',request:null,busy:false,error:'',conflict:false});current.active='new';persist();notify();}
 async function open(id,{replace=false}={}){
  const canonical=selected,current=scope();if(!canonical||!current)return;const epoch=++openEpoch;
  if(current.drafts.has(id)&&!replace){current.active=id;persist();notify();return;}
  const priorDraft=current.drafts.get(id),priorText=priorDraft?JSON.stringify([priorDraft.title,priorDraft.source]):null;
  current.reads++;current.listError='';notify();
  try{const result=await client.canvasRead(canonical,id);if(disposed||selected!==canonical||epoch!==openEpoch)return;const canvas=result.canvas;if(priorDraft&&JSON.stringify([priorDraft.title,priorDraft.source])!==priorText){priorDraft.error='Nieuwere wijzigingen blijven behouden. Laad de opgeslagen versie opnieuw als je die wilt gebruiken.';return;}current.drafts.set(id,{...clone(canvas),savedTitle:canvas.title,savedSource:canvas.source,request:null,busy:false,error:'',conflict:false});current.active=id;persist();}
  catch(problem){if(selected===canonical&&epoch===openEpoch)current.listError=problem.message||'Canvas kon niet worden geopend.';}
  finally{current.reads--;if(selected===canonical)notify();}
 }
 function edit(field,value){const draft=editor();if(!draft||!['title','source'].includes(field)||typeof value!=='string')return;draft[field]=value;persist();notify();}
 async function save(){
  const canonical=selected,current=scope(),draft=editor();if(!canonical||!draft||draft.busy||draft.conflict)return false;
  if(!draft.request)draft.request={requestId:uuid(),title:draft.title,source:draft.source,...(draft.id?{expectedRevision:draft.revision}:{})};
  if(!persist()){notify();return false;}const body=clone(draft.request),originalId=draft.id;draft.busy=true;draft.error='';notify();
  try{
   const result=originalId?await client.canvasUpdate(canonical,originalId,body):await client.canvasCreate(canonical,body);if(disposed)return true;const canvas=result.canvas,unchanged=same(draft,body);
   const oldKey=[...current.drafts].find(([,value])=>value===draft)?.[0];if(oldKey)current.drafts.delete(oldKey);current.drafts.set(canvas.id,draft);if(current.active===oldKey)current.active=canvas.id;
   Object.assign(draft,{id:canvas.id,revision:canvas.revision,savedTitle:canvas.title,savedSource:canvas.source,request:null,conflict:false,...(unchanged?{title:canvas.title,source:canvas.source}:{})});
   const at=current.items.findIndex(value=>value.id===canvas.id),summary=Object.fromEntries(Object.entries(canvas).filter(([key])=>key!=='source'));if(at<0)current.items.push(summary);else current.items[at]=summary;persist();return true;
  }catch(problem){if(disposed)return false;draft.error=problem.message||'Canvas niet opgeslagen. Probeer opnieuw.';draft.conflict=problem.code==='CANVAS_REVISION_CONFLICT';if(draft.conflict||problem.accepted===false)draft.request=null;persist();return false;}
  finally{draft.busy=false;if(selected===canonical)notify();}
 }
 function back(){const current=scope();if(!current)return;openEpoch++;current.active=null;persist();notify();}
 function reload(){const draft=editor();if(draft?.busy||draft?.request)return Promise.resolve(false);return draft?.id?open(draft.id,{replace:true}):Promise.resolve();}
 return {state,selectScope,refresh,newCanvas,open,edit,save,back,reload,destroy(){disposed=true;openEpoch++;}};
}
