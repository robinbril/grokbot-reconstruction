import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCloudEntries,cloudUnreadDivider} from '../cloud-history-state.js';
test('latest tail merges loaded older canonical entries without duplicating or losing revisions',()=>{
 const old=[{id:'a',historySeq:1,revision:1},{id:'b',historySeq:3,revision:2}];
 assert.deepEqual(mergeCloudEntries(old,[{id:'b',historySeq:3,revision:3},{id:'c',historySeq:7,revision:1}]).map(row=>[row.id,row.revision]),[['a',1],['b',3],['c',1]]);
 assert.equal(mergeCloudEntries([{id:'a',historySeq:1,revision:4}],[{id:'a',historySeq:1,revision:2}])[0].revision,4);
});
test('server first unread can reference a delivery outside all loaded pages',()=>{
 assert.deepEqual(cloudUnreadDivider({firstUnread:{entryId:'parent',messageId:'late-delivery',seq:18},unreadCount:2}),{id:'unread-divider',entryId:'late-delivery',parentEntryId:'parent',newMessageCount:2});
 assert.equal(cloudUnreadDivider({firstUnread:null,unreadCount:0}),null);
});
