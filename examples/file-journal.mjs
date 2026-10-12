import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

// One persistent local directory shared by every process using this bot wallet.
// An interrupted reservation stays reserved: recovery never starts a new trade.
export class FileTradeJournal {
  constructor(directory){this.directory=resolve(directory);}
  path(id){
    if(typeof id!=='string'||!id.length||id.length>128)throw new Error('A stable operationId of 1-128 characters is required.');
    return join(this.directory,createHash('sha256').update(id).digest('hex'));
  }
  async reserve(id,fingerprint){
    const directory=this.path(id);
    await mkdir(this.directory,{recursive:true,mode:0o700});
    try{await mkdir(directory,{mode:0o700});}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const record=await this.read(id);
      if(record.fingerprint!==fingerprint)throw new Error('operationId already belongs to another order.');
      return {created:false,record};
    }
    const record={operationId:id,fingerprint,state:'reserved'};
    await this.save(id,record);
    return {created:true,record};
  }
  async read(id){
    try{return JSON.parse(await readFile(join(this.path(id),'record.json'),'utf8'));}
    catch{throw new Error('Trade journal is unreadable or reservation is incomplete. Do not create a replacement trade ID.');}
  }
  async save(id,record){
    const directory=this.path(id),temp=join(directory,randomUUID()+'.tmp');
    const handle=await open(temp,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(record));await handle.sync();}
    finally{await handle.close();}
    try{await rename(temp,join(directory,'record.json'));}
    finally{await unlink(temp).catch(()=>{});}
  }
}
