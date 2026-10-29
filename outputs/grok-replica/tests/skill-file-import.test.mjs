import test from 'node:test';
import assert from 'node:assert/strict';
const implementation=()=>import('../skill-file-import.js');
test('file planning retains native frontmatter, upload metadata and distinct collision names',async()=>{
 const {planSkillFiles,skillDocument}=await implementation();
 const result=planSkillFiles([
  {path:'notes/Review.md',content:'# Review\n\nFirst instructions'},
  {path:'other/Review.md',content:'# Review\n\nSecond instructions'},
  {path:'robot/SKILL.md',content:'Run the check.'},
  {path:'empty.md',content:' \n'},
 ] ,[]);
 assert.deepEqual(result.skills.map(s=>s.name),['review','review-2','robot']);
 assert.equal(skillDocument(result.skills[0].content).name,'Review');
 assert.equal(skillDocument(result.skills[1].content).name,'Review 2');
 assert.match(result.skills[1].content,/upload-name: 'Review \(2\)\.md'/);
 assert.doesNotMatch(result.skills[2].content,/upload-name:/);
 assert.deepEqual(result.skipped,[{path:'empty.md',reason:'empty'}]);
});
test('exact frontmatter replacement reuses a key once while a second dropped file gets a new key',async()=>{
 const {planSkillFiles}=await implementation();
 const content='---\nname: Review\ndescription: Private instructions\n---\n\nBody';
 const result=planSkillFiles([{path:'a.md',content},{path:'b.md',content}],[{name:'review',content}]);
 assert.deepEqual(result.skills.map(s=>s.name),['review','review-2']);
 assert.match(result.skills[0].content,/name: Review/);
});
test('native UTF16 file cap and scope capacity skip explicitly without truncation',async()=>{
 const {planSkillFiles}=await implementation();
 const files=[{path:'exact.md',content:'x'.repeat(256000)},{path:'large.md',content:'😀'.repeat(128001)}];
 const result=planSkillFiles(files,[]);
 assert.equal(result.skills.length,1);assert.ok(result.skills[0].content.endsWith(files[0].content));
 assert.deepEqual(result.skipped,[{path:'large.md',reason:'too-large'}]);
 const existing=Array.from({length:250},(_,i)=>({name:'skill-'+i,content:'body'}));
 assert.deepEqual(planSkillFiles([{path:'new.md',content:'body'}],existing).skipped,[{path:'new/SKILL.md',reason:'too-many-skills'}]);
 assert.equal(planSkillFiles([{path:'new.md',content:'body'}],existing,{maxSkills:500}).skills.length,1);
});
test('file reading rejects malformed UTF8, first-window NUL and unsupported extensions, preserving BOM decoding',async()=>{
 const {readSkillFiles}=await implementation();
 const data=(path,bytes)=>({path,file:new File([new Uint8Array(bytes)],path)});
 const result=await readSkillFiles([
  data('good.MD',[239,187,191,65,240,159,152,128]),
  data('overlong.md',[192,175]),data('surrogate.md',[237,160,128]),
  data('zero.txt',[65,0,66]),data('unsupported.exe',[65]),
  data('truncated.yaml',[226,130]),
 ]);
 assert.deepEqual(result.text,[{path:'good.MD',content:'A😀'}]);
 assert.deepEqual(result.skipped.map(s=>s.path),['overlong.md','surrogate.md','zero.txt','unsupported.exe','truncated.yaml']);
 assert.ok(result.skipped.every(s=>s.reason==='unsupported'));
});
test('read errors and local aggregate bounds reject without a partial plan or hidden content truncation',async()=>{
 const {readSkillFiles}=await implementation();
 await assert.rejects(readSkillFiles([{path:'ok.md',file:new File(['ok'],'ok.md')},{path:'fail.md',file:{size:1,arrayBuffer:async()=>{throw Error('Read failed');}}}]),/Read failed/);
 await assert.rejects(readSkillFiles([{path:'big.md',file:{size:8388609,arrayBuffer:async()=>{throw Error('Must not read');}}}]),/8 MiB/);
});

test('directory drops read all asynchronous entry batches and preserve nested relative paths',async()=>{
 const {readDroppedSkillFiles,readSkillFiles}=await implementation();
 const leaf=name=>({isFile:true,name,file:resolve=>resolve(new File(['Body '+name],name))});
 const folder=(name,batches)=>({isDirectory:true,name,createReader(){let at=0;return {readEntries(resolve){queueMicrotask(()=>resolve(batches[at++]??[]));}};}});
 const root=folder('skills',[[leaf('one.md')],[folder('nested',[[leaf('two.md')]])]]);
 const files=await readDroppedSkillFiles({items:[{kind:'string'},{kind:'file',webkitGetAsEntry:()=>root}]});
 assert.deepEqual(files.map(file=>file.path),['skills/one.md','skills/nested/two.md']);
 assert.deepEqual((await readSkillFiles(files)).text.map(file=>file.content),['Body one.md','Body two.md']);
 const flat=await readDroppedSkillFiles({items:[],files:[new File(['Plain'],'plain.md')]});
 assert.equal(flat[0].path,'plain.md');
});

test('directory enumeration errors propagate instead of silently importing a prefix',async()=>{
 const {readDroppedSkillFiles}=await implementation();
 const broken={isDirectory:true,name:'broken',createReader:()=>({readEntries(_resolve,reject){reject(Error('Folder unavailable'));}})};
 await assert.rejects(readDroppedSkillFiles({items:[{kind:'file',webkitGetAsEntry:()=>broken}]}),/Folder unavailable/);
});
