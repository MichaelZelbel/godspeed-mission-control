import fs from 'node:fs';
import path from 'node:path';
import { atomic, hash, Store } from './records/store.mjs';
function files(root,prefix=''){
  return fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).flatMap(e=>{
    if(e.isSymbolicLink())throw new Error('Archive cannot follow symbolic links');
    const name=path.posix.join(prefix,e.name);return e.isDirectory()?files(root,name):[name];
  });
}
export function backup(store,mediaRoot,destination){
  store.backup(destination);
  if(fs.existsSync(mediaRoot))fs.cpSync(mediaRoot,path.join(destination,'media'),{recursive:true});
  const device=path.join(destination,'device-config');fs.mkdirSync(device,{recursive:true,mode:0o700});
  for(const name of ['provider.json','assistant.json','assistant-mcp.json','api-keys.json','pair.json','pair-clients.json','sync-config.json','connectors']){const source=path.join(store.state,name);if(fs.existsSync(source))fs.cpSync(source,path.join(device,name),{recursive:true});}
  for(const name of files(device))fs.chmodSync(path.join(device,name),0o600);
  const entries=files(destination).filter(n=>n!=='backup.json').map(name=>({path:name,sha256:hash(fs.readFileSync(path.join(destination,name)))}));
  atomic(path.join(destination,'backup.json'),JSON.stringify({format:1,records:store.scan().size,at:new Date().toISOString(),files:entries},null,2));
  return destination;
}
export function restore(store,mediaRoot,source,{deviceConfig=false}={}){
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'backup.json'),'utf8'));
  if(manifest.format!==1||!Array.isArray(manifest.files))throw new Error('Backup integrity manifest required');
  for(const entry of manifest.files){
    const target=path.resolve(source,entry.path);
    if(!target.startsWith(path.resolve(source)+path.sep)||hash(fs.readFileSync(target))!==entry.sha256)throw new Error('Backup integrity mismatch');
  }
  const verified=new Store(source);if(verified.problems.length||verified.records.size!==manifest.records)throw new Error('Backup reference validation failed');
  if(fs.existsSync(mediaRoot)&&fs.readdirSync(mediaRoot).length)throw new Error('Restore requires empty media storage');
  if(deviceConfig&&fs.existsSync(path.join(source,'device-config')))for(const name of fs.readdirSync(path.join(source,'device-config')))if(fs.existsSync(path.join(store.state,name)))throw new Error('Restore device settings only to an unconfigured candidate');
  const count=store.restore(source);
  if(fs.existsSync(path.join(source,'media')))fs.cpSync(path.join(source,'media'),mediaRoot,{recursive:true});
  if(deviceConfig&&fs.existsSync(path.join(source,'device-config')))for(const name of fs.readdirSync(path.join(source,'device-config')))fs.cpSync(path.join(source,'device-config',name),path.join(store.state,name),{recursive:true});
  return count;
}
