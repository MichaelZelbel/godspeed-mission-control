import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,hash} from '../core/records/store.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
if(!/^assistant-state\/[a-f0-9-]{36}\/[a-f0-9]{16}\.json$/.test(input.file))throw new Error('Invalid assistant profile file');
if(JSON.parse(input.text).format!==1)throw new Error('Unsupported assistant state format');
const publish=()=>{const store=new Store(process.env.GODSPEED_WORKSPACE);return store.withLock(()=>{
  const file=path.join(store.root,input.file),old=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null,current=old===null?null:hash(old);
  if(current!==input.expected){
    const id=randomUUID();store.publishFiles([{file:'conflicts/'+id+'.json',text:JSON.stringify({id,kind:'git',path:input.file,base:input.base,local:input.text,remote:old,created_at:new Date().toISOString(),reason:'Concurrent assistant state edit'})}]);
    throw new Error('Assistant state changed concurrently; resolve the retained conflict and restart the assistant');
  }
  if(old===input.text)return;
  store.publishFiles([{file:input.file,text:input.text},...(old===null?[]:[{file:'assistant-state/history/'+path.basename(path.dirname(input.file))+'/'+path.basename(input.file,'.json')+'/'+current+'.json',text:old}])]);
});};
const deadline=Date.now()+10000;
for(;;){try{publish();break;}catch(error){if(Date.now()>=deadline||!['Workspace is being written by another process','Workspace lock requires recovery'].includes(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,50));}}
console.log(hash(input.text));
