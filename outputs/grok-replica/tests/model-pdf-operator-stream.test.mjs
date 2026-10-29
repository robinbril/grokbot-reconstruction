import test from 'node:test';
import assert from 'node:assert/strict';
test('operator audit rejects renderer version drift and preserves streams and cancellation',async()=>{
 const {auditPdfOperatorStreams}=await import('../harness/pdf-operator-stream.mjs');
 const cancelled=[],handler={sendWithStream(name){if(name!=='GetOperatorList')return 'untouched';return new ReadableStream({pull(controller){controller.enqueue('chunk');},cancel(reason){cancelled.push(reason);}});}};
 const original=handler.sendWithStream,document={_transport:{messageHandler:handler}};
 assert.throws(()=>auditPdfOperatorStreams(document,'future-version'),/compatibility/);assert.equal(handler.sendWithStream,original);
 const audit=auditPdfOperatorStreams(document,'6.4.299');assert.equal(handler.sendWithStream('GetTextContent'),'untouched');
 const reader=handler.sendWithStream('GetOperatorList').getReader();assert.deepEqual(await reader.read(),{done:false,value:'chunk'});await reader.cancel('synthetic cancellation');await audit.assertHealthy();assert.deepEqual(cancelled,['synthetic cancellation']);audit.restore();assert.equal(handler.sendWithStream,original);
});
test('operator audit sees the upstream error even when a consumer ignores its rejection',async()=>{
 const {auditPdfOperatorStreams}=await import('../harness/pdf-operator-stream.mjs');
 const handler={sendWithStream:()=>new ReadableStream({start(controller){controller.error(new Error('synthetic parse failure'));}})},audit=auditPdfOperatorStreams({_transport:{messageHandler:handler}},'6.4.299');
 await handler.sendWithStream('GetOperatorList').getReader().read().catch(()=>{});
 await assert.rejects(audit.assertHealthy(),/synthetic parse failure/);audit.restore();
});

test('operator audit rejects an upstream stream failure with an empty reason',async()=>{
 const {auditPdfOperatorStreams}=await import('../harness/pdf-operator-stream.mjs');
 const handler={sendWithStream:()=>new ReadableStream({start(controller){controller.error();}})},audit=auditPdfOperatorStreams({_transport:{messageHandler:handler}},'6.4.299');
 await handler.sendWithStream('GetOperatorList').getReader().read().catch(()=>{});
 await assert.rejects(audit.assertHealthy(),/operator stream failed/);audit.restore();
});

test('two documents keep independent errors, cancellation and exact method restoration',async()=>{
 const {auditPdfOperatorStreams}=await import('../harness/pdf-operator-stream.mjs');
 const reason='cancel second document',cancelled=[];
 const first={sendWithStream:()=>new ReadableStream({start(controller){controller.error(new Error('first document failed'));}})};
 const second={sendWithStream:()=>new ReadableStream({pull(controller){controller.enqueue('second document data');},cancel(value){cancelled.push(value);}})};
 const originalFirst=Object.getOwnPropertyDescriptor(first,'sendWithStream'),originalSecond=Object.getOwnPropertyDescriptor(second,'sendWithStream');
 const a=auditPdfOperatorStreams({_transport:{messageHandler:first}},'6.4.299'),b=auditPdfOperatorStreams({_transport:{messageHandler:second}},'6.4.299');
 const firstReader=first.sendWithStream('GetOperatorList').getReader(),secondReader=second.sendWithStream('GetOperatorList').getReader();
 await firstReader.read().catch(()=>{});assert.equal((await secondReader.read()).value,'second document data');
 await assert.rejects(a.assertHealthy(),/first document failed/);a.restore();assert.deepEqual(Object.getOwnPropertyDescriptor(first,'sendWithStream'),originalFirst);
 assert.notEqual(second.sendWithStream,originalSecond.value);await secondReader.cancel(reason);await b.assertHealthy();b.restore();
 assert.deepEqual(cancelled,[reason]);assert.deepEqual(Object.getOwnPropertyDescriptor(second,'sendWithStream'),originalSecond);
});
test('operator audit forwards every chunk in order and restores inherited methods',async()=>{
 const {auditPdfOperatorStreams}=await import('../harness/pdf-operator-stream.mjs');
 let pulls=0;const original=function(){return new ReadableStream({pull(controller){if(++pulls<=2)controller.enqueue(pulls);else controller.close();}});};
 const handler=Object.create({sendWithStream:original}),audit=auditPdfOperatorStreams({_transport:{messageHandler:handler}},'6.4.299');
 const reader=handler.sendWithStream('GetOperatorList').getReader();assert.deepEqual(await reader.read(),{done:false,value:1});assert.deepEqual(await reader.read(),{done:false,value:2});assert.deepEqual(await reader.read(),{done:true,value:undefined});
 await audit.assertHealthy();audit.restore();assert.equal(Object.hasOwn(handler,'sendWithStream'),false);assert.equal(handler.sendWithStream,original);
});

test('cancelling a pending read forwards cancellation without inventing a controller error',async()=>{
 const {auditPdfOperatorStreams}=await import('../harness/pdf-operator-stream.mjs');
 const cancelled=[],handler={sendWithStream:()=>new ReadableStream({pull(){return new Promise(()=>{});},cancel(reason){cancelled.push(reason);}})},audit=auditPdfOperatorStreams({_transport:{messageHandler:handler}},'6.4.299');
 const reader=handler.sendWithStream('GetOperatorList').getReader(),pending=reader.read();await Promise.resolve();await reader.cancel('stop pending document');await pending;
 await audit.assertHealthy();audit.restore();assert.deepEqual(cancelled,['stop pending document']);
});
