import {createHash} from 'node:crypto';
import {CanvasStore} from './canvas-store.mjs';
import {harnessError} from './store.mjs';
import {validateArguments} from './grok-turns.mjs';
const text=maxLength=>({type:'string',minLength:1,maxLength});
const schema=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const canvasId={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
export const canvasToolDefinitions=[
 {name:'canvas_list',description:'List saved local React canvases in this conversation. This is an independent local resource, not a remote cloud canvas.',inputSchema:schema({})},
 {name:'canvas_read',description:'Read the current saved title, TSX source and revision of one local canvas in this conversation.',inputSchema:schema({canvasId})},
 {name:'canvas_create',description:'Create a durable local React canvas. Source must default-export a React component; imports support only the installed React runtime. Does not execute source on the server.',inputSchema:schema({title:text(200),source:text(65536)})},
 {name:'canvas_update',description:'Save a local canvas using its exact current expectedRevision; a conflict requires reading it again. Does not overwrite a newer edit.',inputSchema:schema({canvasId,title:text(200),source:text(65536),expectedRevision:{type:'integer',minimum:1}})},
].map(tool=>({...tool,serverId:'grok_canvas'}));
export function createCanvasTools({store,owner,conversationId}){
 const canvases=new CanvasStore({store});
 return {listTools:()=>structuredClone(canvasToolDefinitions),async callTool(name,args={},options={}){
  const definition=canvasToolDefinitions.find(tool=>tool.name===name);if(!definition)throw harnessError('UNKNOWN_TOOL','Canvas tool unavailable',422);
  validateArguments(definition.inputSchema,args);options.signal?.throwIfAborted();
  if(name==='canvas_list')return canvases.list(owner,conversationId);
  if(name==='canvas_read')return canvases.read(owner,conversationId,args.canvasId);
  if(typeof options.callId!=='string'||!options.callId||options.callId.length>200)throw harnessError('CANVAS_CALL_ID_REQUIRED','Canvas writes require an actual tool-call identifier',422);
  const requestId=createHash('sha256').update(JSON.stringify([options.runId??null,options.callId])).digest('hex');
  const {canvasId,...value}=args,payload={requestId,...value};
  return name==='canvas_create'?canvases.create(owner,conversationId,payload,options):canvases.update(owner,conversationId,canvasId,payload,options);
 }};
}
