const failure=message=>Object.assign(new Error(message),{code:'ATTACHMENT_CONTENT_INVALID'});
// pdfjs6.4.299 resolves partial operator/render promises before rejecting their
// stream errors. Observe the owned stream upstream, without patching the vendor.
export function auditPdfOperatorStreams(document,version){
 const handler=document?._transport?.messageHandler;
 if(version!=='6.4.299'||typeof handler?.sendWithStream!=='function')throw failure('PDF renderer error-audit compatibility is unavailable');
 const descriptor=Object.getOwnPropertyDescriptor(handler,'sendWithStream'),original=handler.sendWithStream,records=[];
 function intercepted(name,...args){
  const stream=Reflect.apply(original,this,[name,...args]);
  if(name!=='GetOperatorList')return stream;
  if(typeof stream?.getReader!=='function')throw failure('PDF renderer returned an invalid operator stream');
  const reader=stream.getReader(),completion=Promise.withResolvers(),saved={error:null,failed:false,cancelled:false,done:completion.promise};records.push(saved);
  return new ReadableStream({
   async pull(controller){
    try{
     const result=await reader.read();if(saved.cancelled)return;
     if(result.done){completion.resolve();controller.close();}else controller.enqueue(result.value);
    }catch(error){if(saved.cancelled)return;saved.error=error;saved.failed=true;completion.resolve();controller.error(error);}
   },
   async cancel(reason){saved.cancelled=true;try{await reader.cancel(reason);}finally{completion.resolve();}}
  });
 }
 Object.defineProperty(handler,'sendWithStream',{value:intercepted,writable:true,configurable:true});
 return {
  async assertHealthy(){
   await Promise.all(records.map(record=>record.done));const failed=records.find(record=>record.failed);
   if(failed)throw failure('PDF page parsing failed; no partial content was accepted: '+String(failed.error?.message||'operator stream failed').slice(0,1000));
  },
  restore(){if(descriptor)Object.defineProperty(handler,'sendWithStream',descriptor);else delete handler.sendWithStream;}
 };
}
