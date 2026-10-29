import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelProvider} from '../harness/model-provider.mjs';

test('the default provider remains direct xAI without silently using a seat',()=>{
 const model=createModelProvider({env:{}});
 assert.equal(model.status().provider,'xai');
 assert.equal(model.status().state,'unavailable');
});
test('an explicit Claude seat uses the independent product harness contract',()=>{
 const model=createModelProvider({env:{GROK_MODEL_PROVIDER:'claude-seat',CLAUDE_MODEL:'claude-sonnet-5-5',CLAUDE_BINARY:'/nonexistent/claude'}});
 assert.equal(model.status().provider,'claude-seat');
 assert.equal(model.status().adapter,'grok-bot-harness');
 assert.equal(model.status().state,'unavailable');
});
test('unknown providers fail explicitly instead of falling back to another account',()=>{
 assert.throws(()=>createModelProvider({env:{GROK_MODEL_PROVIDER:'unknown'}}),{code:'MODEL_PROVIDER_INVALID'});
});
