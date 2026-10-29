export function serverAddress(env){
 const port=Number(env.PORT??8765),bindHost=env.GROK_BIND_HOST||'127.0.0.1';
 if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('PORT must be between1 and65535');
 if(!['127.0.0.1','0.0.0.0','::1','::'].includes(bindHost))throw Error('GROK_BIND_HOST must be an explicit local listening address');
 const origin=new URL(env.GROK_PUBLIC_ORIGIN||`http://127.0.0.1:${port}`);
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('GROK_PUBLIC_ORIGIN must contain only the public origin');
 const loopback=['127.0.0.1','[::1]','localhost'].includes(origin.hostname),privateBind=['127.0.0.1','::1'].includes(bindHost);
 if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&loopback&&privateBind))throw Error('A shared server requires an explicit HTTPS GROK_PUBLIC_ORIGIN and a TLS reverse proxy');
 return {port,bindHost,publicOrigin:origin.origin};
}
