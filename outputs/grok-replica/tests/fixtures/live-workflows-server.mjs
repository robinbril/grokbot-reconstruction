// Test-only static host around the REAL production handler and independent runtime.
// No test-only route is added to product HTTP. Fixture output is not model proof.
import http from 'node:http';
import {readFile,realpath,stat,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHarnessHandler} from '../../harness/http.mjs';
import {staticAssetType,staticAssetPolicy} from '../../harness/static-assets.mjs';
import {createWorkflowFixtureModel} from './live-workflows-model.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));

export async function startWorkflowProtocolServer({port=18876,model=createWorkflowFixtureModel(),toolHostFactory}={}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'live-workflows-ui-'));let handler,now=Date.now();
 const server=http.createServer(async(req,res)=>{
  if(await handler.handle(req,res))return;
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),relative=pathname==='/'?'index.html':pathname.slice(1),target=path.resolve(root,relative);
   if(!target.startsWith(root)||relative.split('/').some(part=>part.startsWith('.'))||relative.startsWith('harness/')||!staticAssetType(relative)){res.writeHead(404).end();return;}
   const canonical=await realpath(target),realRelative=path.relative(root,canonical);
   if(realRelative.startsWith('..')||path.isAbsolute(realRelative)||realRelative.split(path.sep).some(part=>part.startsWith('.'))||realRelative.split(path.sep)[0]==='harness'||!staticAssetType(realRelative.split(path.sep).join('/'))||!(await stat(canonical)).isFile()){res.writeHead(404).end();return;}
   const bytes=await readFile(canonical);res.writeHead(200,{'Content-Type':staticAssetType(realRelative.split(path.sep).join('/')),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':staticAssetPolicy(realRelative.split(path.sep).join('/'))}).end(bytes);
  }catch{res.writeHead(404).end();}
 });
 // The default UI origin stays stable between recordings and strict replay.
 // Node regression tests use port 0 to avoid colliding with the UI gate.
 // Own this port exclusively: an occupied port is an error, never a reused host.
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({port,host:'127.0.0.1',exclusive:true},resolve);});}catch(error){await rm(dataDir,{recursive:true,force:true});throw error;}const baseUrl='http://127.0.0.1:'+server.address().port;
 try{handler=await createHarnessHandler({root,dataDir,baseUrl,workflowClock:()=>now,workflowAutoStart:false,model,toolHostFactory});}catch(error){await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});throw error;}
 let closed=false;
 return {baseUrl,handler,async advanceTo(instant){if(!Number.isFinite(instant)||instant<now)throw new Error('Clock must advance');now=instant;await handler.workflows.tick();},async interrupt(conversationId){const connection=handler.runtime.connections.get(conversationId);if(!connection)throw new Error('No fixture connection to interrupt');await handler.runtime.drop(conversationId,connection);},async close(){if(closed)return;closed=true;await handler.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataDir,{recursive:true,force:true});}};
}
