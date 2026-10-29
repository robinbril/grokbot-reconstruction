import test from 'node:test';
import assert from 'node:assert/strict';
import {startHarness} from './fixtures/harness-http.mjs';

test('HTTP provider catalog exposes callback/setup and provider start rejects client-controlled endpoints',async t=>{
 const app=await startHarness();t.after(()=>app.close());const client=await app.client();
 const catalog=await client.request('/accounts/providers');assert.equal(catalog.status,200);assert.deepEqual(catalog.value.providers.map(p=>p.id),['github','notion']);
 assert.equal(catalog.value.providers[0].callbackUrl,app.baseUrl+'/api/harness/oauth/callback');assert.ok(!JSON.stringify(catalog.value).includes('clientSecret'));
 const override=await client.request('/accounts/providers/notion/start',{method:'POST',body:{requestId:'preset-override',resourceUrl:'https://evil.example/mcp'}});assert.equal(override.status,422);assert.equal(override.value.error.code,'OAUTH_PROVIDER_INPUT_INVALID');
 const unknown=await client.request('/accounts/providers/unknown/start',{method:'POST',body:{requestId:'unknown-provider'}});assert.equal(unknown.status,404);assert.equal(unknown.value.error.code,'OAUTH_PROVIDER_UNKNOWN');
 const other=await app.client();assert.deepEqual((await other.request('/accounts')).value.pendingFlows,[]);
});
