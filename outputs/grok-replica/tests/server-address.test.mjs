import test from 'node:test';import assert from 'node:assert/strict';
import {serverAddress} from '../harness/server-address.mjs';
test('default startup stays loopback and remote public origins require explicit HTTPS',()=>{
 assert.deepEqual(serverAddress({}),{port:8765,bindHost:'127.0.0.1',publicOrigin:'http://127.0.0.1:8765'});
 assert.throws(()=>serverAddress({GROK_BIND_HOST:'0.0.0.0'}),/HTTPS/);
 assert.throws(()=>serverAddress({GROK_PUBLIC_ORIGIN:'http://example.com'}),/HTTPS/);
 assert.deepEqual(serverAddress({PORT:'8878',GROK_BIND_HOST:'0.0.0.0',GROK_PUBLIC_ORIGIN:'https://app.example.com'}),{port:8878,bindHost:'0.0.0.0',publicOrigin:'https://app.example.com'});
});
test('origin config rejects credentials paths and malformed ports',()=>{
 for(const GROK_PUBLIC_ORIGIN of ['https://user:secret@example.com','https://example.com/path','https://example.com/?x=1'])assert.throws(()=>serverAddress({GROK_PUBLIC_ORIGIN}));
 for(const PORT of ['0','65536','NaN'])assert.throws(()=>serverAddress({PORT}));
});
