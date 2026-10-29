import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveHarnessClient} from '../live-harness-client.js';
for(const accepted of [false,undefined])test('client preserves '+(accepted===false?'explicit preaccept rejection':'uncertain delivery without inventing rejection'),async()=>{
 const client=createLiveHarnessClient({fetchImpl:async path=>new Response(JSON.stringify(path.endsWith('/status')?{csrfToken:'synthetic-test'}:{error:{code:'ATTACHMENT_MODEL_UNSUPPORTED',message:'Synthetic model input rejection',retryable:false,...(accepted===false?{accepted:false}:{})}}),{status:path.endsWith('/status')?200:422,headers:{'Content-Type':'application/json'}})});
 await assert.rejects(client.start('owned',{requestId:'synthetic-request',text:'Retain me'}),error=>error.accepted===accepted&&error.retryable===false);
});
