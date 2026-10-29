import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Store,atomic} from '../core/records/store.mjs';
import {FileSync,joinRepository,useFolderRepository} from '../core/sync/git.mjs';
import {syncedFiles} from '../core/file-policy.mjs';
import {settleNotebookNote,carryIgnoreLine,notebookNoteText} from '../core/notebook-note.mjs';

// THE NOTEBOOK'S NOTE IS NOTEBOOK.md (2.0.0-beta.11, ticket 08 of that release). Every mission
// control with the notebook, on every system, had FULL-ALPHA.md at its top: the first file a
// newcomer saw in their folder, under a name the product no longer has. A new install writes
// NOTEBOOK.md. An update renames the old note once, but only where it never leaves this computer
// through Git: where it does, another computer of the same folder may still run 2.0.0-beta.10,
// which knows only FULL-ALPHA.md, so there it keeps its name in this release.
const cli=fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url));
const temp=name=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-notebook-note-'+name+'-'));
// `init` is what every installer runs on an install and on an update.
function init(root){
  const run=spawnSync(process.execPath,['--no-warnings',cli,'init'],{env:{...process.env,GODSPEED_WORKSPACE:root},encoding:'utf8',windowsHide:true});
  assert.equal(run.status,0,run.stderr);return run;
}
const read=(root,name)=>fs.readFileSync(path.join(root,name),'utf8');
const has=(root,name)=>fs.existsSync(path.join(root,name));
const git=(root,...args)=>spawnSync('git',['-C',root,'-c','user.name=Owner','-c','user.email=owner@localhost',...args],{encoding:'utf8',windowsHide:true});
// The note as 2.0.0-beta.10 wrote it is today's text; the one before notebook/ had its name said records/.
const recordsText='# Integrated notebook\n\nThis is the complete Godspeed Mission Control starter with an integrated notebook. AGENTS.md and the original folder workflow remain the operating manual. Notebook records live in records/ alongside those folders. Use the notebook or its MCP tools for notebook edits; use the original commands and readable files for Godspeed work. Credentials and disposable SQLite indexes stay in .godspeed and never enter private Git sync. Connected file sync uses the conflict-preserving reconciler; do not run a second Git synchronizer on the same workspace.\n';

test('a new mission control gets NOTEBOOK.md and no FULL-ALPHA.md',()=>{
  const root=temp('new');init(root);
  assert.equal(read(root,'NOTEBOOK.md'),notebookNoteText);
  assert.equal(has(root,'FULL-ALPHA.md'),false);
});

test('an update renames the note an earlier version wrote, once, and brings it up to date',()=>{
  for(const earlier of [notebookNoteText,recordsText]){
    const root=temp('update');fs.writeFileSync(path.join(root,'FULL-ALPHA.md'),earlier);
    init(root);
    assert.equal(read(root,'NOTEBOOK.md'),notebookNoteText);
    assert.equal(has(root,'FULL-ALPHA.md'),false,'the old name is gone');
    init(root);
    assert.equal(read(root,'NOTEBOOK.md'),notebookNoteText,'a second update leaves it as it is');
  }
});

test('a note the owner edited keeps its text under the new name',()=>{
  const root=temp('edited');fs.writeFileSync(path.join(root,'FULL-ALPHA.md'),'My own notes about this folder.\n');
  init(root);
  assert.equal(read(root,'NOTEBOOK.md'),'My own notes about this folder.\n');
  assert.equal(has(root,'FULL-ALPHA.md'),false);
});

test('with both names there, NOTEBOOK.md is kept, FULL-ALPHA.md is left alone, and the start says so once',()=>{
  const root=temp('both');fs.writeFileSync(path.join(root,'NOTEBOOK.md'),'Mine.\n');fs.writeFileSync(path.join(root,'FULL-ALPHA.md'),recordsText);
  init(root);
  assert.equal(read(root,'NOTEBOOK.md'),'Mine.\n');
  assert.equal(read(root,'FULL-ALPHA.md'),recordsText,'not renamed, not brought up to date, not removed');
  // What the notebook's start does (server/main.mjs): its log is what `say` writes.
  const said=[];for(let i=0;i<3;i++)assert.equal(settleNotebookNote(root,{say:line=>said.push(line)}).state,'both');
  assert.equal(said.length,1,'said once, not at every start');
  assert.match(said[0],/both NOTEBOOK\.md and FULL-ALPHA\.md\. The notebook uses NOTEBOOK\.md and leaves FULL-ALPHA\.md as it is/);
  assert.equal(read(root,'FULL-ALPHA.md'),recordsText);
});

test('the start renames a note no init has renamed yet',()=>{
  const root=temp('start');fs.writeFileSync(path.join(root,'FULL-ALPHA.md'),'Mine.\n');const said=[];
  assert.equal(settleNotebookNote(root,{say:line=>said.push(line)}).state,'renamed');
  assert.equal(read(root,'NOTEBOOK.md'),'Mine.\n');assert.equal(has(root,'FULL-ALPHA.md'),false);assert.deepEqual(said,[]);
});

// An owner's repository with an ignore file and some history: their own mission control. With
// `remote`, it has a copy elsewhere that other computers pull from.
function ownersFolder(name,ignore,{remote=false}={}){
  const root=temp(name);
  assert.equal(git(root,'init','-q','-b','main').status,0);
  fs.writeFileSync(path.join(root,'.gitignore'),ignore);fs.writeFileSync(path.join(root,'AGENTS.md'),'Owner manual\n');
  assert.equal(git(root,'add','-A').status,0);assert.equal(git(root,'commit','-qm','Owner').status,0);
  if(remote){const bare=temp(name+'-remote');assert.equal(git(bare,'init','-q','--bare').status,0);assert.equal(git(root,'remote','add','origin',bare).status,0);assert.equal(git(root,'push','-q','origin','main').status,0);}
  return root;
}
const ignored=(root,name)=>git(root,'check-ignore','-q','--',name).status===0;
const status=root=>git(root,'status','--porcelain','--untracked-files=all','--','.gitignore','NOTEBOOK.md','FULL-ALPHA.md').stdout.split('\n').filter(Boolean).sort();
const exclude=root=>read(root,'.git/info/exclude');

test('a folder whose ignore file lists /FULL-ALPHA.md is renamed, and keeps NOTEBOOK.md out of its commits through its own exclude file',()=>{
  // The note never leaves this computer, so the copy elsewhere changes nothing for other computers.
  const ignore='/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n',root=ownersFolder('ignores',ignore,{remote:true});
  fs.writeFileSync(path.join(root,'FULL-ALPHA.md'),notebookNoteText);
  init(root);
  assert.equal(read(root,'NOTEBOOK.md'),notebookNoteText);assert.equal(has(root,'FULL-ALPHA.md'),false);
  assert.equal(read(root,'.gitignore'),ignore,'the owner\'s tracked ignore file is untouched');
  assert.match(exclude(root),/\n\/NOTEBOOK\.md\n$/,'the line is in this clone\'s own exclude file');
  assert.ok(ignored(root,'NOTEBOOK.md'),'NOTEBOOK.md is ignored as FULL-ALPHA.md was');
  assert.deepEqual(status(root),[],'nothing of the note or the ignore file shows to the owner\'s Git');
  init(root);assert.equal((exclude(root).match(/NOTEBOOK/g)||[]).length,1,'the line goes in once');
});

test('a folder whose own Git commits its note but has no copy elsewhere is renamed, and goes on committing it',()=>{
  // Committed (the first commit of a new installation holds it), and an ignore line added later,
  // which Git does not apply to a file it already tracks.
  const root=ownersFolder('commits','/.godspeed/\n');
  fs.writeFileSync(path.join(root,'FULL-ALPHA.md'),notebookNoteText);
  assert.equal(git(root,'add','FULL-ALPHA.md').status,0);assert.equal(git(root,'commit','-qm','The note').status,0);
  fs.appendFileSync(path.join(root,'.gitignore'),'/FULL-ALPHA.md\n');assert.equal(git(root,'commit','-qam','Ignore the note').status,0);
  const ignoreBefore=read(root,'.gitignore');
  init(root);
  assert.equal(read(root,'.gitignore'),ignoreBefore);
  assert.equal(ignored(root,'NOTEBOOK.md'),false,'no line: the old note was committed, not ignored');
  assert.deepEqual(status(root),[' D FULL-ALPHA.md','?? NOTEBOOK.md']);
  assert.equal(git(root,'add','-A').status,0);assert.equal(git(root,'commit','-qm','Update').status,0);
  const tracked=git(root,'ls-files').stdout.split('\n');
  assert.ok(tracked.includes('NOTEBOOK.md')&&!tracked.includes('FULL-ALPHA.md'),'the owner\'s next commit takes the note under its new name');
});

test('a folder whose own repository has a copy elsewhere and carries the note there keeps FULL-ALPHA.md, with no NOTEBOOK.md beside it',()=>{
  // Tracked: the owner's pulls bring the note to their other computers, which may still run beta.10.
  const tracked=ownersFolder('tracked','/.godspeed/\n',{remote:true});
  fs.writeFileSync(path.join(tracked,'FULL-ALPHA.md'),recordsText);
  assert.equal(git(tracked,'add','FULL-ALPHA.md').status,0);assert.equal(git(tracked,'commit','-qm','The note').status,0);
  init(tracked);
  assert.equal(read(tracked,'FULL-ALPHA.md'),notebookNoteText,'kept, and brought up to date as 2.0.0-beta.10 does');
  assert.equal(has(tracked,'NOTEBOOK.md'),false);
  // Neither tracked nor ignored: the owner's next commit would carry it.
  const visible=ownersFolder('visible','/.godspeed/\n',{remote:true});
  fs.writeFileSync(path.join(visible,'FULL-ALPHA.md'),notebookNoteText);
  init(visible);
  assert.equal(has(visible,'FULL-ALPHA.md'),true);assert.equal(has(visible,'NOTEBOOK.md'),false);
  assert.equal(settleNotebookNote(visible,{say:()=>assert.fail('nothing to say')}).state,'shared','the start leaves it too');
});

test('the line for NOTEBOOK.md goes into the repository\'s own exclude file, never into the tracked .gitignore',()=>{
  const crlf=ownersFolder('crlf','# mine\r\n/FULL-ALPHA.md\r\nbuild/\r\n');
  assert.equal(carryIgnoreLine(crlf),path.join(crlf,'.git','info','exclude'));
  assert.equal(read(crlf,'.gitignore'),'# mine\r\n/FULL-ALPHA.md\r\nbuild/\r\n');
  assert.ok(ignored(crlf,'NOTEBOOK.md'));
  assert.equal(carryIgnoreLine(crlf),null,'once: NOTEBOOK.md is ignored now');
  // An old rule in the exclude file itself, or in a global excludes file outside the folder.
  const own=ownersFolder('exclude','build/\n');fs.appendFileSync(path.join(own,'.git','info','exclude'),'FULL-*\n');
  assert.equal(carryIgnoreLine(own),path.join(own,'.git','info','exclude'));
  assert.match(exclude(own),/\nFULL-\*\n\/NOTEBOOK\.md\n$/);assert.equal(read(own,'.gitignore'),'build/\n');
  const global=ownersFolder('global','build/\n'),outside=path.join(temp('excludes'),'ignore');fs.writeFileSync(outside,'FULL-ALPHA.md\n');
  assert.equal(git(global,'config','core.excludesFile',outside).status,0);
  assert.equal(carryIgnoreLine(global),path.join(global,'.git','info','exclude'));
  assert.ok(ignored(global,'NOTEBOOK.md'));assert.equal(fs.readFileSync(outside,'utf8'),'FULL-ALPHA.md\n','the file outside is left alone');
  // No repository, or one that ignores neither: nothing to carry.
  assert.equal(carryIgnoreLine(temp('plain')),null);
  assert.equal(carryIgnoreLine(ownersFolder('neither','build/\n')),null);
});

// A local bare repository stands in for GitHub, as in installer-join-sync.test.mjs.
const address='https://github.com/synthetic/copy.git';
function world(t){
  const base=temp('sync'),remote=path.join(base,'github','copy.git');fs.mkdirSync(remote,{recursive:true});
  const saved=Object.fromEntries(['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0'].map(k=>[k,process.env[k]]));
  Object.assign(process.env,{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'url.'+pathToFileURL(path.join(base,'github')).href+'/.insteadOf',GIT_CONFIG_VALUE_0:'https://github.com/synthetic/'});
  const original=FileSync.prototype.verifyRemote;FileSync.prototype.verifyRemote=async()=>{};
  t.after(()=>{FileSync.prototype.verifyRemote=original;for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  const run=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  run(remote,'init','-q','--bare','--initial-branch=main');
  return {base,remote,run};
}

test('two clones of an owner\'s repository that ignores only FULL-ALPHA.md are renamed, join in folder mode, and still pull',async t=>{
  const w=world(t),seed=path.join(w.base,'seed'),ignore='/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n';
  for(const [file,text] of [['.gitignore',ignore],['.gitattributes','* text=auto eol=lf\nnotebook/** -text\n'],['AGENTS.md','Owner manual\n'],['tools/run.sh','echo owner\n']])atomic(path.join(seed,file),text);
  const owner=['-c','user.name=Owner','-c','user.email=owner@localhost'];
  w.run(seed,'init','-q','-b','main');w.run(seed,'add','-A');w.run(seed,...owner,'commit','-qm','Owner');w.run(seed,'push','-q',address,'main');
  // The installer's order on a new computer: clone, init, then join (scripts/install-native-notebook.sh).
  const clones=[];
  for(const name of ['computer','second']){
    const dir=path.join(w.base,name);w.run(w.base,'clone','-q',address,dir);fs.writeFileSync(path.join(dir,'FULL-ALPHA.md'),notebookNoteText);
    init(dir);
    assert.equal(read(dir,'NOTEBOOK.md'),notebookNoteText);assert.equal(has(dir,'FULL-ALPHA.md'),false);
    assert.equal(read(dir,'.gitignore'),ignore,'the owner\'s ignore file is untouched');
    const joined=await joinRepository(new Store(dir));
    assert.equal(joined.repository,'folder');assert.deepEqual(joined.paths,['notebook']);
    assert.ok(!w.run(dir,'status','--porcelain','--untracked-files=all').split('\n').some(line=>/NOTEBOOK\.md|\.gitignore/.test(line)),'Git sees nothing of the note and no change to a tracked file');
    clones.push(dir);
  }
  // The owner's own pull still works on both, with nothing the notebook wrote in its way.
  atomic(path.join(seed,'rules','new-rule.md'),'From another computer.\n');w.run(seed,'add','-A');w.run(seed,...owner,'commit','-qm','A rule');w.run(seed,'push','-q',address,'main');
  for(const dir of clones){w.run(dir,...owner,'pull','-q','--no-rebase');assert.equal(read(dir,'rules/new-rule.md'),'From another computer.\n');}
});

test('folder mode asks the ignore file to hide the note under the name the folder has',async t=>{
  // A new install has NOTEBOOK.md; a folder whose note leaves this computer keeps FULL-ALPHA.md.
  const w=world(t),base='/.godspeed/\n/conflicts/\n/assistant-state/\n';
  const folder=(name,ignore,note)=>{
    const dir=path.join(w.base,name);
    for(const [file,text] of [['.gitignore',ignore],['.gitattributes','* text=auto eol=lf\nnotebook/** -text\n'],['AGENTS.md','Owner manual\n'],['tools/run.sh','echo owner\n']])atomic(path.join(dir,file),text);
    w.run(dir,'init','-q','-b','main');w.run(dir,'add','-A');w.run(dir,'-c','user.name=Owner','-c','user.email=owner@localhost','commit','-qm','Owner');w.run(dir,'remote','add','origin',address);
    atomic(path.join(dir,note),notebookNoteText);return new Store(dir);
  };
  await assert.rejects(useFolderRepository(folder('new',base,'NOTEBOOK.md')),/first: NOTEBOOK\.md$/);
  assert.equal((await useFolderRepository(folder('new-ignored',base+'/NOTEBOOK.md\n','NOTEBOOK.md'))).repository,'folder');
  assert.equal((await useFolderRepository(folder('new-old-line',base+'/FULL-ALPHA.md\n','NOTEBOOK.md'))).repository,'folder','an old line counts: init puts the new one into the exclude file');
  await assert.rejects(useFolderRepository(folder('old',base+'/NOTEBOOK.md\n','FULL-ALPHA.md')),/first: FULL-ALPHA\.md$/);
  assert.equal((await useFolderRepository(folder('old-ignored',base+'/FULL-ALPHA.md\n','FULL-ALPHA.md'))).repository,'folder');
});

test('a copy made in Settings keeps FULL-ALPHA.md on every computer, carries no NOTEBOOK.md, and its rounds settle',async t=>{
  // What the copy lets through is the list 2.0.0-beta.10 has, so a computer of it still on beta.10
  // sees nothing change (run against that version's sync, a changed list made both computers push
  // their own ignore file every minute and lose their note).
  assert.deepEqual(syncedFiles,['AGENTS.md','CLAUDE.md','README.md','procedures.md','decisions.md','MEMORY.md','FULL-ALPHA.md']);
  const w=world(t),server=path.join(w.base,'server');
  for(const [file,text] of [['FULL-ALPHA.md',recordsText],['AGENTS.md','# My mission control\n'],['rules/server-rule.md','A rule written on the server.\n']])atomic(path.join(server,file),text);
  const serverStore=new Store(server,{device:'vps'}),serverSync=new FileSync(serverStore);
  await serverSync.verifyRemote(address);serverSync.initialize(address);atomic(path.join(serverStore.state,'sync-config.json'),JSON.stringify({enabled:true}));
  assert.equal(serverSync.reconcile().state,'synced');
  assert.doesNotMatch(read(server,'.gitignore'),/NOTEBOOK/);
  // A computer joins: clone, init, join. It keeps the note it joined and writes none beside it.
  const computer=path.join(w.base,'computer');w.run(w.base,'clone','-q',address,computer);
  init(computer);
  assert.equal(has(computer,'FULL-ALPHA.md'),true);assert.equal(has(computer,'NOTEBOOK.md'),false);
  const computerStore=new Store(computer,{device:'laptop-1234abcd'});await joinRepository(computerStore);const computerSync=new FileSync(computerStore);
  // The server's notebook starts after its update.
  assert.equal(settleNotebookNote(server,{write:true,say:()=>assert.fail('nothing to say')}).state,'shared');
  const round=()=>{assert.equal(computerSync.reconcile().state,'synced');assert.equal(serverSync.reconcile().state,'synced');};
  for(let i=0;i<3;i++)round();
  const commits=()=>Number(w.run(w.remote,'rev-list','--count','main')),settled=commits();
  for(let i=0;i<3;i++)round();
  assert.equal(commits(),settled,'no commit once nothing changed');
  for(const dir of [server,computer]){assert.equal(read(dir,'FULL-ALPHA.md'),notebookNoteText);assert.equal(has(dir,'NOTEBOOK.md'),false);}
  assert.ok(!w.run(w.remote,'ls-tree','-r','--name-only','main').split('\n').includes('NOTEBOOK.md'));
  assert.deepEqual(serverSync.pendingConflicts(),[]);assert.deepEqual(computerSync.pendingConflicts(),[]);
});

test('a copy made in Settings beside an owner\'s repository (.godspeed/sync.git) keeps FULL-ALPHA.md',async t=>{
  // The owner's own repository has no copy elsewhere and does not track the note, so only the copy
  // made in Settings carries it to the other computers. (Its ignore file cannot name the note:
  // Git applies the folder's .gitignore to the copy beside it too, and that copy then cannot sync.)
  const w=world(t),dir=path.join(w.base,'owner');
  for(const [file,text] of [['.gitignore','/.godspeed/\n'],['AGENTS.md','Owner manual\n'],['tools/run.sh','echo owner\n']])atomic(path.join(dir,file),text);
  w.run(dir,'init','-q','-b','main');w.run(dir,'add','-A');w.run(dir,'-c','user.name=Owner','-c','user.email=owner@localhost','commit','-qm','Owner');
  atomic(path.join(dir,'FULL-ALPHA.md'),notebookNoteText);
  const store=new Store(dir),sync=new FileSync(store);await sync.verifyRemote(address);sync.initialize(address);atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true}));
  assert.ok(fs.existsSync(path.join(store.state,'sync.git')),'precondition: the copy lives beside the owner\'s repository');
  const first=sync.reconcile();assert.equal(first.state,'synced',JSON.stringify(first));
  assert.ok(w.run(w.remote,'ls-tree','-r','--name-only','main').split('\n').includes('FULL-ALPHA.md'));
  init(dir);
  assert.equal(has(dir,'FULL-ALPHA.md'),true);assert.equal(has(dir,'NOTEBOOK.md'),false);
  assert.equal(sync.reconcile().state,'synced');
  assert.ok(w.run(w.remote,'ls-tree','-r','--name-only','main').split('\n').includes('FULL-ALPHA.md'),'the copy still carries it');
});
