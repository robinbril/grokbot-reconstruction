import {harnessError} from './store.mjs';
const textSchema={type:'object',properties:{content:{type:'string',minLength:1,maxLength:131072,pattern:'\\S'}},required:['content'],additionalProperties:false};
const attachmentSchema={type:'object',properties:{url:{type:'string',minLength:1,maxLength:8192,pattern:'\\S'},alt:{type:'string',maxLength:4096}},required:['url'],additionalProperties:false};
export const sendDefinition={name:'SendMessage',description:'Send a text message or a local workspace attachment to the user. This is the only user-visible response channel. Optional reply_to must identify an authoritative local reply target from the delivery context.',inputSchema:{type:'object',properties:{text:textSchema,attachment:attachmentSchema,reply_to:{type:'string',minLength:1,maxLength:96,pattern:'^[A-Za-z0-9][A-Za-z0-9_-]*$'}},oneOf:[{required:['text'],not:{required:['attachment']}},{required:['attachment'],not:{required:['text']}}],additionalProperties:false}};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const invalid=()=>harnessError('INVALID_TOOL_ARGUMENTS','SendMessage requires exactly one bounded text.content or attachment.url and an optional reply_to identifier',422);
export function sendMessageArguments(args){
 if(!exact(args,['text','attachment','reply_to'])||Object.hasOwn(args,'text')===Object.hasOwn(args,'attachment'))throw invalid();
 if(Object.hasOwn(args,'reply_to')&&(typeof args.reply_to!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(args.reply_to)))throw invalid();
 if(Object.hasOwn(args,'text')){
  if(!exact(args.text,['content'])||!Object.hasOwn(args.text,'content')||typeof args.text.content!=='string'||!args.text.content.trim()||args.text.content.length>131072)throw invalid();
 }else if(!exact(args.attachment,['url','alt'])||!Object.hasOwn(args.attachment,'url')||typeof args.attachment.url!=='string'||!args.attachment.url.trim()||args.attachment.url.length>8192||(Object.hasOwn(args.attachment,'alt')&&(typeof args.attachment.alt!=='string'||args.attachment.alt.length>4096)))throw invalid();
 return args;
}
export function sendMessageText(args){
 sendMessageArguments(args);if(!Object.hasOwn(args,'text'))throw invalid();return args.text.content;
}
