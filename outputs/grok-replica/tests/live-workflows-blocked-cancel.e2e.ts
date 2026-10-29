// Actual UI + production handler/store/runtime; explicit protocol fixture, no installed-model claim.
import {test,beforeEach,afterEach,type Browser} from '@e2e-dev/web';
import {expect} from 'e2e';
import {rename,realpath} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {startWorkflowProtocolServer} from './fixtures/live-workflows-server.mjs';
let protocol:Awaited<ReturnType<typeof startWorkflowProtocolServer>>;
beforeEach(async({browser})=>{protocol=await startWorkflowProtocolServer();await browser.goto(protocol.baseUrl);});
afterEach(async()=>{await protocol?.close();});
type QueueRow={id:string;status:string;runId?:string;payload:{text:string;attachmentRefs?:{attachmentId:string}[]};error?:{code:string}};
type Snapshot={conversationId:string;workspaceRoot:string;queue:QueueRow[];runs:{id:string;status:string}[];entries:{role:string;text:string}[]};
async function canonical(browser:Browser):Promise<Snapshot>{return browser.evaluate(async()=>{
 const saved=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=saved.liveHarness?.serverIds?.[saved.selected];if(!id)throw new Error('No canonical conversation');
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw new Error('Canonical GET '+response.status);return response.json();
});}

test('cancel blocked never-sent file head through UI releases healthy text successor',async({app,screen,browser})=>{
 await screen.getByRole('button','Marketing Agent',{exact:true}).click();await screen.getByRole('radio','Echte harness',{exact:true}).check();
 const input=screen.getByRole('textbox','Bericht sturen naar Bot',{exact:true});
 await input.fill('FIXTURE_DEFER BLOCKED_CANCEL_PREDECESSOR');await input.press('Enter');await expect.poll(async()=>(await canonical(browser)).runs[0]?.status,{timeout:60_000}).toBe('running');
 await browser.locator('#attachment-input').setInputFiles(['tests/fixtures/pipeline.txt']);await expect(browser.locator('[data-live-upload-state]')).toHaveText('Gereed');
 await input.fill('BLOCKED_CANCEL_FILE_HEAD');await screen.getByRole('button','In wachtrij',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).queue.length).toBe(1);
 await input.fill('BLOCKED_CANCEL_HEALTHY_SUCCESSOR');await screen.getByRole('button','In wachtrij',{exact:true}).click();await expect.poll(async()=>(await canonical(browser)).queue.length).toBe(2);
 const accepted=await canonical(browser),head=accepted.queue[0],successor=accepted.queue[1],attachmentId=head.payload.attachmentRefs?.[0]?.attachmentId;
 expect(head.status).toBe('queued');expect(successor.status).toBe('queued');expect(head.runId).toBeFalsy();expect(successor.payload.attachmentRefs).toBeUndefined();
 if(!attachmentId||!/^[-_a-zA-Z0-9]+$/.test(attachmentId)||!/^[-_a-zA-Z0-9]+$/.test(accepted.conversationId))throw new Error('Invalid owned fixture identity');
 // Derive only this fixture's generated directory from its canonical workspace.
 const workspace=await realpath(accepted.workspaceRoot),dataDir=path.dirname(path.dirname(workspace));
 expect(path.basename(path.dirname(workspace))).toBe('workspaces');expect(path.basename(workspace)).toBe(accepted.conversationId);expect(path.basename(dataDir).startsWith('live-workflows-ui-')).toBe(true);expect(path.dirname(dataDir)).toBe(await realpath(tmpdir()));
 const original=path.join(dataDir,'attachments',accepted.conversationId,attachmentId,'source'),aside=original+'.owned-blocked-cancel-aside';
 await rename(original,aside);
 try{
  await screen.getByRole('button','Stoppen',{exact:true}).first().click();
  await expect.poll(async()=>(await canonical(browser)).queue.find(row=>row.id===head.id)?.status,{timeout:60_000}).toBe('blocked');
  const blocked=await canonical(browser);expect(blocked.queue[0].error?.code).toBe('ATTACHMENT_UNAVAILABLE');expect(blocked.queue[0].runId).toBeFalsy();expect(blocked.queue[1].status).toBe('queued');expect(blocked.runs).toHaveLength(1);
  const cancel=screen.getByRole('region','Echte wachtrij',{exact:true}).getByRole('button','Annuleren: BLOCKED_CANCEL_FILE_HEAD',{exact:true});await expect(cancel).toBeVisible();
  await cancel.click();
  await expect.poll(async()=>(await canonical(browser)).queue.find(row=>row.id===head.id)?.status).toBe('cancelled');
  await expect.poll(async()=>{const state=await canonical(browser),row=state.queue.find(row=>row.id===successor.id);return state.runs.find(run=>run.id===row?.runId)?.status;},{timeout:60_000}).toBe('completed');
  const final=await canonical(browser);expect(final.queue).toHaveLength(2);expect(final.queue[0].id).toBe(head.id);expect(final.queue[0].runId).toBeFalsy();expect(final.queue[1].id).toBe(successor.id);expect(final.runs).toHaveLength(2);expect(final.entries.some(entry=>entry.role==='assistant'&&entry.text.includes('Protocol fixture output: BLOCKED_CANCEL_HEALTHY_SUCCESSOR'))).toBe(true);expect(final.entries.some(entry=>entry.role==='user'&&entry.text==='BLOCKED_CANCEL_FILE_HEAD')).toBe(false);await app.screenshot('blocked-head-cancel-releases-live-successor');
 }finally{await rename(aside,original);}
});
