import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {atomic} from './records/store.mjs';
const notebook=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function assistantEnvironment({home,workspace,env=process.env}={}){
  return {...env,HERMES_HOME:home,GODSPEED_WORKSPACE:workspace,GODSPEED_FILE_HERMES:'1',GODSPEED_NODE:process.execPath,GODSPEED_ASSISTANT_PUBLISHER:path.join(notebook,'scripts','save-assistant-state.mjs'),PYTHONPATH:[path.join(notebook,'assistant-files'),env.PYTHONPATH].filter(Boolean).join(path.delimiter)};
}
export function assistantProfiles(store){
  const directory=path.join(store.root,'assistant-state');if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory).filter(id=>/^[a-f0-9-]{36}$/.test(id)&&fs.statSync(path.join(directory,id)).isDirectory()).map(id=>({id,databases:fs.readdirSync(path.join(directory,id)).filter(n=>n.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(directory,id,name),'utf8')).database)}));
}
export function selectAssistantProfile(store,id){
  if(!assistantProfiles(store).some(profile=>profile.id===id))throw new Error('The restored assistant profile was not found');
  const descriptor=JSON.parse(fs.readFileSync(path.join(store.state,'assistant.json'),'utf8').replace(/^\uFEFF/,'')),home=path.resolve(descriptor.home);
  if(home===path.resolve(process.env.USERPROFILE||process.env.HOME||'/'))throw new Error('Use the configured isolated candidate assistant home');
  const hasDatabase=directory=>fs.existsSync(directory)&&fs.readdirSync(directory,{withFileTypes:true}).some(entry=>entry.isDirectory()?hasDatabase(path.join(directory,entry.name)):entry.name.endsWith('.db'));
  if(hasDatabase(home))throw new Error('Select restored assistant history before first opening the new candidate assistant. Existing assistant database caches require a separate backed-up reset');
  fs.mkdirSync(home,{recursive:true});atomic(path.join(home,'godspeed-file-profile.json'),JSON.stringify({format:1,id}));return {selected:id,home};
}
