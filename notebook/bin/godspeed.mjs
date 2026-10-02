#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store,atomic } from '../core/records/store.mjs';
import { QueryService } from '../core/query.mjs';
import { SearchIndex } from '../core/index/search.mjs';
import { Domains } from '../core/domains.mjs';
import { backup,restore } from '../core/archives.mjs';
import { importExport } from '../core/import.mjs';
import { seed } from '../core/seeds.mjs';
import { execFileSync } from 'node:child_process';
import {assistantProfiles,selectAssistantProfile} from '../core/assistant-files.mjs';
const args=process.argv.slice(2),root=process.env.GODSPEED_WORKSPACE;if(!root)throw new Error('Set GODSPEED_WORKSPACE to your candidate workspace');
const store=new Store(root,{device:process.env.GODSPEED_DEVICE||'local'}),query=new QueryService(store),domains=new Domains(query),media=process.env.GODSPEED_MEDIA_ROOT||path.join(store.state,'media');
const [command,verb,...rest]=args;let result;
if(command==='init'){
  seed(store);
  const starter=fileURLToPath(new URL('../../starter-godspeed/',import.meta.url));
  for(const name of ['AGENTS.md','CLAUDE.md','profile','rules','skills','procedures.md'])if(!fs.existsSync(path.join(root,name)))fs.cpSync(path.join(starter,name),path.join(root,name),{recursive:true});
  const addons=fileURLToPath(new URL('../../third-party/addons/',import.meta.url));
  const recipes=fileURLToPath(new URL('../recipes/',import.meta.url));
  for(const [name,recipe] of [['godspeed-coach','coach'],['godspeed-journal','interstitial-journal'],['mc-phone','phone-errands'],['mc-video','video-finishing']]){
    const source=path.join(addons,name,'skill',recipe);if(fs.existsSync(source)&&!fs.existsSync(path.join(root,'skills',recipe)))fs.cpSync(source,path.join(root,'skills',recipe),{recursive:true});
  }
  if(fs.existsSync(recipes))for(const name of fs.readdirSync(recipes))if(!fs.existsSync(path.join(root,'skills',name)))fs.cpSync(path.join(recipes,name),path.join(root,'skills',name),{recursive:true});
  const contract=path.join(root,'FULL-ALPHA.md');if(!fs.existsSync(contract))atomic(contract,'# File runtime\n\nUser records live in records/. SQLite is disposable. Use the notebook or local MCP tools for structured edits, facts and events. File sync uses the conflict-preserving reconciler; never run git pull --rebase on a connected workspace. Use the notebook control desk for schedules, owner, search, backups and connector configuration. This contract overrides older starter instructions referring to cloud storage or legacy world commands. Credentials stay in .godspeed local device configuration, outside private Git sync.\n');
  const spec=fs.readFileSync(fileURLToPath(new URL('../../docs/full-version/file-format.md',import.meta.url)),'utf8');
  if(!fs.existsSync(path.join(root,'README.md')))atomic(path.join(root,'README.md'),'# Godspeed Mission Control\n\n'+spec);
  result={initialized:true,preservedExisting:true};
}else if(['coach','journal'].includes(command)){
  const addon=command==='coach'?'godspeed-coach':'godspeed-journal';
  const executable=fileURLToPath(new URL('../../third-party/addons/'+addon+'/bin/'+addon+'.mjs',import.meta.url));
  process.stdout.write(execFileSync(process.execPath,[executable,verb,...rest,'--godspeed',root],{encoding:'utf8',windowsHide:true,env:{...process.env,GODSPEED_COACH_GIT_SYNC:'off',GODSPEED_JOURNAL_GIT_SYNC:'off'}}));process.exit(0);
}else if(command==='assistant'&&verb==='profiles')result=assistantProfiles(store);
else if(command==='assistant'&&verb==='select')result=selectAssistantProfile(store,rest[0]);
else if(command==='record'){
  const [type,id]=rest;
  if(verb==='list')result=query.rows(type);
  else if(verb==='get')result=store.get(type,id);
  else if(verb==='save')result=store.save(type,JSON.parse(fs.readFileSync(id,'utf8')));
  else if(['merge','remove','display-name','rename'].includes(verb))result=type==='moments'&&['remove','display-name'].includes(verb)?query.execute({table:type,operation:verb==='remove'?'delete':'update',values:{title:rest[2]},filters:[['eq','id',id]]}).data:store.structural(type,id,verb,verb==='merge'?{target:rest[2]}:verb==='rename'?{id:rest[2]}:{name:rest[2]});
  else throw new Error('Unknown record command');
}else if(command==='memory'&&verb==='search'){
  const index=new SearchIndex(store);result=index.search(rest.join(' '));index.close();
}else if(command==='world'&&verb==='claim')result=domains.writeFact(JSON.parse(fs.readFileSync(rest[0],'utf8')));
else if(command==='world'&&verb==='event')result=store.save('moments',JSON.parse(fs.readFileSync(rest[0],'utf8')));
else if(command==='backup')result=backup(store,media,path.resolve(verb));
else if(command==='restore')result=restore(store,media,path.resolve(verb));
else if(command==='import')result=importExport(query,JSON.parse(fs.readFileSync(verb,'utf8')));
else if(command==='export')result={format:1,records:[...store.scan().values()].map(r=>{const copy={...r};delete copy._hash;return copy;})};
else if(command==='validate')result={problems:store.scan()&&store.problems};
else throw new Error('Commands: init, record list/get/save/merge/remove/display-name, memory search, world claim/event, backup, restore, import, export, validate');
console.log(JSON.stringify(result,null,2));
