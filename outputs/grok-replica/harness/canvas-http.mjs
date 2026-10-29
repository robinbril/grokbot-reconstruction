import {compileCanvas,canvasPreviewPolicy} from './canvas-preview.mjs';
import {harnessError} from './store.mjs';
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function html(res,status,value){res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':canvasPreviewPolicy,'Referrer-Policy':'no-referrer'});res.end(value);}
function revision(req,canvas){
 const search=new URL(req.url,'http://127.0.0.1').searchParams,expected=search.get('revision'),theme=search.get('theme')??'light';
 if(expected!==null&&(!/^[1-9]\d*$/.test(expected)||Number(expected)!==canvas.revision))throw harnessError('CANVAS_REVISION_CONFLICT','Canvas preview revision differs; refresh the saved resource',409);
 if(!['light','dark'].includes(theme))throw harnessError('INVALID_CANVAS','Canvas preview theme must be light or dark',422);return theme;
}
// Existing harness handler authenticates Host, Origin, owner and mutation CSRF.
export function createCanvasHandler({canvases,json,body}){
 return async(req,res,{owner,conversationId,route})=>{
  if(route!=='canvases'&&!route.startsWith('canvases/'))return false;
  const match=route.match(/^canvases(?:\/([^/]+)(?:\/(preview))?)?$/);if(!match)throw harnessError('NOT_FOUND','Canvas endpoint unavailable',404);
  const [,id,action]=match;
  if(req.method==='GET'&&!id){json(res,200,await canvases.list(owner,conversationId));return true;}
  if(req.method==='GET'&&id){
   const result=await canvases.read(owner,conversationId,id);if(!action){json(res,200,result);return true;}
   const theme=revision(req,result.canvas),controller=new AbortController(),close=()=>{if(!res.writableEnded)controller.abort();};res.once('close',close);
   try{html(res,200,await compileCanvas({...result.canvas,theme,signal:controller.signal}));}
   catch(error){if(error.code!=='CANVAS_COMPILE_FAILED')throw error;html(res,error.status,'<!doctype html><html><meta charset="utf-8"><title>Canvas error</title><body><h1>Canvas kon niet worden weergegeven</h1><pre>'+escape(error.message)+'</pre></body></html>');}
   finally{res.removeListener('close',close);}return true;
  }
  if(req.method==='POST'&&!action){
   const input=await body(req),controller=new AbortController(),abort=()=>controller.abort(),close=()=>{if(!res.writableEnded)abort();};req.once('aborted',abort);res.once('close',close);if(req.aborted||res.destroyed)abort();
   try{json(res,id?200:201,await (id?canvases.update(owner,conversationId,id,input,{signal:controller.signal}):canvases.create(owner,conversationId,input,{signal:controller.signal})));}
   finally{req.removeListener('aborted',abort);res.removeListener('close',close);}return true;
  }
  throw harnessError('METHOD_NOT_ALLOWED','Method not allowed',405);
 };
}
