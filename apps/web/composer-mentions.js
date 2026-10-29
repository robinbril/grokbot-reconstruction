// Independently implemented native @ roster and fuzzy ranking. No person, account
// or notification authority is derived from these presentation references.
export function mentionRoster(current,agents=[]){
 if(!current)return [];
 const group=member=>Boolean(member.group??member.isGroup),ids=member=>Array.isArray(member.memberIds)?member.memberIds:[];
 if(group(current)){const byId=new Map(agents.map(member=>[member.id,member]));return ids(current).flatMap(id=>byId.has(id)?[byId.get(id)]:[]);}
 return agents.filter(member=>member.id!==current.id&&(!group(member)||ids(member).includes(current.id)));
}
export function mentionMemberLabel(member){
 if(member.purpose==='disk-saver'&&member.name==='Disk Saver')return 'Schijfopruimer';
 if(member.name==='New Bot')return 'Nieuwe Bot';
 if(member.name==='New team bot')return 'Nieuwe teambot';
 return member.name;
}
export function mentionIsEveryone(attrs,member){
 return !member&&(typeof attrs.id!=='string'||attrs.id==='__everyone__')&&['everyone','all'].includes(String(attrs.label??'').trim().toLocaleLowerCase('nl'));
}
export function mentionDisplayLabel(attrs,member,{prompt=false}={}){
 const label=prompt?(typeof attrs.label==='string'&&attrs.label.length?attrs.label:typeof attrs.id==='string'?attrs.id:''):attrs.label??attrs.id??'';
 if(member&&member.name===label)return mentionMemberLabel(member);
 return mentionIsEveryone({...attrs,label},member)?'iedereen':label;
}
export function mentionGlyphName(attrs,member){
 return member?(member.group||member.isGroup?'people-3':null):mentionIsEveryone(attrs,member)?'people-3':'person';
}
export function mentionCandidates(current,agents=[]){
 const members=mentionRoster(current,agents),rows=[];
 if((current?.group??current?.isGroup)&&members.length>=2)rows.push({kind:'mention',key:'assistants:__everyone__',id:'__everyone__',category:'assistants',label:'iedereen',insertLabel:'everyone',keywords:['all'],icon:'group',typeLabel:'Bot'});
 for(const member of members)rows.push({kind:'mention',key:`assistants:${member.id}`,id:member.id,category:'assistants',label:mentionMemberLabel(member),insertLabel:member.name,keywords:[],member,icon:member.group||member.isGroup?'group':'bot',typeLabel:member.group||member.isGroup?'Groep':'Bot'});
 return rows;
}
export function normalizeMentionSearch(value,locale='nl'){
 let result='',space=false;
 for(let i=0;i<String(value??'').length;i++){
  let chunk=String(value).charAt(i).normalize('NFKD').replace(/\p{M}+/gu,'').toLocaleLowerCase(locale).replaceAll('ς','σ');
  if(locale==='tr')chunk=chunk.replaceAll('ı','i');
  for(const character of chunk){
   if(!/[\p{L}\p{N}]/u.test(character)){space=true;continue;}
   if(space&&result.length)result+=' ';space=false;result+=character;
  }
 }
 return result;
}
function subsequence(label,query){
 if(!query.length)return 0;let best=null,tries=0;
 for(let start=label.indexOf(query[0]);start>=0&&tries<(query.length<3?1:64);start=label.indexOf(query[0],start+1),tries++){
  const end=Math.min(label.length,start+query.length*3);let score=0,matched=0,last=-2;
  for(let i=start;i<end&&matched<query.length;i++){
   if(label[i]!==query[matched])continue;
   score+=1+(i===0||' -_/.'.includes(label[i-1])?4:0)+(last===i-1?3:0);last=i;matched++;
  }
  if(matched<query.length){if(end===label.length)break;continue;}
  score-=start*.1+label.length*.02;if(best===null||score>best)best=score;
 }
 return best;
}
function matchScore(item,tokens,query){
 const label=normalizeMentionSearch(item.label),values=[label,...(item.keywords??[]).map(value=>normalizeMentionSearch(value))];let score=0;
 for(const token of tokens){const matches=values.map(value=>subsequence(value,token)).filter(value=>value!==null);if(!matches.length)return null;score+=Math.max(...matches);}
 return score+(subsequence(label,query)??0)+(label===query||query.length>=3&&label.includes(query)?100:0);
}
export function rankMentionCandidates(rows,query='',recents=[]){
 const seen=new Set(),unique=rows.filter(row=>!seen.has(row.key)&&seen.add(row.key));
 if(!query.trim().length)return unique;
 const normalized=normalizeMentionSearch(query),tokens=normalized?normalized.split(' '):[];if(!tokens.length)return [];
 return unique.flatMap((entry,index)=>{
  const score=matchScore(entry,tokens,normalized),recent=recents.indexOf(entry.key);
  return score===null?[]:[{entry,index,score,recency:recent<0?0:(recents.length-recent)/recents.length}];
 }).sort((a,b)=>b.score-a.score||b.recency-a.recency||a.index-b.index).map(row=>row.entry);
}
