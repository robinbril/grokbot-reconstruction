import http from 'node:http';
import https from 'node:https';
import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import {harnessError} from '../store.mjs';
const denied=()=>harnessError('OAUTH_NETWORK_DENIED','OAuth transport requires public HTTPS or literal loopback HTTP',403);
function publicAddress(address){
 const family=isIP(address);
 if(family===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===88&&c===99))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));}
 if(family===6){const normalized=new URL(`https://[${address}]/`).hostname.slice(1,-1).toLowerCase();return /^[23][0-9a-f]{3}:/.test(normalized)&&!/^2001:(?:[0-9a-f]{1,2}|1[0-9a-f]{2}|db8):/.test(normalized)&&!/^2002:/.test(normalized)&&!/^3fff:/.test(normalized);}
 return false;
}
async function destination(input,lookup){
 let url;try{url=new URL(input);}catch{throw denied();}if(url.username||url.password||url.hash)throw denied();const hostname=url.hostname.replace(/^\[|\]$/g,'');
 if(url.protocol==='http:'){if(!/^http:\/\/(127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(String(input))||!['127.0.0.1','::1'].includes(hostname))throw denied();return {url,hostname,address:hostname,family:isIP(hostname)};}
 if(url.protocol!=='https:')throw denied();
 const answers=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await lookup(hostname,{all:true,verbatim:true});
 if(!Array.isArray(answers)||!answers.length||answers.some(answer=>!publicAddress(answer.address)))throw denied();
 const selected=answers[0];return {url,hostname,address:selected.address,family:isIP(selected.address)};
}
async function boundedDestination(input,lookup,signal){
 signal.throwIfAborted();let rejectAbort;const aborted=new Promise((resolve,reject)=>{rejectAbort=()=>reject(signal.reason);signal.addEventListener('abort',rejectAbort,{once:true});});
 try{return await Promise.race([destination(input,lookup),aborted]);}finally{signal.removeEventListener('abort',rejectAbort);}
}
export function createOAuthFetch({lookup=dnsLookup}={}){return async(input,options={})=>{
 const timeoutMs=options.timeoutMs??15000;if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw harnessError('OAUTH_INPUT_INVALID','Invalid transport timeout');
 if(options.body!==undefined&&typeof options.body!=='string'&&!ArrayBuffer.isView(options.body))throw harnessError('OAUTH_INPUT_INVALID','Unsupported OAuth request body');
 const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
 const target=await boundedDestination(input,lookup,signal),{url,hostname,address,family}=target,headers=new Headers(options.headers);headers.set('accept-encoding','identity');headers.set('host',url.host);
 return new Promise((resolve,reject)=>{
  const request=(url.protocol==='https:'?https:http).request(url,{method:options.method??'GET',headers:Object.fromEntries(headers),signal,lookup:(_name,lookupOptions,callback)=>lookupOptions.all?callback(null,[{address,family}]):callback(null,address,family),...(url.protocol==='https:'?{servername:isIP(hostname)?undefined:hostname,rejectUnauthorized:true}:{})},response=>{
   const encoding=response.headers['content-encoding'];if(encoding&&encoding!=='identity'){response.destroy();reject(harnessError('OAUTH_PROVIDER_ERROR','Compressed OAuth responses are unsupported',502));return;}
   const responseHeaders=new Headers();for(let i=0;i<response.rawHeaders.length;i+=2)responseHeaders.append(response.rawHeaders[i],response.rawHeaders[i+1]);
   const status=response.statusCode??502;if(options.redirect==='error'&&status>=300&&status<400){response.destroy();reject(harnessError('OAUTH_REDIRECT_DENIED','OAuth endpoint redirects are not allowed',502));return;}
   const empty=[204,205,304].includes(status)||options.method==='HEAD';if(empty)response.resume();
   resolve(new Response(empty?null:Readable.toWeb(response),{status,headers:responseHeaders}));
  });request.once('error',reject);if(options.body!==undefined)request.write(options.body);request.end();
 });
};}
export const secureOAuthFetch=createOAuthFetch();
