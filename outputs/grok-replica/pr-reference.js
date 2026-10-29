// Native 0.71.2 PR context and markdown-link contracts, independently implemented.
const positive=value=>{const number=typeof value==='number'?value:Number(value);return Number.isInteger(number)&&number>0?number:null;};
const trimmed=value=>typeof value==='string'&&value.trim()?value.trim():null;
const githubPath=/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(\/.*)?$/;
const originHosts=new Set(['cursor.com','staging.cursor.com']);
function httpURL(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url:null;}catch{return null;}}

/** Context candidates deliberately accept suffix paths, unlike rendered root-PR pills. */
export function parsePRCandidateURL(value){
 const url=httpURL(value);if(!url)return null;
 const path=['github.com','www.github.com'].includes(url.hostname.toLowerCase())?/^\/[^/]+\/[^/]+\/pull\/(\d+)(?:\/|$)/:
  ['cursor.com','www.cursor.com','staging.cursor.com'].includes(url.hostname.toLowerCase())?/^\/codebase\/[^/]+\/[^/]+\/pull\/(\d+)(?:\/|$)/:null;
 const match=path?.exec(url.pathname),prNumber=match&&positive(match[1]);return prNumber?{prNumber,url:value}:null;
}
export function extractPRCandidates(text){
 return [...String(text??'').matchAll(/https?:\/\/[^\s<>()[\]]+/g)].flatMap(match=>{
  const candidate=parsePRCandidateURL(match[0].replace(/[.,;:!?]+$/u,''));return candidate?[{...candidate,title:null}]:[];
 });
}

/** Native markdown je(): Origin first, GitHub only when path/search/hash suffix is empty or '/'. */
export function classifyPRLink(value){
 const url=httpURL(value);if(!url)return null;
 const host=url.hostname.toLowerCase(),segments=url.pathname.split('/').filter(Boolean);
 if(originHosts.has(host)&&url.protocol==='https:'&&!url.port&&segments.length===5&&segments[0]==='codebase'&&segments[3]==='pull'){
  const [owner,repo,number]=[segments[1],segments[2],segments[4]],prNumber=Number.parseInt(number,10);
  if(/^[A-Za-z0-9_.-]+$/u.test(owner)&&/^[A-Za-z0-9_.-]+$/u.test(repo)&&prNumber>0&&String(prNumber)===number)return {kind:'origin',prNumber,href:value,canonicalOriginUrl:`https://${host}/codebase/${owner.toLowerCase()}/${repo.toLowerCase()}/pull/${prNumber}`};
 }
 if(!['github.com','www.github.com'].includes(host))return null;
 const match=githubPath.exec(url.pathname);if(!match)return null;
 const suffix=(match[4]??'')+url.search+url.hash,prNumber=positive(match[3]);
 return prNumber&&(suffix===''||suffix==='/')?{kind:'github',prNumber,href:value}:null;
}
function documentSightings(node,result,budget={nodes:0},depth=0){
 if(depth>32||++budget.nodes>4096)return;
 if(!node||typeof node!=='object')return;
 if(node.type==='prReference'){
  const prNumber=positive(node.attrs?.prNumber);if(prNumber)result.push({priority:2,candidate:{prNumber,title:trimmed(node.attrs?.title),url:trimmed(node.attrs?.url)}});
 }else if(node.type==='text'){
  for(const candidate of extractPRCandidates(node.text))result.push({priority:0,candidate});
  for(const mark of Array.isArray(node.marks)?node.marks:[])if(mark?.type==='link'){
   const candidate=parsePRCandidateURL(mark.attrs?.href);if(candidate)result.push({priority:0,candidate:{...candidate,title:null}});
  }
 }
 for(const child of Array.isArray(node.content)?node.content:[])documentSightings(child,result,budget,depth+1);
}
function rowSightings(row){
 const result=[];let document;
 if(typeof row.richText==='string'&&row.richText.length<=262144)try{document=JSON.parse(row.richText);}catch{ /* The native renderer falls back to the actual plain row. */ }
 if(document?.type==='doc'&&Array.isArray(document.content))documentSightings(document,result);
 else for(const candidate of extractPRCandidates(row.text??row.content??row.message?.content))result.push({priority:0,candidate});
 return result;
}
/** Rows are the current conversation's actual visible messages, in chronological order. */
export function collectPRCandidates(rows){
 const result=new Map();
 for(const row of [...rows].reverse())for(const sighting of rowSightings(row)){
  const old=result.get(sighting.candidate.prNumber);
  if(!old||sighting.priority>old.priority)result.set(sighting.candidate.prNumber,sighting);
 }
 return new Map([...result].map(([number,sighting])=>[number,sighting.candidate]));
}
export function resolvePRLabel(link,candidates){
 const candidate=link.kind==='github'?candidates?.get(link.prNumber):null;
 const title=candidate?.url===link.href?trimmed(candidate.title):null;
 return title?`#${link.prNumber} · ${title}`:`#${link.prNumber}`;
}
