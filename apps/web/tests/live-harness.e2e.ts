import {expectComposerText} from './fixtures/composer-assertions';
// Real CLI/MCP/browser work. Fault cases intercept transport only, never fabricate completion.
import {test,afterEach} from '@e2e-dev/web';
import {expect} from 'e2e';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {grokToolName} from '../harness/grok-mcp-client.mjs';

const fixture=fileURLToPath(new URL('./fixtures/harness-math-mcp.mjs',import.meta.url));
const terminalCommand="printf 'LIVE_APPROVAL_TERMINAL_OK\\n'";
const mathTool=grokToolName('custom_math_proof','sum');
const active=['accepted','starting','running','waiting_approval','cancelling'];
async function boot(app:any,screen:any,browser:any){
 await app.open('/?reset=1');
 await browser.evaluate(async()=>{await (window as any).productSurfaces.ready;history.replaceState(null,'','/');});
 await screen.getByRole('button','Marketing Agent').click();
}
async function live(agent:any,screen:any,browser:any){
 // Verify a real connection first so the agent sees the same provider state on cold and warm servers.
 // The pending initial snapshot in the race case stays held throughout this UI preflight.
 await screen.getByRole('radio','Echte harness').check();await openComputer(screen);
 await screen.getByRole('button','Harness verbinden').click();
 const status=await browser.evaluate(async()=>fetch('/api/harness/status').then(response=>response.json()));
 expect(status.runtime.adapter).toBe('grok-bot-harness');expect(status.runtime.state).toBe('ready');
 expect(['xai','claude-seat']).toContain(status.runtime.provider);expect(status.runtime.model).toBeTruthy();
 const connectedLabel='Grok Bot-harness'+(status.runtime.provider==='xai'?' · xAI':'')+' · '+status.runtime.model+' · Verbonden';
 await expect(browser.locator('[data-live-connection]')).toHaveText(connectedLabel,{timeout:120_000});
 await screen.getByRole('tab','Tools').click();
 await expect(screen.getByRole('heading','Grok workspace connected')).toBeVisible({timeout:120_000});
 const state=await canonical(browser);expect(state.servers.find((server:any)=>server.id==='grok_workspace')?.state).toBe('connected');expect(state.runs).toHaveLength(0);
 await screen.getByRole('tab','Terminal').click();await screen.getByRole('button','Details sluiten').click();
 await expect(browser.locator('.live-computer')).toHaveCount(0);
 await screen.getByRole('radio','Lokale voorbeelden').check();await expect(screen.getByRole('radio','Lokale voorbeelden')).toBeChecked();
 await agent.act('Choose the Echte harness radio in the Uitvoering group beside the composer. Do not submit any message.');
 await expect(screen.getByRole('radio','Echte harness')).toBeChecked();
 await expect(screen.getByRole('radio','Lokale voorbeelden')).not.toBeChecked();
}
async function canonical(browser:any){return browser.evaluate(async()=>{
 const local=JSON.parse(localStorage.getItem('grok-local-replica-v1')!),id=local.liveHarness.serverIds[local.selected];
 if(!id)return {runs:[],entries:[],tools:[],terminalSessions:[],browserSessions:[],servers:[],conversationId:null};
 const response=await fetch('/api/harness/conversations/'+encodeURIComponent(id));if(!response.ok)throw new Error('Canonical history unavailable: '+response.status);return response.json();
});}
async function pendingIntent(browser:any){return browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return state.liveHarness?.pendingSends?.[state.selected]??null;});}
async function openComputer(screen:any){await screen.getByRole('button','Computer openen').click();await expect(screen.getByRole('tab','Terminal')).toBeVisible();}
async function waitTerminal(browser:any,index:number,status:string){await expect.poll(async()=>(await canonical(browser)).terminalSessions[index]?.status,{timeout:120_000,interval:350}).toBe(status);}
afterEach(async({browser})=>{try{await browser.evaluate(async()=>{
 const local=JSON.parse(localStorage.getItem('grok-local-replica-v1')||'{}'),id=local.liveHarness?.serverIds?.[local.selected];if(!id)return;
 const status=await fetch('/api/harness/status').then(response=>response.json()),state=await fetch('/api/harness/conversations/'+id).then(response=>response.json());
 const post=(path:string)=>fetch('/api/harness/'+path,{method:'POST',headers:{'Content-Type':'application/json','x-harness-csrf':status.csrfToken},body:JSON.stringify({requestId:crypto.randomUUID()})});
 for(const run of state.runs||[])if(['accepted','starting','running','waiting_approval','cancelling'].includes(run.status))await post('runs/'+run.id+'/cancel');
 for(const session of state.terminalSessions||[])if(session.status==='running')await post('conversations/'+id+'/terminal/'+session.id+'/stop');
 });}catch(error){console.warn('Live test cleanup could not confirm stop:',String(error));}});
async function completeOwnedProof(browser:any,screen:any,preview:string){
 for(let step=0;step<16;step++){
  await expect.poll(async()=>{const state=await canonical(browser),run=state.runs[0];return !!run&&(!active.includes(run.status)||run.approvals.some((approval:any)=>approval.status==='pending'));},{timeout:180_000,interval:500}).toBe(true);
  const state=await canonical(browser),run=state.runs[0];if(!active.includes(run.status)){expect(run.status).toBe('completed');return;}
  for(const approval of run.approvals.filter((value:any)=>value.status==='pending')){
   const operation=approval.operation,args=operation.arguments||{};
   const allowed=isDeepStrictEqual(operation,{name:mathTool,arguments:{a:19,b:23}})
    ||operation.name==='workspace_write'&&isDeepStrictEqual(Object.keys(args).sort(),['content','path'])&&args.path==='model-proof.html'&&typeof args.content==='string'&&args.content.includes('LIVE_MODEL_BROWSER_OK')
    ||isDeepStrictEqual(operation,{name:'browser_open',arguments:{url:preview}})
    ||['browser_snapshot','browser_screenshot'].some(name=>isDeepStrictEqual(operation,{name,arguments:{}}));
   expect(allowed,'Approval must match this exact owned proof operation: '+JSON.stringify(operation)).toBe(true);
   await browser.locator(`[data-live-approval="${approval.id}"] [data-action=live-approve]`).click();
   await expect(browser.locator(`[data-live-approval="${approval.id}"] [data-live-approval-status]`)).toHaveText('Goedgekeurd',{timeout:30_000});
  }
 }
 throw new Error('Owned proof exceeded its bounded approval count');
}

test('real installed model uses approved native terminal custom MCP and owned browser and survives reload',{timeout:600_000},async({app,screen,browser,agent})=>{
 await boot(app,screen,browser);await live(agent,screen,browser);await openComputer(screen);
 await screen.getByRole('tab','Tools').click();await screen.getByText('MCP-server toevoegen',{exact:true}).click();
 await screen.getByRole('textbox','MCP-server-ID').fill('math_proof');await screen.getByRole('textbox','MCP-servernaam').fill('Math proof');
 await screen.getByRole('textbox','MCP-commando').fill(process.execPath);await screen.getByRole('textbox','MCP-argumenten').fill(JSON.stringify([fixture]));
 await screen.getByRole('button','Server verbinden').click();
 await expect.poll(async()=>{const state=await canonical(browser);return state.servers?.find((server:any)=>server.name==='Math proof')?.state;},{timeout:120_000,interval:500}).toBe('connected');
 await expect(screen.getByText('sum',{exact:true})).toBeVisible();
 const before=await canonical(browser),preview=`${new URL(app.baseUrl).origin}/api/harness/conversations/${before.conversationId}/preview/model-proof.html`;
 const prompt=`Perform this real integration proof only in your owned workspace. First call the registered Terminal tool with exactly these arguments: ${JSON.stringify({command:terminalCommand})}. This tool requests explicit user approval of that exact command. Wait for approval and do not run any other terminal command. Then call the discovered Math proof MCP sum tool ${mathTool} with a=19,b=23. Call workspace_write to create model-proof.html containing a complete HTML page with title LIVE_MODEL_BROWSER_OK and heading LIVE_MODEL_BROWSER_OK. Call browser_open on ${preview}, then browser_snapshot and browser_screenshot. Verify actual tool outputs and use SendMessage with text only and no reply_to to finish with exactly LIVE_MODEL_PROOF_DONE and the computed sum 42. Do not contact external URLs, read unrelated files, or send external messages.`;
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill(prompt);await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');
 await expect(browser.locator('[data-live-approval] [data-live-approval-operation]')).toContainText('LIVE_APPROVAL_TERMINAL_OK',{timeout:180_000});
 const pending=(await canonical(browser)).runs[0].approvals.filter((approval:{status:string})=>approval.status==='pending');
 expect(pending).toHaveLength(1);expect(pending[0].kind).toBe('tool.execution');
 expect(pending[0].operation).toEqual({name:'Terminal',arguments:{command:terminalCommand}});
 await agent.act('Approve the pending Terminal request only when its arguments contain exactly {command}. Use Goedkeuren on that request. Do not approve any unrelated operation.',{params:{command:terminalCommand}});
 await expect(browser.locator(`[data-live-approval="${pending[0].id}"] [data-live-approval-status]`)).toHaveText('Goedgekeurd',{timeout:30_000});
 await completeOwnedProof(browser,screen,preview);
 const result=await canonical(browser);expect(result.runs).toHaveLength(1);expect(result.runs[0].approvals.some((approval:any)=>approval.status==='resolved'&&approval.decision==='approve')).toBe(true);
 const terminal=result.tools.filter((tool:{name:string})=>tool.name==='Terminal');expect(terminal).toHaveLength(1);
 expect(terminal[0].serverId).toBe('grok_taskbox');expect(terminal[0].arguments).toEqual({command:terminalCommand});expect(terminal[0].status).toBe('completed');
 const terminalOutput=JSON.parse(terminal[0].output);expect(terminalOutput.exitCode).toBe(0);expect(terminalOutput.stdout).toBe('LIVE_APPROVAL_TERMINAL_OK\n');expect(terminalOutput.stderr).toBe('');
 const sum=result.tools.filter((tool:{name:string})=>tool.name===mathTool);expect(sum).toHaveLength(1);
 expect(sum[0].serverId).toBe('custom_math_proof');expect(sum[0].arguments).toEqual({a:19,b:23});expect(sum[0].status).toBe('completed');expect(JSON.parse(sum[0].output).structuredContent).toEqual({sum:42});
 expect(result.tools.some((tool:any)=>tool.name==='workspace_write'&&tool.status==='completed')).toBe(true);expect(result.tools.some((tool:any)=>tool.name==='browser_screenshot'&&tool.status==='completed')).toBe(true);
 expect(result.browserSessions[0].title).toBe('LIVE_MODEL_BROWSER_OK');expect(result.browserSessions[0].captureId).toBeTruthy();
 await expect(browser.locator('.message.bot [data-chat-entry-id]').last()).toContainText('LIVE_MODEL_PROOF_DONE');
 const output=result.entries.find((entry:any)=>entry.role==='assistant');
 const deliveries=result.tools.filter((tool:{name:string})=>tool.name==='SendMessage');expect(deliveries).toHaveLength(1);
 expect(deliveries[0].arguments).toEqual({text:{content:output.text}});
 expect(output.messages).toHaveLength(1);const delivered=output.messages[0];
 expect(delivered).toEqual({id:expect.any(String),callId:deliveries[0].callId,type:'text',content:output.text,createdAt:expect.any(String)});
 expect(delivered.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 expect(JSON.parse(deliveries[0].output)).toEqual({success:{message_id:delivered.id,timestamp:Date.parse(delivered.createdAt)}});
 await browser.reload();
 await expect(browser.locator(`[data-chat-entry-id="${output.id}"]`)).toContainText('LIVE_MODEL_PROOF_DONE',{timeout:30_000});
 expect((await canonical(browser)).entries.find((entry:any)=>entry.id===output.id).text).toBe(output.text);expect((await canonical(browser)).runs).toHaveLength(1);
 expect((await canonical(browser)).entries.find((entry:any)=>entry.id===output.id).messages).toEqual(output.messages);
 await app.screenshot('live-model-tools-and-reload');
});

test('direct terminal shows true stdout stderr exit and stop with actual owned browser interaction and frame',{timeout:360_000},async({app,screen,browser,agent})=>{
 await boot(app,screen,browser);await live(agent,screen,browser);await openComputer(screen);
 const html='<!doctype html><html><head><title>LIVE_BROWSER_BEFORE</title></head><body><h1>Owned browser proof</h1><button id="proof" onclick="document.title=\'LIVE_BROWSER_AFTER\';this.textContent=\'Clicked\'">Click proof</button></body></html>';
 const command=`printf 'LIVE_STDOUT_EXACT\\n'; printf 'LIVE_STDERR_EXACT\\n' >&2; printf '%s' '${html.replaceAll("'","'\\''")}' > direct-proof.html; exit 7`;
 await screen.getByRole('textbox','Terminalopdracht').fill(command);await screen.getByRole('button','Opdracht uitvoeren').click();await waitTerminal(browser,0,'failed');
 let state=await canonical(browser);expect(state.terminalSessions[0].stdout).toBe('LIVE_STDOUT_EXACT\n');expect(state.terminalSessions[0].stderr).toBe('LIVE_STDERR_EXACT\n');expect(state.terminalSessions[0].exitCode).toBe(7);
 await expect(browser.locator('[data-terminal-stdout]').first()).toHaveText('LIVE_STDOUT_EXACT');await expect(browser.locator('[data-terminal-stderr]').first()).toHaveText('LIVE_STDERR_EXACT');await expect(browser.locator('[data-terminal-status]').first()).toHaveText('Mislukt · exitcode 7');
 await screen.getByRole('textbox','Terminalopdracht').fill("printf 'LIVE_LONG_STARTED\\n'; sleep 60; printf 'SHOULD_NOT_COMPLETE\\n'");await screen.getByRole('button','Opdracht uitvoeren').click();
 await expect(browser.locator('[data-terminal-stdout]').nth(1)).toContainText('LIVE_LONG_STARTED',{timeout:30_000});await screen.getByRole('button','Terminal stoppen').click();await waitTerminal(browser,1,'interrupted');
 state=await canonical(browser);expect(state.terminalSessions[1].stdout).not.toContain('SHOULD_NOT_COMPLETE');expect(state.terminalSessions[1].status).toBe('interrupted');
 await screen.getByRole('tab','Browser').click();const url=`${new URL(app.baseUrl).origin}/api/harness/conversations/${state.conversationId}/preview/direct-proof.html`;
 await screen.getByRole('textbox','Browser-URL').fill(url);await screen.getByRole('button','Pagina openen').click();
 await expect(browser.locator('[data-browser-title]')).toHaveText('LIVE_BROWSER_BEFORE',{timeout:60_000});
 await screen.getByText('Pagina bedienen',{exact:true}).click();await screen.getByRole('textbox','Browserelement').fill('#proof');await screen.getByRole('button','Element aanklikken').click();
 await expect(browser.locator('[data-browser-title]')).toHaveText('LIVE_BROWSER_AFTER',{timeout:60_000});const priorCapture=(await canonical(browser)).browserSessions[0].captureId;await screen.getByRole('button','Beeld vastleggen').click();
 await expect.poll(async()=>(await canonical(browser)).browserSessions[0]?.captureId,{timeout:30_000}).not.toBe(priorCapture);
 await expect.poll(()=>browser.evaluate(()=>{const image=document.querySelector('[data-live-browser-frame]') as HTMLImageElement;return !!image?.complete&&image.naturalWidth>0;}),{timeout:30_000}).toBe(true);
 state=await canonical(browser);expect(state.browserSessions[0].pageUrl).toBe(url);expect(state.browserSessions[0].title).toBe('LIVE_BROWSER_AFTER');expect(state.tools.some((tool:any)=>tool.name==='browser_click'&&tool.status==='completed')).toBe(true);expect(state.tools.some((tool:any)=>tool.name==='browser_screenshot'&&tool.status==='completed')).toBe(true);
 await expect(browser.locator('[data-live-browser-frame]')).toHaveAttribute('src',new URL(state.browserSessions[0].frameUrl,app.baseUrl).href);
 await app.screenshot('live-terminal-and-owned-browser-frame');
});

test('network-rejected live send retains draft and pending identity without canned fallback',{timeout:240_000},async({app,screen,browser,agent})=>{
 await boot(app,screen,browser);await live(agent,screen,browser);
 await browser.route('**/api/harness/conversations/*/runs',async(route:any)=>route.abort());
 const text='LIVE_OFFLINE_RETAINED_DRAFT';await screen.getByRole('textbox','Bericht sturen naar Bot').fill(text);await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');
 await expect(browser.locator('[data-live-send-error]')).toContainText('fetch',{timeout:120_000});await expectComposerText(browser,text);
 const intent=await pendingIntent(browser);expect(intent.payload.text).toBe(text);expect((await canonical(browser)).runs).toHaveLength(0);await expect(browser.locator('.message.bot')).toHaveCount(0);
 await expect(screen.getByText('Dit is een lokale voorbeeldreactie.',{exact:false})).toHaveCount(0);
 await browser.reload();await expectComposerText(browser,text);expect((await pendingIntent(browser)).payload.requestId).toBe(intent.payload.requestId);
 await screen.getByRole('button','Ontvangst controleren').click();await expect(browser.locator('[data-live-send-error]')).toContainText('fetch',{timeout:120_000});expect((await canonical(browser)).runs).toHaveLength(0);await expect(browser.locator('.message.bot')).toHaveCount(0);
 await app.screenshot('live-rejected-send-retained-draft');
});

test('lost actual acceptance acknowledgement reload recovers the same request with one canonical run',{timeout:360_000},async({app,screen,browser,agent})=>{
 await browser.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await original(...args);const url=String(args[0]),options=args[1];if(options?.method==='POST'&&/\/api\/harness\/conversations\/[^/]+\/runs$/.test(url)&&!sessionStorage.getItem('harness-lost-ack')){const accepted=await response.clone().json();if(response.ok&&accepted.accepted){sessionStorage.setItem('harness-lost-ack',JSON.stringify(accepted));throw new TypeError('QA_LOST_ACK_AFTER_REAL_ACCEPT');}}return response;};});
 await boot(app,screen,browser);await live(agent,screen,browser);
 const text='Reply exactly LIVE_ACK_RECOVERY_DONE. Do not use tools or access any external data.';await screen.getByRole('textbox','Bericht sturen naar Bot').fill(text);await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');
 await expect(browser.locator('[data-live-send-error]')).toHaveText('QA_LOST_ACK_AFTER_REAL_ACCEPT',{timeout:120_000});await expectComposerText(browser,text);
 const intent=await pendingIntent(browser),accepted=await browser.evaluate(()=>JSON.parse(sessionStorage.getItem('harness-lost-ack')!));expect(accepted.accepted).toBe(true);expect(accepted.requestId).toBe(intent.payload.requestId);expect((await canonical(browser)).runs).toHaveLength(1);
 await browser.reload();await expect(screen.getByRole('button','Ontvangst controleren')).toBeVisible();await screen.getByRole('textbox','Bericht sturen naar Bot').fill('NEWER_DRAFT_MUST_SURVIVE_ACK');
 await screen.getByRole('button','Ontvangst controleren').click();await expect(screen.getByRole('button','Ontvangst controleren')).toBeHidden({timeout:120_000});await expectComposerText(browser,'NEWER_DRAFT_MUST_SURVIVE_ACK');
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status,{timeout:180_000,interval:500}).toBe('completed');
 const state=await canonical(browser);expect(state.runs).toHaveLength(1);expect(state.runs[0].id).toBe(accepted.runId);expect(state.runs[0].requestId).toBe(intent.payload.requestId);expect(state.entries.filter((entry:any)=>entry.role==='user')).toHaveLength(1);expect(state.entries.filter((entry:any)=>entry.role==='assistant')).toHaveLength(1);
 await expect(browser.locator(`[data-chat-entry-id="${accepted.outputEntryId}"]`)).toContainText('LIVE_ACK_RECOVERY_DONE');await expect(browser.locator('.message.user')).toHaveCount(1);await expect(screen.getByText('Dit is een lokale voorbeeldreactie.',{exact:false})).toHaveCount(0);
 await app.screenshot('live-lost-ack-same-request-recovery');
});

test('terminal-only ownership survives demo reload clear reset and query reset',{timeout:240_000},async({app,screen,browser,agent})=>{
 await browser.addInitScript(()=>{
  const w=window as any,original=window.fetch.bind(window);w.__realConnections=[];
  window.fetch=async(...args)=>{const response=await original(...args),path=new URL(String(args[0]),location.href).pathname;
   if(args[1]?.method==='POST'&&/\/api\/harness\/conversations\/[^/]+\/connect$/.test(path)&&response.ok)w.__realConnections.push(await response.clone().json());
   return response;
  };
 });
 await boot(app,screen,browser);await live(agent,screen,browser);await openComputer(screen);
 await screen.getByRole('textbox','Terminalopdracht').fill("printf 'LIVE_TERMINAL_GUARD_OK\\n'");await screen.getByRole('button','Opdracht uitvoeren').click();await waitTerminal(browser,0,'completed');
 const original=await canonical(browser);expect(original.runs).toHaveLength(0);expect(original.terminalSessions[0].stdout).toBe('LIVE_TERMINAL_GUARD_OK\n');
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill('TERMINAL_CONTEXT_DRAFT_RETAINED');
 const connectionCount=await browser.evaluate(()=>(window as any).__realConnections.length);expect(connectionCount).toBe(1);
 await screen.getByRole('button','Harness verbinden').click();
 await expect.poll(()=>browser.evaluate(()=>(window as any).__realConnections.length),{timeout:15_000}).toBe(connectionCount+1);
 await screen.getByRole('tab','Tools').click();await expect(screen.getByRole('heading','Grok workspace connected')).toBeVisible();
 await screen.getByRole('button','Tools vernieuwen').click();
 await expect.poll(()=>browser.evaluate(()=>(window as any).__realConnections.length),{timeout:15_000}).toBe(connectionCount+2);
 const reconnects=await browser.evaluate(()=>(window as any).__realConnections.slice(1));
 for(const receipt of reconnects){expect(receipt.conversationId).toBe(original.conversationId);expect(receipt.servers.find((server:any)=>server.id==='grok_workspace')?.state).toBe('connected');expect(receipt.runs).toHaveLength(0);expect(receipt.terminalSessions[0].id).toBe(original.terminalSessions[0].id);}
 await expectComposerText(browser,'TERMINAL_CONTEXT_DRAFT_RETAINED');
 await screen.getByRole('radio','Lokale voorbeelden').check();await expect(screen.getByRole('radio','Lokale voorbeelden')).toBeChecked();
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill('TERMINAL_CONTEXT_DRAFT_RETAINED');await browser.reload();
 await expect(screen.getByRole('radio','Lokale voorbeelden')).toBeChecked();expect((await canonical(browser)).conversationId).toBe(original.conversationId);
 await screen.getByRole('button','Gespreksopties').click();await screen.getByRole('menuitem','Gesprek wissen').click();
 await expect(browser.locator('.workflow-chat-feedback')).toContainText('Echte geschiedenis wordt op deze Mac bewaard');
 expect((await canonical(browser)).terminalSessions[0].id).toBe(original.terminalSessions[0].id);
 await screen.getByRole('button','Accountmenu').click();await screen.getByRole('menuitem','Help en feedback').click();await screen.getByRole('button','Voorbeeldgegevens herstellen').click();
 await expect(browser.locator('.workflow-chat-feedback')).toContainText('Voorbeeldgegevens herstellen is geblokkeerd');
 expect((await canonical(browser)).conversationId).toBe(original.conversationId);await expectComposerText(browser,'TERMINAL_CONTEXT_DRAFT_RETAINED');
 await browser.goto('/?reset=1');await expect(browser.locator('.workflow-chat-feedback')).toContainText('Voorbeeldgegevens herstellen is geblokkeerd');
 await expect(screen.getByRole('radio','Lokale voorbeelden')).toBeChecked();await expectComposerText(browser,'TERMINAL_CONTEXT_DRAFT_RETAINED');
 const restored=await canonical(browser);expect(restored.conversationId).toBe(original.conversationId);expect(restored.terminalSessions[0].id).toBe(original.terminalSessions[0].id);expect(restored.runs).toHaveLength(0);
 await screen.getByRole('radio','Echte harness').check();await expect(screen.getByRole('radio','Echte harness')).toBeChecked();await openComputer(screen);
 await expect(browser.locator('[data-terminal-stdout]').first()).toHaveText('LIVE_TERMINAL_GUARD_OK');await app.screenshot('live-terminal-ownership-reset-guards');
});

test('delayed preacceptance snapshot and failed fresh GET recover the real background transcript automatically',{timeout:360_000},async({app,screen,browser,agent})=>{
 await browser.addInitScript(()=>{
  const w=window as any,original=window.fetch.bind(window);let firstSnapshot=true,freshFailure=false;
  window.fetch=async(...args)=>{
   const path=new URL(String(args[0]),location.href).pathname,method=args[1]?.method||'GET',snapshot=method==='GET'&&/^\/api\/harness\/conversations\/[^/]+$/.test(path);
   if(snapshot&&firstSnapshot){firstSnapshot=false;const response=await original(...args),value=await response.clone().json();w.__heldInitialSnapshot={conversationId:value.conversationId,lastSeq:value.lastSeq,runs:value.runs.length};await new Promise<void>(resolve=>{w.__releaseInitialSnapshot=resolve;});return response;}
   const response=await original(...args);
   if(method==='POST'&&/\/api\/harness\/conversations\/[^/]+\/runs$/.test(path)){const value=await response.clone().json();if(response.ok&&value.accepted)w.__acceptedWhileSnapshotHeld=value;}
   if(snapshot&&w.__acceptedWhileSnapshotHeld&&!freshFailure){freshFailure=true;w.__failedFreshSnapshot=true;throw new TypeError('QA_ACTUAL_POST_ACCEPT_SNAPSHOT_RESPONSE_LOST');}
   return response;
  };
 });
 await boot(app,screen,browser);await live(agent,screen,browser);await expect.poll(()=>browser.evaluate(()=>!!(window as any).__heldInitialSnapshot),{timeout:30_000}).toBe(true);
 await expect(browser.locator('.live-computer')).toHaveCount(0);
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill('Reply exactly LIVE_BACKGROUND_RECOVERY_DONE. Use no tools and access no external data.');await screen.getByRole('textbox','Bericht sturen naar Bot').press('Enter');
 await expect.poll(()=>browser.evaluate(()=>!!(window as any).__acceptedWhileSnapshotHeld),{timeout:120_000}).toBe(true);
 const accepted=await browser.evaluate(()=>(window as any).__acceptedWhileSnapshotHeld);expect(await browser.evaluate(()=>(window as any).__heldInitialSnapshot.runs)).toBe(0);
 await expect.poll(()=>browser.evaluate(()=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return state.drafts.marketing;})).toBe('');
 await screen.getByRole('textbox','Bericht sturen naar Bot').fill('NEWER_DRAFT_DURING_BACKGROUND_RECOVERY');await screen.getByRole('button','Find Customers').click();
 await expect(screen.getByRole('radio','Lokale voorbeelden')).toBeChecked();await browser.evaluate(()=>{(window as any).__releaseInitialSnapshot();});
 await expect.poll(()=>browser.evaluate(()=>!!(window as any).__failedFreshSnapshot),{timeout:30_000}).toBe(true);
 await expect.poll(()=>browser.evaluate((id:string)=>{const state=JSON.parse(localStorage.getItem('grok-local-replica-v1')!);return state.messages.marketing?.some((entry:any)=>entry.id===id&&entry.text.includes('LIVE_BACKGROUND_RECOVERY_DONE'))||false;},accepted.outputEntryId),{timeout:180_000,interval:500}).toBe(true);
 await expect(screen.getByRole('radio','Lokale voorbeelden')).toBeChecked();await expect(browser.locator('.live-computer')).toHaveCount(0);
 await screen.getByRole('button','Marketing Agent').click();await expect(browser.locator(`[data-chat-entry-id="${accepted.outputEntryId}"]`)).toContainText('LIVE_BACKGROUND_RECOVERY_DONE');
 await expectComposerText(browser,'NEWER_DRAFT_DURING_BACKGROUND_RECOVERY');await expect(browser.locator('.live-computer')).toHaveCount(0);
 await expect.poll(async()=>(await canonical(browser)).runs[0]?.status,{timeout:120_000}).toBe('completed');const result=await canonical(browser);expect(result.runs).toHaveLength(1);expect(result.runs[0].id).toBe(accepted.runId);expect(result.entries.filter((entry:any)=>entry.role==='user')).toHaveLength(1);expect(result.entries.filter((entry:any)=>entry.role==='assistant')).toHaveLength(1);
 await app.screenshot('live-delayed-snapshot-background-recovery');
});
