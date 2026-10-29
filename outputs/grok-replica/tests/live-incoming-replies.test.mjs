import test from 'node:test';
import assert from 'node:assert/strict';
import {liveReplyDraft,liveReplyPayload} from '../live-incoming-replies.js';
import {projectLiveMessages} from '../live-harness-model.js';
const snapshot={conversationId:'owned',entries:[{id:'user-one',role:'user',status:'completed',text:'same'},{id:'out',role:'assistant',status:'completed',text:'same\nsame',messages:[{id:'first',callId:'a',type:'text',content:'same'},{id:'second',callId:'b',type:'text',content:'same'}]}],tools:[{name:'SendMessage',runId:'run',callId:'a',status:'completed'},{name:'SendMessage',runId:'run',callId:'b',status:'completed'}]};
snapshot.entries[1].runId='run';
test('reply selection identifies duplicate text by exact confirmed message identity',()=>{
 assert.equal(liveReplyDraft(snapshot,{entryId:'out',messageId:'first'}).replyToId,'first');
 assert.equal(liveReplyDraft(snapshot,{entryId:'out',messageId:'second'}).replyToId,'second');
 assert.throws(()=>liveReplyDraft(snapshot,{entryId:'out'}),/bericht/);
 const draft=liveReplyDraft(snapshot,{entryId:'user-one'});assert.equal(draft.messageId,'user-one');
 assert.deepEqual(liveReplyPayload(snapshot,JSON.parse(JSON.stringify(draft))),{replyToId:'user-one'});
});
test('canonical replies refuse changed conversation, missing and unconfirmed targets',()=>{
 const draft=liveReplyDraft(snapshot,{entryId:'out',messageId:'second'});
 assert.throws(()=>liveReplyPayload({...snapshot,conversationId:'other'},draft));
 assert.throws(()=>liveReplyPayload({...snapshot,entries:[]},draft));
 assert.throws(()=>liveReplyDraft({...snapshot,tools:[]},{entryId:'out',messageId:'second'}));
 assert.throws(()=>liveReplyPayload(snapshot,{...draft,messageId:'first'}));
 assert.deepEqual(liveReplyPayload(snapshot,{messageId:'local-legacy',title:'Old',text:'quote'}),{});
});
test('server snapshot projects durable canonical user reply for quote and jump after reload',()=>{
 const replyTo={messageId:'second',entryId:'out',role:'assistant',text:'same'};
 const messages=projectLiveMessages({...snapshot,runs:[],entries:[...snapshot.entries,{id:'reply',role:'user',status:'completed',text:'answer',replyTo}],tools:[]});
 assert.deepEqual(messages.find(message=>message.id==='reply').quote,{messageId:'second',replyToId:'second',entryId:'out',serverConversationId:'owned',title:'Bot',text:'same'});
});
