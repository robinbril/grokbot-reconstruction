const writable=res=>!res.destroyed&&!res.writableEnded&&!res.writableFinished;
function firstAfter(events,sequence){
 let low=0,high=events.length;
 while(low<high){const middle=(low+high)>>>1;if(events[middle].seq<=sequence)low=middle+1;else high=middle;}
 return low;
}

// Durable events remain the replay queue. A blocked response owns at most its
// current write; subsequent notifications never copy another payload into it.
export function openEventStream({store,owner,conversationId,res,after,streams}){
 let cursor=after,blocked=false,closed=false,timer,unsubscribe=()=>{};
 const stream={end(){stop();if(writable(res))res.end();}};
 function stop(){
  if(closed)return;closed=true;unsubscribe();clearInterval(timer);streams.delete(stream);
  res.removeListener('drain',drain);
 }
 function finish(){stop();res.removeListener('close',finish);res.removeListener('finish',finish);res.removeListener('error',fail);}
 function fail(){stop();res.destroy();finish();}
 function pump(){
  if(closed)return;if(!writable(res)){stop();return;}if(blocked)return;
  const events=store.get(owner,conversationId).events;
  for(let index=firstAfter(events,cursor);index<events.length;index++){
   if(!writable(res)){stop();return;}
   const event=events[index];blocked=!res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);cursor=event.seq;
   if(blocked)return;
  }
 }
 function drain(){blocked=false;pump();}
 unsubscribe=store.subscribe(conversationId,pump);
 res.on('drain',drain);res.once('close',finish);res.once('finish',finish);res.once('error',fail);streams.add(stream);
 timer=setInterval(()=>{if(!writable(res)){stop();return;}if(!blocked)blocked=!res.write(': keepalive\n\n');},15000);timer.unref();
 if(!writable(res)){stop();return stream;}
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store',Connection:'keep-alive','X-Accel-Buffering':'no'});
 res.flushHeaders();pump();return stream;
}
