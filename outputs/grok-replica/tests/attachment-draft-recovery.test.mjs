// Contract-level IndexedDB double; real byte/reload proof is in the browser E2e.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttachmentStore} from '../attachments.js';

function databaseFixture(t){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'indexedDB'),tables={files:new Map(),drafts:new Map()};let fail=false;
 const request=value=>{const result={result:value};queueMicrotask(()=>result.onsuccess?.());return result;};
 const db={close(){},transaction(names,mode){
  const selected=Array.isArray(names)?names:[names],pending=new Map(selected.map(name=>[name,new Map(tables[name])])),tx={};
  tx.objectStore=name=>({get:key=>request(pending.get(name).get(key)),getAll:()=>request([...pending.get(name).values()]),put(value){pending.get(name).set(value.key,value);}});
  tx.abort=()=>{tx.aborted=true;queueMicrotask(()=>tx.onabort?.());};
  setImmediate(()=>{if(tx.aborted)return;if(mode==='readwrite'&&fail){tx.onerror?.();return;}if(mode==='readwrite')for(const name of selected)tables[name]=pending.get(name);tx.oncomplete?.();});return tx;
 }};
 Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open:()=>request(db)}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'indexedDB',previous);else delete globalThis.indexedDB;});
 return {tables,set fail(value){fail=value;}};
}

test('recovery stages existing bytes durably but keeps consumed references hidden until metadata unlock',async t=>{
 const db=databaseFixture(t),store=createAttachmentStore({namespace:'own'});await store.ready;
 const [ref]=await store.add('marketing',[new File(['REAL_BYTES'],'proof.txt',{type:'text/plain'})]);await store.clear('marketing',[ref]);assert.deepEqual(store.list('marketing'),[]);
 await store.prepareRecovery('marketing',[ref]);assert.deepEqual(store.list('marketing'),[]);
 const reconstructed=createAttachmentStore({namespace:'own',consumedIds:[]});await reconstructed.ready;assert.deepEqual(reconstructed.list('marketing'),[ref]);assert.equal(await (await reconstructed.read(ref.id)).blob.text(),'REAL_BYTES');
 const stillConsumed=createAttachmentStore({namespace:'own',consumedIds:[ref.id]});await stillConsumed.ready;assert.deepEqual(stillConsumed.list('marketing'),[]);assert.ok(db.tables.files.has('own:'+ref.id));
});

test('missing, modified or foreign attachment metadata cannot stage recovery',async t=>{
 databaseFixture(t);const store=createAttachmentStore({namespace:'own'});await store.ready;const [ref]=await store.add('marketing',[new File(['bytes'],'proof.txt',{type:'text/plain'})]);await store.clear('marketing',[ref]);
 for(const changed of [{...ref,id:'missing'},{...ref,name:'other.txt'},{...ref,size:99},{...ref,type:'text/csv'},{...ref,namespace:'foreign'}])await assert.rejects(store.prepareRecovery('marketing',[changed]));
 const restored=createAttachmentStore({namespace:'own'});await restored.ready;assert.deepEqual(restored.list('marketing'),[]);
});

test('failed staging retains original consumed state and does not overwrite a newer visible attachment',async t=>{
 const db=databaseFixture(t),store=createAttachmentStore({namespace:'own'});await store.ready;const [ref]=await store.add('marketing',[new File(['old'],'old.txt',{type:'text/plain'})]);await store.clear('marketing',[ref]);
 const [newer]=await store.add('marketing',[new File(['new'],'new.txt',{type:'text/plain'})]);db.fail=true;await assert.rejects(store.prepareRecovery('marketing',[ref]));assert.deepEqual(store.list('marketing'),[newer]);
 db.fail=false;const restored=createAttachmentStore({namespace:'own',consumedIds:[ref.id]});await restored.ready;assert.deepEqual(restored.list('marketing'),[newer]);
});

test('an older store merges the latest durable draft instead of overwriting another store files',async t=>{
 databaseFixture(t);const older=createAttachmentStore({namespace:'own'});await older.ready;const [ref]=await older.add('marketing',[new File(['old'],'old.txt',{type:'text/plain'})]);await older.clear('marketing',[ref]);
 const newer=createAttachmentStore({namespace:'own',consumedIds:[ref.id]});await newer.ready;const [added]=await newer.add('marketing',[new File(['new'],'new.txt',{type:'text/plain'})]);assert.deepEqual(older.list('marketing'),[]);
 await older.prepareRecovery('marketing',[ref]);
 const restored=createAttachmentStore({namespace:'own',consumedIds:[ref.id]});await restored.ready;assert.deepEqual(restored.list('marketing'),[added]);assert.equal(await (await restored.read(added.id)).blob.text(),'new');
});

test('retired store cannot stage a recovery and duplicate preparations retain one exact reference',async t=>{
 databaseFixture(t);let current=true;const store=createAttachmentStore({namespace:'own',canPersist:()=>current});await store.ready;const [ref]=await store.add('marketing',[new File(['proof'],'proof.txt',{type:'text/plain'})]);await store.clear('marketing',[ref]);
 current=false;await assert.rejects(store.prepareRecovery('marketing',[ref]));const before=createAttachmentStore({namespace:'own'});await before.ready;assert.deepEqual(before.list('marketing'),[]);
 current=true;await Promise.all([store.prepareRecovery('marketing',[ref]),store.prepareRecovery('marketing',[ref])]);const after=createAttachmentStore({namespace:'own'});await after.ready;assert.deepEqual(after.list('marketing'),[ref]);
});

test('hidden staging from a failed cancellation does not consume the next recovery quota',async t=>{
 databaseFixture(t);const store=createAttachmentStore({namespace:'own'});await store.ready;
 const batch=prefix=>Array.from({length:10},(_,i)=>new File([prefix+i],prefix+i+'.txt',{type:'text/plain'}));
 const a=await store.add('marketing',batch('a'));await store.clear('marketing',a);const b=await store.add('marketing',batch('b'));await store.clear('marketing',b);
 await store.prepareRecovery('marketing',a);await store.prepareRecovery('marketing',b);
 assert.deepEqual(store.list('marketing'),[]);
 store.completeRecovery('marketing',b);assert.deepEqual(store.list('marketing'),b);
 const restored=createAttachmentStore({namespace:'own',consumedIds:a.map(ref=>ref.id)});await restored.ready;assert.deepEqual(restored.list('marketing'),b);
});

test('completion unlocks only staged files without resetting another conversation unsaved uploads',async t=>{
 databaseFixture(t);let allowed=true;const store=createAttachmentStore({namespace:'own',canPersist:()=>allowed});await store.ready;
 const [ref]=await store.add('marketing',[new File(['old'],'old.txt',{type:'text/plain'})]);await store.clear('marketing',[ref]);
 allowed=false;await assert.rejects(store.add('customers',[new File(['new'],'new.txt',{type:'text/plain'})]));allowed=true;
 const failed=store.failed('customers');assert.equal(failed.length,1);assert.throws(()=>store.completeRecovery('marketing',[ref]));
 await store.prepareRecovery('marketing',[ref]);store.completeRecovery('marketing',[ref]);assert.deepEqual(store.list('marketing'),[ref]);assert.deepEqual(store.failed('customers'),failed);
});
