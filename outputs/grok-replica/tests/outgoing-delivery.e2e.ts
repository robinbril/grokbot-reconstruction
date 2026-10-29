import {expectComposerText} from './fixtures/composer-assertions';
import {expectOriginalJump} from './fixtures/transcript-navigation-assertions';
// Scripted inference only. All tools, persistence, file bytes, HTTP and UI are production paths.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {randomUUID,createHash} from 'node:crypto';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
const csv='label,value\nsynthetic,42\n',caption='Synthetic <report> & exact caption';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>,releaseStream:()=>void=()=>{};
type Context={current_input_message_id:string;workspace_file_url_prefix:string;reply_targets:{message_id:string;role:string;text:string}[]};
function deliveryModel(){
 const steps=new Map<string,number>();
 return {status:()=>({state:'ready',provider:'synthetic-delivery-fixture',model:'synthetic-delivery-fixture',modelExecution:'synthetic'}),async complete({messages,signal,onEvent}:{messages:{role:string;content:string}[];signal:AbortSignal;onEvent:(event:{type:string;callId:string;text:string})=>Promise<void>}){
  signal.throwIfAborted();
  const raw=messages.findLast(message=>message.role==='system'&&typeof message.content==='string'&&message.content.startsWith('Local delivery context:\n'))?.content;
  if(!raw)throw new Error('Missing authoritative local delivery context');
  const context:Context=JSON.parse(raw.slice('Local delivery context:\n'.length)),step=steps.get(context.current_input_message_id)||0;steps.set(context.current_input_message_id,step+1);
  const previous=context.reply_targets.find(target=>target.role==='assistant'&&target.text===caption);
  const call=(name:string,args:unknown)=>({text:'',toolCalls:[{id:randomUUID(),name,arguments:args}]});
  if(previous){
   const id=randomUUID();await onEvent({type:'message.delta',callId:id,text:'Exact follow-up '});
   await new Promise<void>((resolve,reject)=>{releaseStream=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
   await onEvent({type:'message.delta',callId:id,text:'to the attached report.'});
   return {text:'',toolCalls:[{id,name:'SendMessage',arguments:{text:{content:'Exact follow-up to the attached report.'},reply_to:previous.message_id}}]};
  }
  if(step===0)return call('workspace_write',{path:'report.csv',content:csv});
  return call('SendMessage',{attachment:{url:context.workspace_file_url_prefix+'report.csv',alt:caption},reply_to:context.current_input_message_id});
 }};
}
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer({port:18877,model:deliveryModel()});await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
async function canonical(browser:Browser){return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];
 if(!id)throw new Error('No live identity');const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw new Error('Snapshot failed');return response.json();
});}

test('outgoing file-only delivery downloads exact owned bytes and quotes jump across reload in both themes',async({app,screen,browser,agent})=>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill('Create the synthetic report.');
 await agent.act('Send the draft Create the synthetic report. using Bericht sturen.');
 await expect(screen.getByRole('link','Bijlage bewaren: report.csv',{exact:true})).toBeVisible({timeout:60_000});
 await expect(browser.locator('[data-live-run-label]')).toHaveText('Voltooid');
 let state=await canonical(browser);const output=state.entries.find((entry:{role:string})=>entry.role==='assistant'),delivery=output.messages[0],input=state.entries.find((entry:{role:string})=>entry.role==='user');
 expect(output.text).toBe('');expect(delivery.type).toBe('attachment');expect(delivery.replyTo.messageId).toBe(input.id);expect(delivery.attachment.size).toBe(Buffer.byteLength(csv));expect(delivery.attachment.sha256).toBe(createHash('sha256').update(csv).digest('hex'));
 await expect(browser.locator('[data-live-attachment-alt]')).toHaveText(caption);await expect(browser.locator('[data-live-attachment-alt] img')).toHaveCount(0);await expect(browser.locator('[data-live-message-id] > [data-chat-entry-id][hidden]')).toBeHidden();
 const href=await screen.getByRole('link','Bijlage bewaren: report.csv',{exact:true}).getAttribute('href');expect(href).toBe(`/api/harness/conversations/${state.conversationId}/attachments/${delivery.attachment.attachmentId}/download`);
 const download=await browser.waitForDownload(()=>screen.getByRole('link','Bijlage bewaren: report.csv',{exact:true}).click());expect(download.suggestedFilename).toBe('report.csv');const bytes=Buffer.from(await browser.evaluate(async()=>{const link=document.querySelector<HTMLAnchorElement>('[data-live-attachment-download]');if(!link)throw new Error('Missing download');const response=await fetch(link.href);if(!response.ok)throw new Error('Download failed');return [...new Uint8Array(await response.arrayBuffer())];}));expect(bytes.toString()).toBe(csv);expect(createHash('sha256').update(bytes).digest('hex')).toBe(delivery.attachment.sha256);
 await agent.act('Open the attached report.csv using Bijlage openen: report.csv.');
 await expect(screen.getByRole('dialog','report.csv',{exact:true})).toBeVisible();
 await expect(browser.locator('.live-file-table')).toHaveText('label value synthetic 42');
 await expect(screen.getByRole('link','Downloaden',{exact:true})).toHaveAttribute('href',href);
 await screen.getByRole('button','Sluiten',{exact:true}).click();await expect(screen.getByRole('dialog','report.csv',{exact:true})).not.toBeVisible();
 await expectOriginalJump(browser,screen.getByRole('button','Naar oorspronkelijk bericht',{exact:true}),`[data-message-id="${input.id}"]`);
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill('Reply to the report.');await screen.getByRole('button','Bericht sturen',{exact:true}).click();
 await expect(browser.locator('.transcript')).toContainText('Exact follow-up');
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill('Preserved draft');
 await browser.evaluate(()=>{const node=Array.from(document.querySelectorAll('.live-delivery .chat-content')).at(-1);Object.assign(window,{deliveryStreamNode:node,deliveryStreamFrame:node?.firstElementChild});document.querySelector<HTMLElement>('#message-input')?.focus();});
 releaseStream();await expect(browser.locator('[data-live-message-id]').last()).toContainText('Exact follow-up to the attached report.');
 expect(await browser.evaluate(()=>{const saved=window as typeof window&{deliveryStreamNode?:Element;deliveryStreamFrame?:Element};const node=Array.from(document.querySelectorAll('.live-delivery .chat-content')).at(-1);return node===saved.deliveryStreamNode&&node?.firstElementChild===saved.deliveryStreamFrame;})).toBe(true);
 await expectComposerText(browser,'Preserved draft');expect(await browser.evaluate(()=>document.activeElement?.id)).toBe('message-input');state=await canonical(browser);const final=state.entries.filter((entry:{role:string})=>entry.role==='assistant').at(-1).messages[0];expect(final.replyTo.messageId).toBe(delivery.id);
 await expectOriginalJump(browser,screen.getByRole('button','Naar oorspronkelijk bericht',{exact:true}).last(),`[data-live-message-id="${delivery.id}"]`);
 for(const theme of ['light','dark']){
  await screen.getByRole('button','Accountmenu',{exact:true}).click();await screen.getByRole('menuitem','Instellingen',{exact:true}).click();await screen.getByRole('combobox','Thema',{exact:true}).selectOption({value:theme});await screen.getByRole('button','Sluiten',{exact:true}).click();await browser.reload();
  await expect(browser.locator('html')).toHaveAttribute('data-theme',theme);await expect(screen.getByRole('link','Bijlage bewaren: report.csv',{exact:true})).toBeVisible();await expect(browser.locator('[data-live-attachment-alt]')).toHaveText(caption);await expect(browser.locator('[data-live-message-id]')).toHaveCount(2);
  await expect(screen.getByRole('button','Naar oorspronkelijk bericht',{exact:true}).last()).toContainText(caption);await expectOriginalJump(browser,screen.getByRole('button','Naar oorspronkelijk bericht',{exact:true}).last(),`[data-live-message-id="${delivery.id}"]`);
  await app.screenshot('outgoing-delivery-'+theme);
 }
});
