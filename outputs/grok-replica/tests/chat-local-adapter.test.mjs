// PREPARATION ONLY. Imports the future real local adapter after root adoption, never a stub.
// No callbacks/imports executed here. This layer proves computation, not parser/UI/provider use.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalTextAdapter} from '../chat-local-adapter.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const settle=async predicate=>{for(let i=0;i<64;i++){if(predicate())return;await Promise.resolve();}assert.fail('real adapter did not reach its work boundary');};
const execute=async(text,operation,style='short')=>{
 const progress=[],yields=[];const adapter=createLocalTextAdapter({yieldWork:async signal=>{assert.equal(signal.aborted,false);yields.push(true);}});
 const signal=new AbortController().signal,result=await adapter.execute({text,operation,style,signal,onProgress:p=>progress.push(p)});
 assert.equal(adapter.id,'local-text-v1');assert.equal(result.processed,text.length);assert.equal(result.total,text.length);
 let previous=0;for(const p of progress){assert.ok(Number.isSafeInteger(p.processed)&&p.processed>=previous&&p.processed<=text.length);assert.equal(p.total,text.length);assert.equal(typeof p.text,'string');previous=p.processed;}
 return {result,progress,yields};
};
for(const style of ['short','full'])test('actual uppercase preserves whitespace/Unicode bytes in '+style,async()=>{
 const {result}=await execute('  één\tStraße\n😀 ﬃ ı  ','upper',style);assert.equal(result.text,'  ÉÉN\tSTRASSE\n😀 FFI I  ');
});
for(const [text,shortText,fullText] of [
 ['een  twee\n😀','3 woorden','3 woorden · 12 tekens · 2 regels'],['a\u00a0b\uFEFF😀\r\nc\n','4 woorden','4 woorden · 10 tekens · 3 regels'],
 ['one\rtwo','2 woorden','2 woorden · 7 tekens · 1 regel'],['\t a \n\n b  ','2 woorden','2 woorden · 10 tekens · 3 regels'],
 ['x','1 woord','1 woord · 1 teken · 1 regel'],['😀','1 woord','1 woord · 2 tekens · 1 regel'],['one two three','3 woorden','3 woorden · 13 tekens · 1 regel']
])test('actual count uses non-whitespace words, UTF16 characters and newline lines '+JSON.stringify(text),async()=>{
 const short=await execute(text,'count','short'),full=await execute(text,'count','full');assert.equal(short.result.text,shortText);assert.equal(full.result.text,fullText);
});
test('one word crossing real work chunks is counted once, with no chunk-boundary phantom words',async()=>{
 const text='a'.repeat(65535)+' b',{result,yields}=await execute(text,'count','short');assert.equal(result.text,'2 woorden');assert.ok(yields.length>0,'large accepted input must yield at a genuine bounded work chunk');
});
for(const style of ['short','full'])test('Markdown is verbatim supplied input in '+style+'; this is not renderer proof',async()=>{
 const text='  # Titel\r\n\n| A | B |\n|---|---|\n| x\\|y | 2 |\n\n```js\n\tconst x = "ß";\n```\n\n<script>inert source</script>\n',r=await execute(text,'markdown',style);assert.equal(r.result.text,text);
});
test('maximum accepted input can expand on uppercase: 100000 sharp-s units become 200000 output units',async()=>{
 const text='ß'.repeat(100000),{result,progress,yields}=await execute(text,'upper');assert.equal(result.text,'SS'.repeat(100000));assert.equal(result.text.length,200000);assert.equal(result.processed,100000);assert.equal(result.total,100000);assert.ok(yields.length>0);assert.ok(progress.every(p=>p.total===100000));
});
test('genuine Markdown progress consists of exact prefixes without splitting surrogate pairs',async()=>{
 const text=('a🙂ß\n').repeat(16000),{result,progress,yields}=await execute(text,'markdown');assert.ok(text.length<=100000);assert.ok(yields.length>0);assert.ok(progress.length>0);
 for(const p of progress){assert.equal(p.text,text.slice(0,p.processed));if(p.text.length)assert.equal(/[\uD800-\uDBFF]$/.test(p.text),false);}
 assert.equal(result.text,text);
});
for(const change of [
 {text:''},{text:' \t\r\n\u00a0'},{text:'x'.repeat(100001)},{text:42},{operation:'__proto__'},{style:'unknown'}
])test('invalid local input/operation/style rejects before work '+JSON.stringify({...change,...(typeof change.text==='string'&&change.text.length>80?{text:'[oversize]'}:{})}),async()=>{
 let yields=0,progress=0;const adapter=createLocalTextAdapter({yieldWork:async()=>{yields++;}});
 await assert.rejects(Promise.resolve().then(()=>adapter.execute({text:'accepted',operation:'upper',style:'short',signal:new AbortController().signal,onProgress:()=>{progress++;},...change})));assert.equal(yields,0);assert.equal(progress,0);
});
test('pre-aborted signal performs no work or progress',async()=>{
 const stop=new AbortController();stop.abort();let progress=0,yields=0;const adapter=createLocalTextAdapter({yieldWork:async()=>{yields++;}});
 await assert.rejects(Promise.resolve().then(()=>adapter.execute({text:'source',operation:'upper',style:'short',signal:stop.signal,onProgress:()=>{progress++;}})));assert.equal(progress,0);assert.equal(yields,0);
});
for(const operation of ['upper','count','markdown'])test('abort while genuine '+operation+' work is yielded rejects and publishes no later progress',async()=>{
 const stop=new AbortController(),holds=[],progress=[];const adapter=createLocalTextAdapter({yieldWork:signal=>{assert.equal(signal,stop.signal);const d=deferred();holds.push(d);return d.promise;}});
 const task=Promise.resolve().then(()=>adapter.execute({text:('a🙂ß\n').repeat(16000),operation,style:'full',signal:stop.signal,onProgress:p=>progress.push(p)}));
 // Attach rejection observation before abort; no wall-clock sleep or synthetic result.
 const rejected=assert.rejects(task);await settle(()=>holds.length===1);const count=progress.length;stop.abort();holds[0].resolve();await rejected;for(let i=0;i<8;i++)await Promise.resolve();assert.equal(progress.length,count);assert.equal(holds.length,1);
});
