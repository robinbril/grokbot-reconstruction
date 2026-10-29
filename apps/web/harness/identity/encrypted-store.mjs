import {mkdir,readFile,open,rename,chmod} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
export class EncryptedStore {
 constructor(dataDir){this.dir=path.join(dataDir,'identity');this.filename=path.join(this.dir,'accounts.enc');}
 async init(){
  await mkdir(this.dir,{recursive:true,mode:0o700});await chmod(this.dir,0o700);const keyFile=path.join(this.dir,'accounts.key');
  try{this.key=await readFile(keyFile);}catch(error){if(error.code!=='ENOENT')throw error;const handle=await open(keyFile,'wx',0o600);try{this.key=randomBytes(32);await handle.writeFile(this.key);await handle.sync();}finally{await handle.close();}}
  await chmod(keyFile,0o600);if(this.key.length!==32)throw Error('Invalid credential encryption key');
  try{const record=JSON.parse(await readFile(this.filename,'utf8'));const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(record.iv,'base64'));decipher.setAuthTag(Buffer.from(record.tag,'base64'));this.data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ciphertext,'base64')),decipher.final()]).toString());await chmod(this.filename,0o600);}catch(error){if(error.code!=='ENOENT')throw error;this.data={accounts:[],flows:[],requests:{}};}
  return this;
 }
 async save(){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(this.data)),cipher.final()]);const record={schema:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  const temporary=this.filename+'.'+randomUUID()+'.tmp',handle=await open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}await rename(temporary,this.filename);
 }
}
