import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createGrokExecutor} from '../harness/grok-executor.mjs';

const nativeOnly={skip:process.platform!=='darwin'};
const details=result=>JSON.stringify(result);
async function temporaryDirectory(t,prefix){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),prefix));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 return directory;
}

test('terminal fails closed without the native macOS sandbox',async()=>{
 await assert.rejects(createGrokExecutor({sandboxPath:'/nonexistent/sandbox-exec'}).start({workspace:os.tmpdir(),command:'true'}),/sandbox/i);
});
test('real native sandbox starts the shell and permits workspace writes',nativeOnly,async t=>{
 const workspace=await temporaryDirectory(t,'grok-terminal-');
 const output=[];
 const result=await createGrokExecutor().start({workspace,command:'echo good > proof; echo reached',onOutput:chunk=>output.push(chunk)});
 assert.equal(result.signal,null,details(result));
 assert.equal(result.exitCode,0,details(result));
 assert.equal(await fs.readFile(path.join(workspace,'proof'),'utf8'),'good\n');
 assert.equal(result.stdout,'reached\n');
 assert.deepEqual(output,[{stream:'stdout',text:'reached\n'}]);
});
test('real native sandbox denies outside reads and writes',nativeOnly,async t=>{
 const workspace=await temporaryDirectory(t,'grok-terminal-');
 const outside=await temporaryDirectory(t,'grok-outside-');
 await fs.writeFile(path.join(outside,'secret'),'synthetic-private-data');
 const executor=createGrokExecutor();
 const read=await executor.start({workspace,command:`cat '${outside}/secret'`});
 assert.equal(read.signal,null,details(read));
 assert.notEqual(read.exitCode,0,details(read));
 assert.ok(!read.stdout.includes('synthetic-private-data'),details(read));
 assert.match(read.stderr,/operation not permitted|permission denied/i);
 const write=await executor.start({workspace,command:`echo bad > '${outside}/escaped'`});
 assert.equal(write.signal,null,details(write));
 assert.notEqual(write.exitCode,0,details(write));
 assert.match(write.stderr,/operation not permitted|permission denied/i);
 await assert.rejects(fs.access(path.join(outside,'escaped')),{code:'ENOENT'});
});
test('real native sandbox denies network to a reachable owned listener',nativeOnly,async t=>{
 const workspace=await temporaryDirectory(t,'grok-terminal-');
 let connections=0;
 const server=http.createServer((request,response)=>response.end('synthetic-local-service'));
 server.on('connection',()=>connections++);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const url=`http://127.0.0.1:${server.address().port}`;
 const checkListener=()=>new Promise((resolve,reject)=>{
  http.get(url,{agent:false},response=>{response.resume();response.on('end',resolve);}).on('error',reject);
 });
 await checkListener();
 assert.equal(connections,1);
 const result=await createGrokExecutor().start({workspace,command:`/usr/bin/curl --noproxy '*' --max-time 2 '${url}'`});
 assert.equal(result.signal,null,details(result));
 assert.notEqual(result.exitCode,0,details(result));
 assert.ok(!result.stdout.includes('synthetic-local-service'),details(result));
 assert.equal(connections,1,'sandboxed command must not connect to the listening server');
 await checkListener();
 assert.equal(connections,2,'listener remains reachable outside the child sandbox');
});
