// Native bp/xp, xn/A_, and a_/r_/hI are retained verbatim from the verified 0.71.2 spans.
// They are private; the DOM adapter sees only the small reducer contract below.
const ye=1,lI=Number.MAX_SAFE_INTEGER,yp={kind:'undirected'};
// Native evidence kp
function kp(e){return e.kind==="undirected"?0:e.direction}
// Native evidence pI
function pI(e){return e<0?-1:e>0?1:0}
// Native evidence wp
function wp(e){return e.isUserPointerDown||e.msSinceUserScrollInput<=e.userInputWindowMs}
// Native evidence mI
function mI(e,t){const n=kp(e.userInput);return wp(e)&&(n===0||t===0||n===t)}
// Native evidence gI
function gI(e){if(!e.isScrolling)return{kind:"settled"};if(e.isProgrammaticScrollActive)return{kind:"programmatic"};const t=pI(e.clampedOffset-e.lastObservedScrollOffset);return mI(e,t)?{kind:"reader",direction:t}:e.viewportHeight!==e.lastObservedViewportHeight?{kind:"geometry-change",of:"viewport"}:Math.abs(e.totalHeight-e.lastObservedTotalHeight)>e.nearBottomThresholdPx?{kind:"geometry-change",of:"content"}:{kind:"foreign",direction:t}}
// Native evidence bp
function bp(e){const t=e.totalHeight-e.clampedOffset-e.viewportHeight,n=t<=e.nearBottomThresholdPx,r=gI(e),o=n&&e.totalHeight-e.viewportHeight<e.lastObservedTotalHeight-e.lastObservedViewportHeight,s=r.kind==="reader"?r.direction===-1&&!o:r.kind==="foreign"&&r.direction===-1&&!n;if(e.isReady&&s)return{atBottom:n,attribution:r,event:{kind:"release-requested",reason:r.kind==="reader"?"attributed-scroll-away":"unattributed-scroll-away"}};const i=e.userInput.kind==="scroll"&&e.userInput.direction===-1&&e.msSinceUserScrollInput<=e.userInputWindowMs&&e.clampedOffset<ye&&t>=ye;if(e.isReady&&i)return{atBottom:n,attribution:r,event:{kind:"release-requested",reason:"scroll-away-at-top-edge"}};const a=e.totalHeight<e.lastObservedTotalHeight,u=e.lastObservedTotalHeight-e.lastObservedScrollOffset-e.lastObservedViewportHeight<=e.nearBottomThresholdPx,l=e.allowAutomaticRelatch&&a&&u,d=e.allowAutomaticRelatch&&r.kind==="settled"&&!wp(e)&&!(a&&!u),f=e.allowScrollRangeClosedRelatch&&e.totalHeight-e.viewportHeight<=e.nearBottomThresholdPx&&e.lastObservedTotalHeight-e.lastObservedViewportHeight>e.nearBottomThresholdPx;let h;return r.kind==="reader"&&r.direction===1?h="attributed-scroll-to-bottom":r.kind==="foreign"&&r.direction===1?h="unattributed-scroll-to-bottom":l?h="content-shrink-at-bottom":d?h="idle-at-bottom":f&&(h="scroll-range-closed"),e.isReady&&n&&h!==void 0?{atBottom:n,attribution:r,event:{kind:"pin-requested",reason:h}}:{atBottom:n,attribution:r,event:{kind:"neutral",reason:e.isReady?r.kind==="programmatic"?"programmatic-scroll":n?"near-bottom":"unqualified-observation":"not-ready"}}}
// Native evidence xp
function xp(e,t){switch(t.kind){case"release-requested":return e.kind==="pinned"?{state:{kind:"released"},reason:{kind:"released",reason:t.reason}}:{state:e,reason:{kind:"retained",reason:"already-released"}};case"pin-requested":return e.kind==="released"?{state:{kind:"pinned"},reason:{kind:"pinned",reason:t.reason}}:{state:e,reason:{kind:"retained",reason:"already-pinned"}};case"neutral":return{state:e,reason:{kind:"retained",reason:t.reason}};default:{const n=t;throw new TypeError(`unknown bottom pin event ${JSON.stringify(n)}`)}}}
// Native evidence xn
function xn(e,t){switch(t.kind){case"input":{const n=kp(t.input),r=n===0?Kd(e):n;return e.kind==="pointer-held"?{kind:"pointer-held",lastInputAtMs:t.atMs,direction:r,input:t.input}:{kind:"recent",lastInputAtMs:t.atMs,direction:r,input:t.input}}case"pointer-down":return{kind:"pointer-held",lastInputAtMs:t.atMs,direction:Kd(e),input:yp};case"pointer-up":return e.kind==="pointer-held"?{kind:"recent",lastInputAtMs:e.lastInputAtMs,direction:e.direction,input:e.input}:e;case"scroll-direction":switch(e.kind){case"idle":return e;case"recent":return{...e,direction:t.direction};case"pointer-held":return{...e,direction:t.direction};default:{const n=e;throw new TypeError(`unknown user input state ${JSON.stringify(n)}`)}}case"time-observed":return e.kind==="recent"&&t.nowMs-e.lastInputAtMs>t.inputWindowMs?{kind:"idle"}:e;case"reset":return{kind:"idle"};default:{const n=t;throw new TypeError(`unknown user input event ${JSON.stringify(n)}`)}}}
// Native evidence A_
function A_(e){const t=xn(e.state,{kind:"time-observed",nowMs:e.nowMs,inputWindowMs:e.inputWindowMs});switch(t.kind){case"idle":return{state:t,msSinceUserInput:lI,direction:0,input:yp,isPointerHeld:!1};case"recent":return{state:t,msSinceUserInput:Math.max(0,e.nowMs-t.lastInputAtMs),direction:t.direction,input:t.input,isPointerHeld:!1};case"pointer-held":return{state:t,msSinceUserInput:Math.max(0,e.nowMs-t.lastInputAtMs),direction:t.direction,input:t.input,isPointerHeld:!0};default:{const n=t;throw new TypeError(`unknown user input state ${JSON.stringify(n)}`)}}}
// Native evidence I_
function I_(e,t){switch(t.kind){case"bound-correction-requested":return{kind:"awaiting-observation",targetScrollTopPx:t.targetScrollTopPx};case"unbound-correction-requested":return{kind:"pending-bind",targetScrollTopPx:t.targetScrollTopPx};case"write-applied":return e.kind==="idle"?e:{kind:"awaiting-observation",targetScrollTopPx:t.observedScrollTopPx};case"write-skipped":return{kind:"idle"};case"clamp-observed":return{kind:"awaiting-observation",targetScrollTopPx:t.observedScrollTopPx};case"scroll-observed":return e.kind==="pending-bind"?e:{kind:"idle"};case"user-input":return e.kind==="awaiting-observation"?e:{kind:"idle"};case"element-unbound":return e.kind==="awaiting-observation"?{kind:"pending-bind",targetScrollTopPx:e.targetScrollTopPx}:e;default:{const n=t;throw new TypeError(`unknown programmatic scroll event ${JSON.stringify(n)}`)}}}
// Native evidence Kd
function Kd(e){return e.kind==="idle"?0:e.direction}
// Native evidence _a
function _a(e,t){return t.releaseHeldShrinkAtCommittedBox===!0&&e.userInput.kind==="scroll"?e.userInput.direction:e.userScrollDir}
// Native evidence Dd
function Dd(e,t){const n=_a(e,t);return n>0&&e.userScrollDir<=0?e.userScrollDir:n}
// Native evidence Np
function Np(e,t,n,r,o){const s=n.indexOf(r);if(s!==void 0)return s;const i=o.identityOf;if(i===void 0)return;const a=e.rows.findIndex(u=>u.rowId===r);if(a<0)return;const c=e.rows[a];if(c!==void 0)return Mc({anchor:{mode:"read",edge:"top",rowIndex:a,...i(c),bubbleId:i(c).bubbleIds[0],edgeOffset:0,viewportOffsetPx:0},rows:t.map(u=>i(u))})}
// Native evidence Ft
function Ft(e){return Math.min(e.max,Math.max(e.min,e.value))}
// Native evidence Oi
function Oi(e,t){return Math.min(Math.max(t,0),Math.max(0,e))}
// Native evidence Mc
function Mc(e){const t=e.isRowIndexUsable??(()=>!0),n=u=>u.stableIdentity===e.anchor.stableIdentity||u.collapseStableKey===e.anchor.collapseStableKey||u.rowKey===e.anchor.rowKey||e.anchor.bubbleId!==void 0&&u.bubbleIds.includes(e.anchor.bubbleId),r=e.rows[e.anchor.rowIndex];if(r!==void 0&&n(r)&&t(e.anchor.rowIndex))return e.anchor.rowIndex;const o=u=>{for(let l=0;l<e.rows.length;l++){const d=e.rows[l];if(!(d===void 0||!u(d)||!t(l)))return l}},s=o(u=>u.stableIdentity===e.anchor.stableIdentity);if(s!==void 0)return s;const i=o(u=>u.collapseStableKey===e.anchor.collapseStableKey);if(i!==void 0)return i;const a=o(u=>u.rowKey===e.anchor.rowKey);if(a!==void 0)return a;const c=e.anchor.bubbleId;if(c!==void 0)return o(u=>u.bubbleIds.includes(c))}
// Native evidence hI
function hI(e){if(e.anchor===void 0)return{kind:"skip",reason:"no-anchor"};if(!e.initReady)return{kind:"skip",reason:"not-ready"};if(e.pinnedFollowing)return{kind:"skip",reason:"pinned-following"};if(e.anchor.mode==="bottom")return{kind:"rebase",anchorDisposition:"rebase-read"};if(e.anchor.mode==="read"&&e.isStreaming)return{kind:"skip",reason:"streaming-hold"};const t=e.anchor.mode==="preserve-once"?"rebase-read":"retain";if(e.resolvedOffset===void 0)return{kind:"rebase",anchorDisposition:t};let n;switch(e.anchor.mode){case"read":n=Oi(e.liveScrollTop+e.resolvedOffset-e.anchor.edgeOffset,e.maxScrollTop);break;case"preserve-once":n=Oi(e.resolvedOffset-e.anchor.viewportOffsetPx,e.maxScrollTop);break}const r=n-e.liveScrollTop;if(Math.abs(r)<ye)return{kind:"noop",anchorDisposition:t};if(e.anchor.mode==="read"&&e.isUserScrolling&&e.userScrollDir>0&&r<0){const o=Math.max(e.structuralDeltaPx?.()??0,r);if(Math.abs(o)<ye)return{kind:"skip",reason:"user-scrolling"};const s=Oi(e.liveScrollTop+o,e.maxScrollTop);return{kind:"adjust",targetScrollTop:s,deltaPx:s-e.liveScrollTop,anchorDisposition:t}}return{kind:"adjust",targetScrollTop:n,deltaPx:r,anchorDisposition:t}}
// Native evidence a_
function a_(e,t,n,r,o,s=!1){const i=m=>{const y=e.rows[m];return y===void 0||o.identityOf?.(y).anchorable!==!1},a=(m,y)=>{let w=m;for(;!i(w)&&w+y>=0&&w+y<t.rowCount;)w+=y;return e.rows[w]?.rowId},c=m=>m>=n.scrollTopPx-ye&&m<=n.scrollTopPx+n.viewportHeightPx-ye,u=e.viewport.mode.kind==="anchored";let l=!1;if(e.viewport.mode.kind==="anchored"){const m=e.viewport.mode.rowId,y=t.offsetOf(m),w=t.indexOf(m);if(l=s&&y!==void 0&&w!==void 0&&y+t.heightAt(w)<=n.scrollTopPx+ye,y!==void 0&&w!==void 0&&i(w)&&!l&&(r===0||c(y)))return m}if(t.rowCount===0)return;const f=l?1:u?r:0,h=n.scrollTopPx+n.viewportHeightPx;if(f<0){const m=t.indexAtOffset(h-ye);return m<0?void 0:a(m,-1)}const p=n.scrollTopPx;let g=t.indexAtOffset(p+ye);if(!(g<0)){for(;g<t.rowCount-1&&t.offsetAt(g)+t.heightAt(g)<=p+ye;)g++;return f>0&&g<t.rowCount-1&&t.offsetAt(g)<p-ye&&t.offsetAt(g+1)<h-ye&&g++,a(g,1)}}
// Native evidence r_
function r_({prev:e,prevIndex:t,nextIndex:n,nextRows:r,input:o,maxScrollTop:s,dominantCause:i,config:a,epochChanged:c}){const u=o.trigger==="scroll-observation"&&!o.isProgrammaticScrollActive||o.isUserPointerDown||o.msSinceUserScrollInput<=a.userInputWindowMs,l=a.anchorFollowsReader===!0&&o.navigation.kind==="idle"&&o.userInput.kind!=="zoom"&&!c&&o.viewportHeightPx===e.viewport.viewportHeightPx,d=a_(e,t,o,l&&u?Dd(o,a):0,a,l&&!u&&a.anchorLeftAboveFallsToRowInView===!0),f=d===void 0||a.anchorFallsToSurvivingRow!==!0?d:s_(e,t,r,n,o,d,a);if(f===void 0)return{mode:{kind:"free",lastUserDirection:o.userScrollDir}};const h=t.offsetOf(f),p=(h??0)-o.scrollTopPx,g=e.viewport.mode.kind==="anchored"&&e.viewport.mode.rowId===f?e.viewport.mode.edgeOffsetPx:p,m=o.navigation.kind==="idle"&&!u&&Math.abs(g-p)>=ye,y=Np(e,r,n,f,a),w=t.indexOf(f),S=hI({anchor:h===void 0?void 0:{mode:m?"preserve-once":"read",edge:"top",rowIndex:w??0,stableIdentity:f,rowKey:f,bubbleId:void 0,collapseStableKey:f,edgeOffset:h,viewportOffsetPx:g},resolvedOffset:y===void 0?void 0:n.offsetAt(y),liveScrollTop:o.scrollTopPx,maxScrollTop:s,initReady:!0,pinnedFollowing:!1,isStreaming:o.isGenerating,isUserScrolling:u,userScrollDir:Dd(o,a),...a.anchorKeepsStructuralShiftWhileScrolling===!0&&w!==void 0&&y!==void 0?{structuralDeltaPx:()=>o_({prevIndex:t,nextIndex:n,nextRows:r,prevAnchorIndex:w,nextAnchorIndex:y})}:{}});if(y===void 0)return{mode:{kind:"free",lastUserDirection:o.userScrollDir}};const b=r[y]?.rowId??f,v=S.kind!=="skip"&&S.anchorDisposition==="rebase-read"?n.offsetAt(y)-(S.kind==="adjust"?S.targetScrollTop:o.scrollTopPx):m?g:p,E={kind:"anchored",rowId:b,edgeOffsetPx:v},A=m?"restore":i??"measured-verification";if(S.kind==="adjust")return{mode:E,scroll:{targetScrollTopPx:S.targetScrollTop,reason:A,motion:"instant"}};if(S.kind==="skip"&&S.reason==="streaming-hold"){if(h!==void 0){const F=n.offsetAt(y)-h;if(Math.abs(F)>=ye)return{mode:E,scroll:{targetScrollTopPx:Ft({value:o.scrollTopPx+F,min:0,max:s}),reason:A,motion:"instant"}}}return{mode:E}}return{mode:E}}
// Native evidence $p
function $p(e,t){return e.kind!=="anchored"&&t.kind==="idle"}
// Native dependency s_
function s_(e,t,n,r,o,s,i){if(Np(e,n,r,s,i)!==void 0)return s;const a=o.scrollTopPx+o.viewportHeightPx,c=t.indexOf(s);for(let u=i.anchorFallsToSurvivingRowInView===!0?i_(t,o,c):(c??t.rowCount)+1;u<t.rowCount&&t.offsetAt(u)<a;u++){const l=e.rows[u];if(l!==void 0&&i.identityOf?.(l).anchorable!==!1&&r.indexOf(l.rowId)!==void 0)return l.rowId}return s}
// Native dependency i_
function i_(e,t,n){if(n===void 0)return e.rowCount;const r=t.scrollTopPx+t.viewportHeightPx;let o=Math.max(0,e.indexAtOffset(t.scrollTopPx));for(;o<e.rowCount-1&&e.offsetAt(o)+e.heightAt(o)<=t.scrollTopPx+ye;)o++;return e.offsetAt(n)>=r?o:Math.max(n+1,o)}
// Native dependency o_
function o_({prevIndex:e,nextIndex:t,nextRows:n,prevAnchorIndex:r,nextAnchorIndex:o}){let s=0;for(let i=0;i<o;i++){const a=n[i],c=a===void 0?void 0:e.indexOf(a.rowId);c===void 0||c>=r||(s+=jd(t,i)-jd(e,c))}return t.offsetAt(o)-e.offsetAt(r)-s}
// Native dependency jd
function jd(e,t){return e.offsetAt(t+1)-e.offsetAt(t)}
export const readerConfig=Object.freeze({nearBottomThresholdPx:4,userInputWindowMs:250,driftTolerancePx:1,releaseHeldShrinkAtCommittedBox:true,anchorFollowsReader:true});
const smoothCauses=new Set(['stream-delta','measured-verification','async-media-resolved','tool-status-change','probe-contract-minted']);
const emptyGeometry=()=>({scrollTopPx:0,viewportHeightPx:0,totalSizePx:0,rows:[],epochId:'initial'});
export function createReaderState(){return {mode:{kind:'pinned-bottom'},input:{kind:'idle'},geometry:emptyGeometry(),programmatic:{kind:'idle'},generation:0,navigation:{kind:'idle'},follow:{kind:'active'},deferred:false};}
const answer=(state,effect,accepted=true)=>({state,effect,accepted});
function geometry(value,previous){
 for(const key of ['scrollTopPx','viewportHeightPx','totalSizePx'])if(!Number.isFinite(value[key]))throw Error('Invalid reader geometry '+key);
 if(value.viewportHeightPx<0||value.totalSizePx<0||!Array.isArray(value.rows))throw Error('Invalid reader geometry');
 const ids=new Set();for(const row of value.rows){if(typeof row.rowId!=='string'||ids.has(row.rowId)||!Number.isFinite(row.topPx)||!Number.isFinite(row.heightPx)||row.heightPx<0)throw Error('Invalid reader row');ids.add(row.rowId);}
 return {...value,epochId:value.epochId??previous.epochId};
}
function rowIndex(rows,total){
 const byId=new Map(rows.map((row,index)=>[row.rowId,index]));
 return {rowCount:rows.length,indexOf:id=>byId.get(id),offsetOf:id=>{const i=byId.get(id);return i===undefined?undefined:rows[i].topPx;},offsetAt:i=>i===rows.length?total:rows[i]?.topPx,heightAt:i=>rows[i]?.heightPx,indexAtOffset:offset=>rows.findIndex(row=>row.topPx+row.heightPx>offset)};
}
function snapshot(state){return {rows:state.geometry.rows,epoch:{id:state.geometry.epochId},viewport:{mode:state.mode,scrollTopPx:state.geometry.scrollTopPx,viewportHeightPx:state.geometry.viewportHeightPx}};}
function frameInput(state,event,g){
 const user=A_({state:state.input,nowMs:event.nowMs,inputWindowMs:readerConfig.userInputWindowMs});
 const own=event.source==='scroll'&&state.programmatic.kind==='awaiting-observation'&&state.programmatic.targetScrollTopPx===g.scrollTopPx;
 return {input:user.state,facts:{nowMs:event.nowMs,scrollTopPx:g.scrollTopPx,viewportHeightPx:g.viewportHeightPx,trigger:event.source==='scroll'?'scroll-observation':'state-change',isProgrammaticScrollActive:Boolean(event.programmaticMotionActive||own),isUserPointerDown:user.isPointerHeld,msSinceUserScrollInput:user.msSinceUserInput,userScrollDir:user.direction,userInput:user.input,navigation:state.navigation,follow:state.follow,isGenerating:Boolean(event.isGenerating),streamingFollowEligible:Boolean(event.streamingFollowEligible)}};
}
function pinObservation(state,g,facts){
 const max=Math.max(0,g.totalSizePx-g.viewportHeightPx),old=state.geometry;
 return bp({isReady:g.viewportHeightPx>0,isScrolling:facts.trigger==='scroll-observation',clampedOffset:Ft({value:g.scrollTopPx,min:0,max}),lastObservedScrollOffset:Ft({value:old.scrollTopPx,min:0,max:Math.max(0,old.totalSizePx-old.viewportHeightPx)}),totalHeight:g.totalSizePx,lastObservedTotalHeight:old.totalSizePx,viewportHeight:g.viewportHeightPx,lastObservedViewportHeight:old.viewportHeightPx,isProgrammaticScrollActive:facts.isProgrammaticScrollActive,nearBottomThresholdPx:readerConfig.nearBottomThresholdPx,msSinceUserScrollInput:facts.msSinceUserScrollInput,userInputWindowMs:readerConfig.userInputWindowMs,isUserPointerDown:facts.isUserPointerDown,userInput:facts.userInput,allowAutomaticRelatch:$p(state.mode,facts.navigation),allowScrollRangeClosedRelatch:facts.navigation.kind==='idle'});
}
function write(state,g,mode,target,reason,motion='instant'){
 const generation=state.generation+1;
 return answer({...state,mode,geometry:{...g,scrollTopPx:motion==='instant'?target:g.scrollTopPx},programmatic:I_(state.programmatic,{kind:'bound-correction-requested',targetScrollTopPx:target}),generation,deferred:false},{topPx:target,reason,motion,generation});
}
function pinned(state,g,facts,pin,cause){
 const max=Math.max(0,g.totalSizePx-g.viewportHeightPx),overscroll=Math.max(0,g.bottomOverscrollPx??0);
 let depth=Math.min(state.mode.kind==='pinned-bottom'?state.mode.overscrollDepthPx??0:0,overscroll);
 if(pin.attribution.kind==='reader'){const extra=g.scrollTopPx-max;depth=extra>=ye?Math.min(extra,overscroll):0;}
 const mode=depth>0?{kind:'pinned-bottom',overscrollDepthPx:depth}:{kind:'pinned-bottom'},target=max+depth,delta=target-g.scrollTopPx;
 const up=facts.msSinceUserScrollInput<=readerConfig.userInputWindowMs&&facts.userInput.kind!=='undirected'&&facts.userInput.direction===-1;
 const held=facts.isUserPointerDown&&facts.follow.kind==='interrupted'&&cause===undefined;
 const correct=facts.follow.kind!=='suspended'&&facts.navigation.kind==='idle'&&!(facts.isProgrammaticScrollActive&&cause===undefined)&&Math.abs(delta)>=ye;
 if(!correct||up||held)return answer({...state,mode,geometry:g,deferred:correct&&(up||held)});
 const reason=cause??(facts.follow.kind==='interrupted'?'stream-delta':undefined);
 const smooth=facts.streamingFollowEligible&&reason!==undefined&&smoothCauses.has(reason)&&delta>ye&&delta<=g.viewportHeightPx;
 return write(state,g,mode,target,reason??'stream-delta',smooth?'smooth':'instant');
}
function anchored(state,g,facts,cause){
 const old=state.geometry,plan=r_({prev:snapshot(state),prevIndex:rowIndex(old.rows,old.totalSizePx),nextIndex:rowIndex(g.rows,g.totalSizePx),nextRows:g.rows,input:facts,maxScrollTop:Math.max(0,g.totalSizePx-g.viewportHeightPx),dominantCause:cause,config:readerConfig,epochChanged:g.epochId!==old.epochId});
 return plan.scroll?write(state,g,plan.mode,plan.scroll.targetScrollTopPx,plan.scroll.reason,plan.scroll.motion):answer({...state,mode:plan.mode,geometry:g,deferred:false});
}
function observe(state,event){
 const g=geometry(event.geometry,state.geometry);let input=state.input;
 if(event.source==='scroll'&&g.scrollTopPx!==state.geometry.scrollTopPx)input=xn(input,{kind:'scroll-direction',direction:g.scrollTopPx>state.geometry.scrollTopPx?1:-1});
 const frame=frameInput({...state,input},event,g),pin=pinObservation(state,g,frame.facts),resolution=xp({kind:state.mode.kind==='pinned-bottom'?'pinned':'released'},pin.event);
 const before={...state,input:frame.input,pinResolution:{...pin,transition:resolution.reason}};
 if(state.navigation.kind!=='idle')return answer({...before,geometry:g,deferred:false});
 const result=resolution.state.kind==='pinned'?pinned(before,g,frame.facts,pin,event.cause):anchored(before,g,frame.facts,event.cause);
 if(event.source==='scroll'&&result.state.generation===state.generation)result.state={...result.state,programmatic:I_(result.state.programmatic,{kind:'scroll-observed'})};
 return result;
}
function input(state,event){
 let next=xn(state.input,event.kind==='pointer-down'?{kind:'pointer-down',atMs:event.nowMs}:event.kind==='pointer-up'?{kind:'pointer-up'}:{kind:'input',atMs:event.nowMs,input:event.direction===0?{kind:'undirected'}:{kind:event.kind,direction:event.direction}});
 const navigation=state.navigation.kind==='idle'?state.navigation:{kind:'idle'};
 const mode=state.navigation.kind==='idle'?state.mode:{kind:'free',lastUserDirection:event.direction??0};
 return answer({...state,input:next,mode,navigation,programmatic:I_(state.programmatic,{kind:'user-input'})});
}
function bottom(state,event){
 if(state.navigation.kind!=='idle')return answer(state,undefined,false);
 const g=geometry(event.geometry,state.geometry);return write(state,g,{kind:'pinned-bottom'},Math.max(0,g.totalSizePx-g.viewportHeightPx),'user-navigation');
}
export function reduceReaderState(state,event){
 switch(event.type){
  case 'input':return input(state,event);
  case 'geometry':return observe(state,event);
  case 'bottom':return bottom(state,event);
  case 'write-applied':return event.generation!==state.generation?answer(state):answer({...state,geometry:{...state.geometry,scrollTopPx:event.scrollTopPx},programmatic:I_(state.programmatic,{kind:'write-applied',observedScrollTopPx:event.scrollTopPx})});
  case 'navigation':return answer({...state,navigation:{kind:event.active?'in-flight':'idle'},...event.release?{mode:{kind:'free',lastUserDirection:event.direction},deferred:false}:{}});
  case 'navigation-write':return write(state,geometry(event.geometry,state.geometry),state.mode,event.topPx,'user-navigation');
  case 'navigation-settle':{
   const g=geometry(event.geometry,state.geometry),target=event.target;
   const mode=target.kind==='row'?{kind:'anchored',rowId:target.rowId,edgeOffsetPx:target.edgeOffsetPx}:target.kind==='bottom'?{kind:'pinned-bottom'}:target.arrivalMode;
   const row=target.kind==='row'?g.rows.find(row=>row.rowId===target.rowId):undefined;
   const top=target.kind==='bottom'?Math.max(0,g.totalSizePx-g.viewportHeightPx):row?row.topPx-target.edgeOffsetPx:target.scrollTopPx??g.scrollTopPx;
   const next={...state,navigation:{kind:'idle'},mode,geometry:g,deferred:false};
   return Math.abs(top-g.scrollTopPx)>=ye?write(next,g,mode,top,'user-navigation'):answer(next);
  }
  case 'follow':return answer({...state,follow:{kind:event.kind}});
  case 'reset':return answer(createReaderState());
  default:throw Error('Unknown reader event '+event.type);
 }
}
export function readerView(state){return {mode:{...state.mode},isPinnedToBottom:state.mode.kind==='pinned-bottom',distanceFromBottomPx:Math.max(0,state.geometry.totalSizePx-state.geometry.scrollTopPx-state.geometry.viewportHeightPx),deferred:state.deferred,generation:state.generation,pinResolution:state.pinResolution};}
