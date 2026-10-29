// Recovered native file planner. Local read budgets and caller scope are explicit
// adapters; these functions do not install scripts or grant tool permissions.
const frontmatter=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const extensions=['txt','md','markdown','csv','json','yaml','yml'];
export const acceptedSkillFileTypes=extensions.map(value=>'.'+value).join(',');
const fileName=value=>value.slice(value.lastIndexOf('/')+1);
const stem=value=>value.lastIndexOf('.')>0?value.slice(0,value.lastIndexOf('.')):value;
const slug=value=>value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
export const normalizeSkillPath=value=>value.replace(/\\/g,'/').split('/').filter(part=>part.length>0&&part!=='.').join('/');
export function supportedSkillFile(path){const name=fileName(path),dot=name.lastIndexOf('.');return dot>0&&extensions.includes(name.slice(dot+1).toLowerCase());}
function field(text,key){
 const prefix=key+':',line=text.split(/\r?\n/).find(value=>value.startsWith(prefix));
 if(line===undefined)return '';
 let value=line.slice(prefix.length).trim();
 if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
 return value;
}
export function skillDocument(content){
 const match=frontmatter.exec(content);
 return match?{name:field(match[1]??'','name'),description:field(match[1]??'','description'),body:content.slice(match[0].length)}:{name:'',description:'',body:content};
}
function withName(name,content){
 const title=name.trim(),match=frontmatter.exec(content);
 if(!match)return `---\nname: ${title}\n---\n\n${content.replace(/^\n+/,'')}`;
 let found=false;
 const lines=(match[1]??'').split(/\r?\n/).map(line=>line.startsWith('name:')?(found=true,`name: ${title}`):line);
 if(!found)lines.unshift(`name: ${title}`);
 const body=content.slice(match[0].length);
 return `---\n${lines.join('\n')}\n---\n${body.startsWith('\n')||body.length===0?body:'\n'+body}`;
}
function withUpload(content,extension,name=''){
 const lines=['origin: upload'];
 if(extension)lines.push(`upload-extension: ${extension}`);
 const clean=name.replace(/[\r\n]+/g,' ').trim();
 if(clean)lines.push(`upload-name: '${clean.replaceAll("'","''")}'`);
 const match=frontmatter.exec(content);
 if(!match)return `---\n${lines.join('\n')}\n---\n\n${content.replace(/^\n+/,'')}`;
 const prior=(match[1]??'').split(/\r?\n/).filter(line=>!['origin:','upload-extension:','upload-name:'].some(prefix=>line.startsWith(prefix)));
 const body=content.slice(match[0].length);
 return `---\n${[...prior,...lines].join('\n')}\n---\n${body.startsWith('\n')||body.length===0?body:'\n'+body}`;
}
function uploadName(skill){
 const header=frontmatter.exec(skill.content)?.[1]??'';
 const explicit=/^upload-name:[ \t]*(.+?)[ \t]*$/m.exec(header)?.[1]??'';
 if(explicit)return /^'(.*)'$/.exec(explicit)?.[1]?.replaceAll("''","'")??explicit;
 const title=skillDocument(skill.content).name.trim()||skill.name;
 const extension=/^upload-extension:[ \t]*(\.[^\s.]+)[ \t]*$/m.exec(header)?.[1]??'';
 return title.endsWith(extension)?title:title+extension;
}
function pathTitle(path){
 const name=fileName(path),parent=path.lastIndexOf('/')>0?fileName(path.slice(0,path.lastIndexOf('/'))):'';
 return name==='SKILL.md'&&parent?parent:stem(name);
}
function unique(base,taken,suffix){let name=base,index=2;while(taken.has(name))name=suffix(base,index++);taken.add(name);return name;}
function namespace(existing){
 const onBot=new Map(existing.map(skill=>[skill.name,skillDocument(skill.content).name.trim()]));
 const titles=new Set([...onBot].map(([name,title])=>slug(title||name)));
 const fileNames=new Set(existing.filter(skill=>/^origin:[ \t]*upload[ \t]*$/m.test(frontmatter.exec(skill.content)?.[1]??'')).map(skill=>uploadName(skill).toLowerCase()));
 return {onBot,taken:new Set(onBot.keys()),planned:new Set(),titles,fileNames};
}
function uniqueTitle(title,state){
 const dashed=slug(title)===title;let result=title,index=2;
 while(state.titles.has(slug(result)))result=dashed?`${title}-${index++}`:`${title} ${index++}`;
 state.titles.add(slug(result));return result;
}
function uniqueFile(name,state){
 const base=stem(name),extension=name.slice(base.length);let result=name,index=2;
 while(state.fileNames.has(result.toLowerCase()))result=`${base} (${index++})${extension}`;
 state.fileNames.add(result.toLowerCase());return result;
}
function planFile(file,state){
 const parsed=skillDocument(file.content),original=parsed.name.trim(),fromHeader=slug(original).length>0;
 const key=fromHeader?slug(original):slug(pathTitle(file.path))||'skill';
 const reuse=fromHeader&&state.onBot.get(key)===original&&!state.planned.has(key);
 const name=reuse?key:unique(key,state.taken,(base,index)=>`${base}-${index}`);
 state.taken.add(name);state.planned.add(name);
 const basename=fileName(file.path),extension=basename.slice(stem(basename).length);
 if(fromHeader)return {name,content:withUpload(file.content,extension)};
 const first=parsed.body.split(/\r?\n/).find(line=>line.trim().length>0)??'';
 const heading=/^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(first)?.[1];
 const title=heading||pathTitle(file.path),display=title===key?name:uniqueTitle(title,state);
 if(display===name)state.titles.add(name);
 return {name,content:withUpload(withName(display,file.content),extension,basename==='SKILL.md'?'':uniqueFile(basename,state))};
}
export function planSkillFiles(files,existing,{maxSkills=250}={}){
 const skipped=[],valid=[];
 for(const file of files){
  const path=normalizeSkillPath(file.path);if(!path)continue;
  if(!file.content.trim()){skipped.push({path,reason:'empty'});continue;}
  if(file.content.length>256000){skipped.push({path,reason:'too-large'});continue;}
  valid.push({path,content:file.content});
 }
 const state=namespace(existing),capacity=Math.max(0,maxSkills-state.onBot.size),planned=valid.map(file=>planFile(file,state));
 for(const skill of planned.slice(capacity))skipped.push({path:`${skill.name}/SKILL.md`,reason:'too-many-skills'});
 return {skills:planned.slice(0,capacity),skipped};
}
export function isSkillText(bytes){
 if(bytes.subarray(0,Math.min(bytes.length,8192)).includes(0))return false;
 try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return true;}catch{return false;}
}
function readBytes(file){
 if(typeof file.arrayBuffer==='function')return file.arrayBuffer().then(buffer=>new Uint8Array(buffer));
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onerror=()=>reject(reader.error??new Error('Bestand lezen mislukt.'));
  reader.onload=()=>resolve(reader.result instanceof ArrayBuffer?new Uint8Array(reader.result):new Uint8Array());
  reader.readAsArrayBuffer(file);
 });
}
export async function readSkillFiles(files){
 // Local adapter read budget, separate from native per-file UTF16 planning cap.
 if(files.length>2000||files.reduce((sum,{file})=>sum+(file.size??0),0)>8*1024*1024)throw Error('Importeer maximaal 2000 bestanden en 8 MiB per keer.');
 const text=[],skipped=[];let bytesRead=0;
 for(const {path,file} of files){
  if(!supportedSkillFile(path)){skipped.push({path,reason:'unsupported'});continue;}
  const bytes=await readBytes(file);bytesRead+=bytes.length;
  if(bytesRead>8*1024*1024)throw Error('Importeer maximaal 8 MiB per keer.');
  if(!isSkillText(bytes)){skipped.push({path,reason:'unsupported'});continue;}
  text.push({path,content:new TextDecoder('utf-8').decode(bytes)});
 }
 return {text,skipped};
}
async function directoryEntries(entry){
 const reader=entry.createReader(),all=[];
 for(;;){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)return all;all.push(...batch);if(all.length>2000)throw Error('Importeer maximaal 2000 bestanden per keer.');}
}
async function walk(entry,prefix,files){
 const path=prefix?prefix+'/'+entry.name:entry.name;
 if(entry.isFile){files.push({path,file:await new Promise((resolve,reject)=>entry.file(resolve,reject))});if(files.length>2000)throw Error('Importeer maximaal 2000 bestanden per keer.');return;}
 if(entry.isDirectory)for(const child of await directoryEntries(entry))await walk(child,path,files);
}
export async function readDroppedSkillFiles(transfer){
 const entries=Array.from(transfer.items??[]).filter(item=>item.kind==='file').map(item=>item.webkitGetAsEntry?.()).filter(Boolean);
 if(!entries.length)return Array.from(transfer.files??[]).map(file=>({path:file.name,file}));
 const files=[];for(const entry of entries)await walk(entry,'',files);return files;
}
