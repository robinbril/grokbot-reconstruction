// An independently implemented local activity lifecycle. No remote agent is invoked.
export function activityMarkup(host, run) {
  const {esc, avatar, selectedBot}=host, agent=selectedBot();
  const active=run.status==='running';
  const phrase=active?'Tekst lokaal verwerken':run.status==='question'?'Wacht op je antwoord':run.status==='approval'?'Wacht op je beoordeling':run.status==='cancelled'?'Taak gestopt':run.status==='interrupted'?'Lokale verwerking onderbroken':'Lokale verwerking voltooid';
  return `<div class="product-activity" data-product-activity data-active="${active}">
    <div class="product-reader-cluster" data-source-instance="INSTANCE-202" aria-label="Lokale deelnemers">
      ${active&&agent?`<span class="product-reader-seat" data-reader-seat="${esc(agent.id)}" data-source-instance="INSTANCE-203"><span class="product-reader-disc" data-source-instance="INSTANCE-204"><span data-source-instance="INSTANCE-206">${avatar(agent)}</span></span></span>`:''}
    </div><span class="product-activity-bubble" data-source-instance="INSTANCE-207"><span data-activity-phrase data-source-instance="INSTANCE-212">${esc(phrase)}</span><span class="product-typing" aria-hidden="true" ${active?'':'hidden'}>${[284,285,286].map(n=>`<i data-source-instance="INSTANCE-${n}"></i>`).join('')}</span></span>
  </div>`;
}

export function createActivityController(host) {
  const active=new Map();
  function finish(root, status='complete') {
    if(!root)return;
    const cluster=root.querySelector('.product-reader-cluster'), seat=root.querySelector('[data-reader-seat]');
    root.dataset.active='false';
    const phrase=root.querySelector('[data-activity-phrase]');if(phrase)phrase.textContent=status==='cancelled'?'Taak gestopt':status==='interrupted'?'Lokale verwerking onderbroken':'Lokale verwerking voltooid';
    const dots=root.querySelector('.product-typing');if(dots)dots.hidden=true;
    if(!seat)return;
    if(seat.dataset.departing!==undefined&&active.has(seat))return;
    const disc=seat.firstElementChild;seat.dataset.departing='';
    for(const a of disc.getAnimations())a.cancel();
    disc.className='product-reader-disc';disc.dataset.sourceInstance='INSTANCE-205';delete disc.dataset.sourceClasses;host.sourceMotion.bind(disc,'INSTANCE-205');
    const done=()=>{if(active.get(seat)!==done)return;active.delete(seat);seat.remove();if(cluster)cluster.style.width='0px';};
    active.set(seat,done);
    const animations=disc.getAnimations();
    if(animations.length)Promise.allSettled(animations.map(a=>a.finished)).then(done);else done();
  }
  function destroy(){for(const[seat]of active){for(const a of seat.getAnimations({subtree:true}))a.cancel();seat.remove();}active.clear();}
  return{finish,destroy};
}

export function syncRosterActivity(host,{getRuntime}={}){
  const state=host.getState(),byOwner=new Map();
  for(const[key,messages]of Object.entries(state.messages))for(const message of messages){const run=message.localRun;if(!run)continue;const runtime=getRuntime?.({conversationId:key,runId:run.id}),status=runtime?runtime.effectiveStatus:run.status;if(!['running','approval','question'].includes(status))continue;
    const owner=state.tasks.find(task=>task.conversationId===key)?.parentBotId||key;byOwner.set(owner,{status,operation:run.operation});
  }
  for(const row of host.app.querySelectorAll('.roster [data-agent-id]')){
    const id=row.dataset.agentId,button=row.querySelector('[data-action="select-agent"]'),body=row.querySelector('.agent-copy'),preview=row.querySelector('.agent-preview'),agent=host.getAgent(id),run=byOwner.get(id);
    if(!button||!body||!agent)continue;
    host.sourceMotion.bind(button,'INSTANCE-100');host.sourceMotion.bind(body,'INSTANCE-101');
    row.dataset.localWorking=String(run?.status==='running');
    const named=run?.status==='running'&&run.operation==='count';
    if(preview)preview.textContent=named?'Tekst lokaal verwerken':agent.preview;
    // Nv/Ybe expanded: named activity has no corner dot. Unnamed running activity
    // has the 8×8 running corner; a blocked/attention marker has a trailing seat.
    const avatar=button.querySelector('.avatar'),showCorner=run?.status==='running'&&!named;
    let corner=button.querySelector('[data-local-working-corner]');
    if(showCorner&&avatar&&!corner){corner=document.createElement('span');corner.dataset.localWorkingCorner='';corner.className='product-roster-working-corner';corner.setAttribute('aria-hidden','true');corner.innerHTML='<span class="product-roster-working-dot" data-source-instance="INSTANCE-104"></span>';avatar.append(corner);host.sourceMotion.bind(corner,'INSTANCE-103');}
    else if(!showCorner)corner?.remove();
    let trailing=button.querySelector('[data-local-attention]');
    if(run&&['approval','question'].includes(run.status)&&!trailing){trailing=document.createElement('span');trailing.dataset.localAttention='';trailing.className='product-roster-attention';trailing.textContent='•';trailing.setAttribute('aria-hidden','true');button.append(trailing);host.sourceMotion.bind(trailing,'INSTANCE-102');}
    else if(!run||run.status==='running')trailing?.remove();
  }
}
