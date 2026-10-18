import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Store,hash} from '../core/records/store.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
if(!/^assistant-state\/[a-f0-9-]{36}\/[a-f0-9]{16}\.json$/.test(input.file))throw new Error('Invalid assistant profile file');
const format=JSON.parse(input.text).format;
if(![1,2].includes(format))throw new Error('Unsupported assistant state format');
// Format 2 (6 October 2026): the database file lists its parts, and a save
// sends only the parts that changed, so a message no longer rewrites the whole
// history. A part belongs to its database file's own folder.
const folder=input.file.slice(0,-'.json'.length)+'/',parts=Array.isArray(input.parts)?input.parts:[];
for(const part of parts)if(typeof part.file!=='string'||!part.file.startsWith(folder)||!/^[a-z0-9_]+-[a-f0-9]{6}-\d+\.json$/.test(part.file.slice(folder.length))||!part.delete&&typeof part.text!=='string')throw new Error('Invalid assistant state part');
// Earlier versions are kept, compressed when large, in the device's own history.
const archived=text=>Buffer.byteLength(text)>16384?gzipSync(Buffer.from(text,'utf8')):text;
const historyFor=(file,text)=>{const relative=file.slice('assistant-state/'.length,-'.json'.length),value=archived(text);return {file:'assistant-state/history/'+relative+'/'+hash(text)+(Buffer.isBuffer(value)?'.json.gz':'.json'),text:value};};
// The whole database as one format 1 file, for a conflict a person may read and choose.
function whole(root,manifestText,overrides=new Map()){
  const manifest=JSON.parse(manifestText);if(manifest.format!==2)return manifestText;
  for(const table of manifest.tables)if(!table.rows){table.rows=[];for(const part of table.parts||[]){const text=overrides.get(part.file)??(fs.existsSync(path.join(root,part.file))?fs.readFileSync(path.join(root,part.file),'utf8'):null);if(text!==null)table.rows.push(...JSON.parse(text).rows);}delete table.parts;}
  return JSON.stringify({...manifest,format:1},null,2)+'\n';
}
const publish=()=>{const store=new Store(process.env.GODSPEED_WORKSPACE);return store.withLock(()=>{
  const file=path.join(store.root,input.file),old=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null,current=old===null?null:hash(old);
  if(current!==input.expected){
    const id=randomUUID(),local=whole(store.root,input.text,new Map(parts.filter(p=>!p.delete).map(p=>[p.file,p.text])));
    store.publishFiles([{file:'conflicts/'+id+'.json',text:JSON.stringify({id,kind:'git',path:input.file,base:input.base,local,remote:old===null?null:whole(store.root,old),created_at:new Date().toISOString(),reason:'Concurrent assistant state edit'})}]);
    throw new Error('Assistant state changed concurrently; resolve the retained conflict and restart the assistant');
  }
  if(old===input.text&&!parts.length)return;
  const items=[],history=[];
  for(const part of parts){
    const target=path.join(store.root,part.file),before=fs.existsSync(target)?fs.readFileSync(target,'utf8'):null;
    if(before!==null&&before!==part.text)history.push(historyFor(part.file,before));
    if(part.delete){if(before!==null)items.push({file:part.file,delete:true});}else if(before!==part.text)items.push({file:part.file,text:part.text});
  }
  if(old!==input.text)items.push({file:input.file,text:input.text});
  if(old!==null&&old!==input.text)history.push(historyFor(input.file,old));
  store.publishFiles([...items,...history,...expired(store)]);
});};
// The history is an undo archive nothing reads back; it reached 6.8 GB on a
// working server. Once a day, versions older than 30 days go, keeping the
// newest five of each file whatever their age.
function expired(store){
  const marker=path.join(store.state,'assistant-history-pruned'),today=new Date().toISOString().slice(0,10);
  try{if(fs.readFileSync(marker,'utf8')===today)return [];}catch{}
  fs.mkdirSync(store.state,{recursive:true});fs.writeFileSync(marker,today);
  const base=path.join(store.root,'assistant-state','history'),cutoff=Date.now()-30*86400000,out=[];
  const walk=dir=>{let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
    const files=entries.filter(e=>e.isFile()).map(e=>({name:e.name,at:fs.statSync(path.join(dir,e.name)).mtimeMs})).sort((a,b)=>b.at-a.at);
    for(const f of files.slice(5))if(f.at<cutoff&&out.length<2000)out.push({file:path.relative(store.root,path.join(dir,f.name)).split(path.sep).join('/'),delete:true});
    for(const e of entries)if(e.isDirectory())walk(path.join(dir,e.name));};
  walk(base);return out;
}
const deadline=Date.now()+10000;
for(;;){try{publish();break;}catch(error){if(Date.now()>=deadline||!['Workspace is being written by another process','Workspace lock requires recovery'].includes(error.message))throw error;await new Promise(resolve=>setTimeout(resolve,50));}}
console.log(hash(input.text));
