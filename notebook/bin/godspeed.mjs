#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store,atomic } from '../core/records/store.mjs';
import { QueryService } from '../core/query.mjs';
import { SearchIndex } from '../core/index/search.mjs';
import { Domains } from '../core/domains.mjs';
import { backup,restore } from '../core/archives.mjs';
import { importExport,exportRecords,readExportFile } from '../core/import.mjs';
import { seed } from '../core/seeds.mjs';
import { execFileSync } from 'node:child_process';
import {assistantProfiles,selectAssistantProfile} from '../core/assistant-files.mjs';
import {installSkillTree} from '../core/packaged-skills.mjs';
import {planWorkspaceMove,moveWorkspace,undoWorkspaceMove} from '../core/workspace-move.mjs';
import {installStarter,adoptedMissionControl,addArchiveLine} from '../core/starter-workspace.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {listHabits,initializeHabitProgress} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';
import {localParts,now as clockNow} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {rememberFile} from '../core/native-personal.mjs';
// A refusal reads as one plain sentence, not a program's stack trace (GODSPEED_DEBUG=1 shows that too).
for(const event of ['uncaughtException','unhandledRejection'])process.on(event,error=>{process.stderr.write('Error: '+(error?.message||String(error))+'\n'+(process.env.GODSPEED_DEBUG?String(error?.stack||'')+'\n':''));process.exit(1);});
const args=process.argv.slice(2),root=process.env.GODSPEED_WORKSPACE;
// After an update that worked, the installers keep the copy they made before it and remove older
// ones (core/upgrade-copies.mjs). It reads only that folder (and, for a copy made with Git, removes
// the ref that copy kept), so it needs no workspace and never opens the notebook the new version runs.
if(args[0]==='prune-backups'){
 const option=name=>{const at=args.indexOf(name);return at>1?args[at+1]:undefined;};
 const folder=args[1],made=option('--made'),keep=option('--keep');
 if(!folder||folder.startsWith('--')||!made)throw Error('prune-backups FOLDER --made COPY [--keep 1]');
 const {pruneUpgradeCopies}=await import('../core/upgrade-copies.mjs');
 const outcome=pruneUpgradeCopies(folder,{made,...(keep===undefined?{}:{keep:Number(keep)})});
 console.log(JSON.stringify(outcome,null,2));process.exit(outcome.failed.length?1:0);
}
if(!root)throw new Error('Set GODSPEED_WORKSPACE to your mission control folder');
// The copy before an update opens no notebook (core/update-copy.mjs workspaceForCopy): opening it
// reads every one of its files, which on one PC took over a minute of an update's seven-minute copy.
if(args[0]==='backup'&&args.includes('--before-update')){
 const folder=args[1];
 if(!folder||folder.startsWith('--'))throw new Error('Name a new folder for the backup: backup FOLDER [--before-update]');
 const {makeUpdateCopy,workspaceForCopy}=await import('../core/update-copy.mjs');
 const view=workspaceForCopy(root,{device:machineDevice(root).id});
 console.log(JSON.stringify(makeUpdateCopy(view,process.env.GODSPEED_MEDIA_ROOT||path.join(view.state,'media'),path.resolve(folder)),null,2));process.exit(0);
}
if(args[0]==='workspace-move'){
 const [_,action,value,installationFile]=args;
 let outcome;
 if(action==='plan')outcome=planWorkspaceMove({root,to:value,installationFile});
 else if(action==='apply'){const {decodeText}=await import('../core/import.mjs');let plan;try{plan=JSON.parse(decodeText(fs.readFileSync(value)));}catch{throw Error('The move plan '+path.resolve(String(value))+' cannot be read; make a new one with workspace-move plan');}if(path.resolve(plan.source)!==path.resolve(root))throw Error('The reviewed move plan must own the selected workspace');outcome=moveWorkspace(plan);}
 else if(action==='undo'){const receipt=JSON.parse(fs.readFileSync(value,'utf8'));if(path.resolve(receipt.destination)!==path.resolve(root))throw Error('The move receipt must own the selected workspace');outcome=undoWorkspaceMove(value);}
 else throw Error('workspace-move plan DESTINATION INSTALLATION.json | apply PLAN.json | undo RECEIPT.json');
 console.log(JSON.stringify(outcome,null,2));process.exit(0);
}
const store=new Store(root,{device:machineDevice(root).id}),query=new QueryService(store),domains=new Domains(query),media=process.env.GODSPEED_MEDIA_ROOT||path.join(store.state,'media');
const [command,verb,...rest]=args;let result;
if(command==='init'){
  // One read of the notebook serves all of init's questions (Store reuseFor; every write still
  // reads it afresh under the lock). Until 21 October 2026 each question re-read every file: seed
  // asked once per template, and on one PC an update's init took seven minutes.
  store.reuseFor=Infinity;
  seed(store);
  const adopted=adoptedMissionControl(root);
  installStarter(root);
  addArchiveLine(root,store.state);
  const addons=fileURLToPath(new URL('../../third-party/addons/',import.meta.url));
  const recipes=fileURLToPath(new URL('../recipes/',import.meta.url));
  for(const [name,recipe] of [['godspeed-coach','coach'],['godspeed-journal','interstitial-journal'],['mc-phone','phone-errands'],['mc-video','video-finishing']]){
    const source=path.join(addons,name,'skill',recipe);if(fs.existsSync(source)&&!fs.existsSync(path.join(root,'skills',recipe)))fs.cpSync(source,path.join(root,'skills',recipe),{recursive:true});
  }
  if(fs.existsSync(recipes))for(const name of fs.readdirSync(recipes))installSkillTree(store,path.join(recipes,name),path.join(root,'skills',name),{adopted});
  // The note that says what this folder is: NOTEBOOK.md, renamed from FULL-ALPHA.md once where that
  // never leaves this computer through Git, and brought up to date under the name it keeps while it
  // still reads as the notebook wrote it (core/notebook-note.mjs).
  (await import('../core/notebook-note.mjs')).settleNotebookNote(root,{write:true});
  const spec=fs.readFileSync(fileURLToPath(new URL('../../docs/full-version/file-format.md',import.meta.url)),'utf8');
  if(!fs.existsSync(path.join(root,'README.md')))atomic(path.join(root,'README.md'),'# Godspeed Mission Control\n\n'+spec);
  const progressZone=store.get('settings','installation')?.timezone||'UTC',progressDay=localParts(clockNow(),progressZone).date;let progressUpgrades=0;
  for(const habit of listHabits(root))if(!habit.timezone||!habit.progressHistory.some(e=>e.kind==='schedule')) {rememberFile(store,habit.file);if(initializeHabitProgress(habit,progressDay,progressZone).changed)progressUpgrades++;}
  // Last, once everything above is in the folder: a new mission control's first commit (core/first-commit.mjs).
  const committed=(await import('../core/first-commit.mjs')).firstCommit(root);
  if(!committed.made&&/failed/.test(committed.reason))process.stderr.write('The folder\'s first Git commit was not made ('+committed.reason+'); everything else is set up.\n');
  result={initialized:true,preservedExisting:true,habitProgressUpgrades:progressUpgrades,...(committed.made?{firstCommit:{branch:committed.branch,files:committed.files}}:{})};
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
}else if(command==='memory'&&verb==='lookup'){
  result=await domains.invoke('retrieve-memory',{query:rest.join(' ')});
}else if(command==='world'&&verb==='claim')result=domains.writeFact(JSON.parse(fs.readFileSync(rest[0],'utf8')));
// What is no longer true ends: the daily closing, by hand (core/fact-closing.mjs).
else if(command==='world'&&verb==='close')result=await (await import('../core/fact-closing.mjs')).closeFacts({store,query,dryRun:args.includes('--dry-run')});
else if(command==='world'&&verb==='event')result=store.save('moments',JSON.parse(fs.readFileSync(rest[0],'utf8')));
// The whole backup. With --before-update (handled above, before the notebook is opened) it is what
// the installers ask for before they update (core/update-copy.mjs): only what an update can change,
// and in a folder with Git only what its commit does not already hold. An older notebook ignores
// the word and makes its whole backup, so one call serves every version.
else if(command==='backup'){
  if(!verb||verb.startsWith('--'))throw new Error('Name a new folder for the backup: backup FOLDER [--before-update]');
  result=backup(store,media,path.resolve(verb));
}
else if(command==='restore'){
  if(!verb||verb.startsWith('--'))throw new Error('Name the backup folder to restore: restore FOLDER [--repository PATH]');
  const at=rest.indexOf('--repository'),repository=at>=0?rest[at+1]:undefined;
  if(at>=0&&!repository)throw new Error('Name the repository after --repository');
  result=restore(store,media,path.resolve(verb),{repository});
}
else if(command==='import'){
  if(!verb)throw new Error('Name the export file to import: import FILE');
  if(!fs.existsSync(verb))throw new Error('There is no file at '+path.resolve(verb));
  result=importExport(query,readExportFile(fs.readFileSync(verb)));
}
// `export FILE` writes the file itself, always as UTF-8. `export > FILE` still
// works, but Windows PowerShell 5.1 saves what `>` catches as UTF-16 (import reads that too).
else if(command==='export'){
  const exported=exportRecords(store);
  if(verb){if(fs.existsSync(verb))throw new Error('There is already a file at '+path.resolve(verb)+'; name a new one');atomic(path.resolve(verb),JSON.stringify(exported,null,2)+'\n');result={exported:exported.records.length,file:path.resolve(verb)};}
  else result=exported;
}
else if(command==='validate')result={problems:store.scan()&&store.problems};
// The food tracker's table (D-321 step 5): downloaded once at setup, checked against its pinned
// checksum, offline after that (core/food-table.mjs).
else if(command==='food-table'&&verb==='install')result=await (await import('../core/food-table.mjs')).installFoodTable(store.state,{force:rest.includes('--force')});
else if(command==='food-table'&&verb==='status')result=(await import('../core/food-table.mjs')).tableStatus(store.state);
else if(command==='menerio'&&verb==='chunks')result=(await import('../core/menerio-chunks.mjs')).importOrphanChunks(store,path.resolve(rest[0]));
// Named paths: folder mode with those paths. None (what the installers run when they
// join a computer to a mission control already on GitHub): joinRepository decides.
else if(command==='sync'&&verb==='folder'){const sync=await import('../core/sync/git.mjs');result=rest.length?await sync.useFolderRepository(store,rest):await sync.joinRepository(store);}
else if(command==='convert-notebook'){
  // The whole list can run to thousands of lines: it goes to a file, the
  // summary to the screen.
  const dryRun=args.includes('--dry-run'),outcome=(await import('../core/convert-notebook.mjs')).convertNotebook(store,{dryRun});
  const list=path.join(store.state,dryRun?'convert-notebook-dry-run.json':'convert-notebook-report.json');atomic(list,JSON.stringify(outcome,null,2));
  const {renamed=[],rewritten=[],problems,...summary}=outcome;
  result={...summary,renamed:renamed.length,rewritten:rewritten.length,...(problems?{problems}:{}),first_renames:renamed.slice(0,10).map(r=>r.from+' -> '+r.to),full_list:list};
}
else throw new Error('Commands: init, record list/get/save/merge/remove/display-name, memory search/lookup, world claim/event/close [--dry-run], backup FOLDER [--before-update], prune-backups FOLDER --made COPY [--keep 1], restore FOLDER [--repository PATH], import FILE, export [FILE], validate, sync folder [PATH...], menerio chunks ARCHIVE_SOURCE_DIR, convert-notebook [--dry-run]');
console.log(JSON.stringify(result,null,2));
