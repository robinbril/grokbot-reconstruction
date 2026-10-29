// Scripted HTTP/SSE UI fixture. It never contacts a model or proves model inference.
import http from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))),port=Number(process.env.PORT||8890);
const runtime={adapter:'grok-bot-harness',state:'ready',provider:'scripted-ui-fixture',model:'scripted UI transport'};
let state,events,clients,attachments,reject;
const reset=()=>{for(const client of clients||[])client.end();clients=new Set();events=[];attachments=new Map();reject=false;state={schema:1,conversationId:'unset',entries:[],runs:[],tools:[],servers:[],terminalSessions:[],browserSessions:[],queue:[],schedules:[],workflow:{},lastSeq:0,runtime};};reset();
const json=(res,value,status=200)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));
async function body(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);return req.headers['content-type']?.includes('application/json')?JSON.parse(bytes.toString()||'{}'):bytes;}
function emit(type,data){const event={schema:1,id:'event-'+(state.lastSeq+1),conversationId:state.conversationId,runId:'scripted-run',seq:++state.lastSeq,type,data};events.push(event);for(const client of clients)client.write('data: '+JSON.stringify(event)+'\n\n');}
function entry(text,status='running'){const row=state.entries.find(row=>row.id==='scripted-assistant');if(!row)return;row.text=text;row.revision++;row.status=status;emit('entry.updated',{entry:{...row}});}
function finish(status){const run=state.runs[0];if(!run)return;run.status=status;emit('run.'+status,{run:{...run}});}
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1'),p=url.pathname,method=req.method;
 if(p.startsWith('/__fixture/')){const action=p.split('/').at(-1);if(action==='reset')reset();if(action==='reject')reject=true;if(action==='allow')reject=false;
  if(action==='chunk'&&state.runs[0]?.status==='running'){const value=await body(req);entry(value.text);}
  if(action==='complete'&&state.runs[0]?.status==='running'){entry('Eerste zichtbare tekst. Afgerond antwoord.','completed');finish('completed');}
  return json(res,{ok:true,state,events});
 }
 if(p.startsWith('/api/harness/')){
  if(p==='/api/harness/status')return json(res,{schema:1,csrfToken:'scripted-only',runtime});
  if(p==='/api/harness/access')return json(res,{bots:[],teams:[],accounts:[]});
  if(p==='/api/harness/accounts')return json(res,{accounts:[],pendingFlows:[]});
  const match=p.match(/^\/api\/harness\/conversations\/([^/]+)(.*)$/);
  if(match){state.conversationId=decodeURIComponent(match[1]);const tail=match[2];
   if(tail===''||tail==='/connect')return json(res,state);
   if(tail==='/tools')return json(res,{servers:[]});
   if(tail==='/attachments'&&method==='POST'){const value=await body(req),id='upload-'+(attachments.size+1);attachments.set(id,{...value,attachmentId:id,state:'reserved'});return json(res,attachments.get(id));}
   const file=tail.match(/^\/attachments\/([^/]+)(\/content)?$/);
   if(file){const item=attachments.get(file[1]);if(!item)return json(res,{error:{message:'Unknown synthetic upload'}},404);if(file[2]){await body(req);item.state='ready';item.contentAccess=item.type.startsWith('image/')?'native-image':/\.(pdf|docx)$/i.test(item.name)?'file-only':'text';}return json(res,item);}
   if(tail==='/runs'&&method==='POST'){const value=await body(req);if(reject)return json(res,{error:{code:'ATTACHMENT_MODEL_UNSUPPORTED',message:'Deze bijlage kan niet door dit model worden gelezen. Je concept blijft behouden.',retryable:false,accepted:false}},422);
    const files=(value.attachmentRefs||[]).map(ref=>attachments.get(ref.attachmentId));state.entries=[{id:'scripted-user',role:'user',text:value.text,revision:1,status:'completed',runId:'scripted-run',createdAt:1,attachments:files},{id:'scripted-assistant',role:'assistant',text:'',revision:1,status:'running',runId:'scripted-run',createdAt:2}];
    state.runs=[{id:'scripted-run',requestId:value.requestId,status:'running',approvals:[],inputEntryId:'scripted-user',outputEntryId:'scripted-assistant'}];return json(res,{accepted:true,runId:'scripted-run',lastSeq:state.lastSeq});}
  }
  if(p==='/api/harness/runs/scripted-run/cancel'){entry(state.entries[1].text,'cancelled');finish('cancelled');return json(res,{accepted:true});}
  if(p==='/api/harness/runs/scripted-run/events'){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();clients.add(res);for(const event of events)if(event.seq>Number(url.searchParams.get('after')||0))res.write('data: '+JSON.stringify(event)+'\n\n');req.on('close',()=>clients.delete(res));return;
  }
  return json(res,{error:{message:'Unhandled scripted fixture route: '+p}},404);
 }
 const relative=p==='/'?'index.html':decodeURIComponent(p.slice(1)),target=path.resolve(root,relative);
 if(!target.startsWith(root+path.sep)||relative.split('/').some(part=>part.startsWith('.'))||!types[path.extname(target)]||relative.startsWith('harness/'))return res.writeHead(404).end();
 const canonical=await realpath(target);if(!canonical.startsWith(root+path.sep))return res.writeHead(404).end();
 res.writeHead(200,{'Content-Type':types[path.extname(target)],'Cache-Control':'no-store'}).end(await readFile(canonical));
 }catch(error){json(res,{error:{message:error.message}},500);}}).listen(port,'127.0.0.1',()=>process.stdout.write('Scripted streaming UI fixture: '+port+'\n'));
process.once('SIGTERM',()=>{for(const client of clients)client.end();server.close();});
