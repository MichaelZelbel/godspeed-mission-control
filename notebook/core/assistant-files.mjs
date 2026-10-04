import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {atomic} from './records/store.mjs';
const notebook=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function assistantEnvironment({home,workspace,env=process.env}={}){
  return {...env,HERMES_HOME:home,GODSPEED_DIR:workspace,GODSPEED_ROOT:workspace,GODSPEED_VIDEO_HOME:path.join(workspace,".godspeed","video"),GODSPEED_MAIL_HOME:path.join(workspace,".godspeed","device-home"),GODSPEED_WORKSPACE:workspace,GODSPEED_FILE_HERMES:env.GODSPEED_ORIGINAL_RUNTIME==='on'?'0':'1',GODSPEED_NODE:process.execPath,GODSPEED_HEADACHE_DIR:workspace,GODSPEED_HEADACHE_SCRIPT:path.resolve(notebook,'../third-party/addons/godspeed-headache/bin/godspeed-headache.mjs'),GODSPEED_HEADACHE_GIT_SYNC:'off',GODSPEED_COACH_DIR:workspace,GODSPEED_JOURNAL_DIR:workspace,GODSPEED_COACH_SCRIPT:path.resolve(notebook,'../third-party/addons/godspeed-coach/bin/godspeed-coach.mjs'),GODSPEED_JOURNAL_SCRIPT:path.resolve(notebook,'../third-party/addons/godspeed-journal/bin/godspeed-journal.mjs'),GODSPEED_COACH_GIT_SYNC:'off',GODSPEED_JOURNAL_GIT_SYNC:'off',PATH:[path.join(home,'bin'),env.PATH].filter(Boolean).join(path.delimiter),GODSPEED_ASSISTANT_PUBLISHER:path.join(notebook,'scripts','save-assistant-state.mjs'),PYTHONPATH:[path.join(notebook,'assistant-files'),env.PYTHONPATH].filter(Boolean).join(path.delimiter)};
}
export function assistantProfiles(store){
  const directory=path.join(store.root,'assistant-state');if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory).filter(id=>/^[a-f0-9-]{36}$/.test(id)&&fs.statSync(path.join(directory,id)).isDirectory()).map(id=>({id,databases:fs.readdirSync(path.join(directory,id)).filter(n=>n.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(directory,id,name),'utf8')).database)}));
}
export function validateAssistantFiles(root){
  const directory=path.join(root,'assistant-state');if(!fs.existsSync(directory))return;
  for(const id of fs.readdirSync(directory).filter(id=>/^[a-f0-9-]{36}$/.test(id))){
    for(const name of fs.readdirSync(path.join(directory,id)).filter(name=>name.endsWith('.json'))){
      const snapshot=JSON.parse(fs.readFileSync(path.join(directory,id,name),'utf8'));
      if(snapshot.format!==1||snapshot.profile!==id||typeof snapshot.database!=='string'||!Array.isArray(snapshot.tables))throw new Error('Assistant state identity needs review: '+id+'/'+name);
    }
  }
}
export function selectAssistantProfile(store,id){
  if(!assistantProfiles(store).some(profile=>profile.id===id))throw new Error('The restored assistant profile was not found');
  const descriptor=JSON.parse(fs.readFileSync(path.join(store.state,'assistant.json'),'utf8').replace(/^\uFEFF/,'')),home=path.resolve(descriptor.home);
  if(home===path.resolve(process.env.USERPROFILE||process.env.HOME||'/'))throw new Error('Use the configured isolated candidate assistant home');
  const hasDatabase=directory=>fs.existsSync(directory)&&fs.readdirSync(directory,{withFileTypes:true}).some(entry=>entry.isDirectory()?hasDatabase(path.join(directory,entry.name)):entry.name.endsWith('.db'));
  if(hasDatabase(home))throw new Error('Select restored assistant history before first opening the new candidate assistant. Existing assistant database caches require a separate backed-up reset');
  fs.mkdirSync(home,{recursive:true});atomic(path.join(home,'godspeed-file-profile.json'),JSON.stringify({format:1,id}));return {selected:id,home};
}
