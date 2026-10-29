import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readPreviewBytes,previewKind,previewDocument,previewSize,decodePreviewText,safeRasterDataURL,formatPreviewJSON} from '../live-attachment-preview-data.js';
const bytes=new TextEncoder().encode('REA_FILE_2046');
const file={attachmentId:'own',name:'rea-proof.txt',type:'text/plain',size:13,sha256:createHash('sha256').update(bytes).digest('hex')};
test('reader returns only bounded actual digest verified bytes',async()=>{
 assert.deepEqual(await readPreviewBytes(new Response(bytes),file),bytes);
 await assert.rejects(readPreviewBytes(new Response(bytes),{...file,sha256:'0'.repeat(64)}),/inhoud/);
 await assert.rejects(readPreviewBytes(new Response(bytes),{...file,size:12}),/grootte/);
 await assert.rejects(readPreviewBytes(new Response(bytes),{...file,size:6*1024*1024}),/5 MiB/);
});
test('reader cancels on streaming overflow and rejects absent streams or redirect responses',async()=>{
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(14));},cancel(){cancelled=true;}});
 await assert.rejects(readPreviewBytes(new Response(body),file),/grootte/);assert.equal(cancelled,true);
 await assert.rejects(readPreviewBytes(new Response(null),file),/lezen/);
});
test('dispatch requires matching supported type and extension, unsafe SVG never executes',()=>{
 for(const [name,type,expected] of [['a.txt','text/plain','text'],['a.json','application/json','json'],['a.csv','text/csv','table'],['a.md','text/markdown','markdown'],['a.html','text/html','html'],['a.png','image/png','image'],['a.mp4','video/mp4','video'],['a.mp3','audio/mpeg','audio'],['a.pdf','application/pdf','pdf'],['a.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx'],['a.svg','image/svg+xml','text'],['a.png','text/html','unsupported'],['a.exe','application/octet-stream','unsupported']])assert.equal(previewKind({name,type}),expected,name);
 assert.equal(previewSize(13),'13 bytes');
});
test('HTML document has restrictive first CSP and opaque sandbox policy, no network or scripts',()=>{
 const html=previewDocument('<script>parent.bad=1</script><img src="https://example.invalid">');
 assert.ok(html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
 assert.match(html,/default-src 'none'/);assert.match(html,/script-src 'none'/);assert.match(html,/connect-src 'none'/);assert.match(html,/form-action 'none'/);
});
test('reader refuses overlong advertised response before reading original bytes',async()=>{
 let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}});await assert.rejects(readPreviewBytes(new Response(stream,{headers:{'Content-Length':'999'}}),file),/grootte/);assert.equal(cancelled,true);
});
test('preview generations discard late reads after close, scope change, and newer opens',async t=>{
 const {createLiveAttachmentPreview}=await import('../live-attachment-preview.js');
 const oldDocument=globalThis.document,oldFetch=globalThis.fetch;let scope=JSON.stringify(['local','conversation']),reads=[];
 class Node{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.isConnected=false;this.open=false;this.innerHTML='';}append(...nodes){this.children.push(...nodes);for(const node of nodes)node.isConnected=true;}setAttribute(){}addEventListener(){}showModal(){this.open=true;}close(){this.open=false;}remove(){this.isConnected=false;}replaceChildren(...nodes){this.children=nodes;}}
 const body=new Node('body');globalThis.document={querySelector:()=>true,createElement:tag=>new Node(tag),body};
 globalThis.fetch=(url,options)=>new Promise(resolve=>reads.push({url,options,resolve}));
 t.after(()=>{globalThis.document=oldDocument;globalThis.fetch=oldFetch;});
 const preview=createLiveAttachmentPreview({getScope:()=>scope,isCurrentConversation:id=>id==='conversation'});
 void preview.open(file,'wrong-conversation');assert.equal(reads.length,0,'stale delivery cannot initiate a read in another conversation');
 const first=preview.open(file,'conversation');assert.equal(reads.length,1);const old=body.children[0];preview.close();assert.equal(reads[0].options.signal.aborted,true);reads[0].resolve(new Response(bytes));await first;assert.equal(old.isConnected,false);
 const changed=preview.open(file,'conversation');scope=JSON.stringify(['other','conversation-other']);preview.sync();reads[1].resolve(new Response(bytes));await changed;assert.equal(body.children[1].isConnected,false);
 scope=JSON.stringify(['local','conversation']);const superseded=preview.open(file,'conversation'),latest=preview.open(file,'conversation');reads[2].resolve(new Response(bytes));await superseded;assert.equal(body.children[2].isConnected,false);reads[3].resolve(new Response(bytes));await latest;assert.equal(body.children[3].open,true);preview.destroy();assert.equal(body.children[3].isConnected,false);
});

test('text preview rejects binary, huge text and excessive line counts before building a view',()=>{
 assert.equal(decodePreviewText(bytes),'REA_FILE_2046');
 assert.throws(()=>decodePreviewText(new Uint8Array([0])),/tekst/);
 assert.throws(()=>decodePreviewText(new Uint8Array(1024*1024+1).fill(65)),/groot/);
 assert.throws(()=>decodePreviewText(new TextEncoder().encode('a\n'.repeat(10001))),/regels/);
});

test('inline data images require bounded matching raster signatures',()=>{
 assert.equal(safeRasterDataURL('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='),true);
 assert.equal(safeRasterDataURL('data:image/gif;base64,PHN2Zz48L3N2Zz4='),false);
 assert.equal(safeRasterDataURL('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),false);
 assert.equal(safeRasterDataURL('https://example.invalid/a.gif'),false);
});

test('pretty JSON rechecks line bounds after expanding compact input',()=>{
 const compact=JSON.stringify(Array.from({length:10001},()=>42));
 assert.equal(decodePreviewText(new TextEncoder().encode(compact)),compact);
 assert.throws(()=>formatPreviewJSON(compact),/regels/);
});
