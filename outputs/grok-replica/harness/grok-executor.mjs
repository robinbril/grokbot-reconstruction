import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

const quote=value=>JSON.stringify(value);
function sandboxProfile(workspace){
 return `(version 1)
(deny default)
(allow process-exec process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read mach-lookup)
(allow syscall* mach-bootstrap)
(allow file-read-metadata)
; libignition needs a root directory handle for openat; descendants stay denied.
(allow file-read-data (literal "/"))
(allow file-read* file-map-executable (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library") (subpath "/private/var/db/dyld") (subpath "/private/var/db/oah") (subpath "/dev") (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") (subpath ${quote(workspace)}))
(allow file-write* (subpath ${quote(workspace)}) (literal "/dev/null"))`;
}
function runChild(child,{signal,onOutput,timeoutMs,outputLimit}){
 return new Promise((resolve,reject)=>{
  let stdout='',stderr='',bytes=0,problem,timer,killTimer,outputTail=Promise.resolve();
  const terminate=error=>{
   if(problem)return;
   problem=error;
   try{process.kill(-child.pid,'SIGTERM');}catch{}
   killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},250);
   killTimer.unref();
  };
  const abort=()=>terminate(signal.reason??new Error('Terminal aborted'));
  const consume=(stream,chunk)=>{
   const remaining=Math.max(0,outputLimit-bytes),piece=chunk.subarray(0,remaining).toString('utf8');
   bytes+=chunk.length;
   if(stream==='stdout')stdout+=piece;else stderr+=piece;
   if(piece&&onOutput)outputTail=outputTail.then(()=>onOutput({stream,text:piece})).catch(error=>terminate(error));
   if(bytes>outputLimit)terminate(new Error('Terminal output limit exceeded'));
  };
  child.stdout.on('data',chunk=>consume('stdout',chunk));
  child.stderr.on('data',chunk=>consume('stderr',chunk));
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>terminate(new Error('Terminal timed out')),timeoutMs);
  child.once('error',error=>{problem=error;});
  child.once('close',async(exitCode,exitSignal)=>{
   await outputTail;
   clearTimeout(timer);clearTimeout(killTimer);
   try{process.kill(-child.pid,'SIGKILL');}catch{}
   signal?.removeEventListener('abort',abort);
   if(problem)reject(problem);else resolve({stdout,stderr,exitCode:exitCode??128,signal:exitSignal});
  });
  if(signal?.aborted)abort();
 });
}
export function createGrokExecutor({platform=process.platform,sandboxPath='/usr/bin/sandbox-exec',timeoutMs=120000,outputLimit=1024*1024}={}){
 return {async start({workspace,command,signal,onOutput}={}){
  if(platform!=='darwin')throw new Error('Native macOS sandbox is unavailable; terminal execution is disabled');
  try{await fs.access(sandboxPath,fs.constants.X_OK);}catch{throw new Error('Native macOS sandbox is unavailable; terminal execution is disabled');}
  if(typeof command!=='string'||!command.trim()||command.length>16384)throw new Error('Invalid terminal command');
  signal?.throwIfAborted();
  const root=await fs.realpath(workspace),temporary=path.join(root,'.tmp');
  await fs.mkdir(temporary,{recursive:true,mode:0o700});
  const entry=await fs.lstat(temporary);
  if(entry.isSymbolicLink()||await fs.realpath(temporary)!==temporary)throw new Error('Unsafe terminal temporary directory');
  const child=spawn(sandboxPath,['-p',sandboxProfile(root),'/bin/zsh','-f','-c',command],{
   cwd:root,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:root,TMPDIR:temporary,TMPPREFIX:path.join(temporary,'zsh'),LANG:'en_US.UTF-8'},
   detached:true,stdio:['ignore','pipe','pipe'],
  });
  return runChild(child,{signal,onOutput,timeoutMs:Math.min(timeoutMs,120000),outputLimit});
 }};
}
