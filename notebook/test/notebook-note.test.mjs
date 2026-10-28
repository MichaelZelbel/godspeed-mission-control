import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Store,atomic} from '../core/records/store.mjs';
import {FileSync,joinRepository} from '../core/sync/git.mjs';
import {settleNotebookNote,carryIgnoreLine,notebookNoteText} from '../core/notebook-note.mjs';

// THE NOTEBOOK'S NOTE IS NOTEBOOK.md (2.0.0-beta.11, ticket 08 of that release). Every mission
// control with the notebook, on every system, had FULL-ALPHA.md at its top: the first file a
// newcomer saw in their folder, under a name the product no longer has. A new install writes
// NOTEBOOK.md, an update renames the old note once, and a folder that kept the old note out of
// its own Git, or committed it, goes on doing the same with the new one.
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

// An owner's repository with an ignore file and some history: their own mission control.
function ownersFolder(name,ignore){
  const root=temp(name);
  assert.equal(git(root,'init','-q','-b','main').status,0);
  fs.writeFileSync(path.join(root,'.gitignore'),ignore);fs.writeFileSync(path.join(root,'AGENTS.md'),'Owner manual\n');
  assert.equal(git(root,'add','-A').status,0);assert.equal(git(root,'commit','-qm','Owner').status,0);
  return root;
}
const ignored=(root,name)=>git(root,'check-ignore','-q','--',name).status===0;
const status=root=>git(root,'status','--porcelain','--untracked-files=all','--','.gitignore','NOTEBOOK.md','FULL-ALPHA.md').stdout.split('\n').filter(Boolean).sort();

test('a folder whose ignore file lists /FULL-ALPHA.md keeps NOTEBOOK.md out of its commits too',()=>{
  const ignore='/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n',root=ownersFolder('ignores',ignore);
  fs.writeFileSync(path.join(root,'FULL-ALPHA.md'),notebookNoteText);
  init(root);
  assert.equal(read(root,'NOTEBOOK.md'),notebookNoteText);assert.equal(has(root,'FULL-ALPHA.md'),false);
  assert.equal(read(root,'.gitignore'),'/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/NOTEBOOK.md\n/assistant-state/\n','the same line for the new name, beside the old one, and no line of the owner\'s changed');
  assert.ok(ignored(root,'NOTEBOOK.md'),'NOTEBOOK.md is ignored as FULL-ALPHA.md was');
  assert.deepEqual(status(root),[' M .gitignore'],'nothing of the note shows to the owner\'s Git');
  assert.equal(git(root,'add','-A').status,0);
  assert.ok(!git(root,'diff','--cached','--name-only').stdout.includes('NOTEBOOK.md'),'the owner\'s next commit does not take it');
});

test('a folder whose own Git commits its note goes on committing it under the new name, whatever its ignore file says',()=>{
  // Committed (the first commit of a new installation holds it), and an ignore line added later,
  // which Git does not apply to a file it already tracks.
  const root=ownersFolder('commits','/.godspeed/\n');
  fs.writeFileSync(path.join(root,'FULL-ALPHA.md'),notebookNoteText);
  assert.equal(git(root,'add','FULL-ALPHA.md').status,0);assert.equal(git(root,'commit','-qm','The note').status,0);
  fs.appendFileSync(path.join(root,'.gitignore'),'/FULL-ALPHA.md\n');assert.equal(git(root,'commit','-qam','Ignore the note').status,0);
  const ignoreBefore=read(root,'.gitignore');
  init(root);
  assert.equal(read(root,'.gitignore'),ignoreBefore,'no line added: the old note was committed, not ignored');
  assert.equal(ignored(root,'NOTEBOOK.md'),false);
  assert.deepEqual(status(root),[' D FULL-ALPHA.md','?? NOTEBOOK.md']);
  assert.equal(git(root,'add','-A').status,0);assert.equal(git(root,'commit','-qm','Update').status,0);
  const tracked=git(root,'ls-files').stdout.split('\n');
  assert.ok(tracked.includes('NOTEBOOK.md')&&!tracked.includes('FULL-ALPHA.md'),'the owner\'s next commit takes the note under its new name');
});

test('the ignore line goes in beside the old one with its line ending, into the file that held the old one',()=>{
  const crlf=ownersFolder('crlf','# mine\r\n/FULL-ALPHA.md\r\nbuild/\r\n');
  assert.equal(carryIgnoreLine(crlf),path.join(crlf,'.gitignore'));
  assert.equal(read(crlf,'.gitignore'),'# mine\r\n/FULL-ALPHA.md\r\n/NOTEBOOK.md\r\nbuild/\r\n');
  assert.equal(carryIgnoreLine(crlf),null,'once: NOTEBOOK.md is ignored now');
  const exclude=ownersFolder('exclude','build/\n'),excludeFile=path.join(exclude,'.git','info','exclude');
  fs.appendFileSync(excludeFile,'FULL-*\n');
  assert.equal(carryIgnoreLine(exclude),excludeFile);
  assert.match(read(exclude,'.git/info/exclude'),/\nFULL-\*\n\/NOTEBOOK\.md\n$/);
  assert.equal(read(exclude,'.gitignore'),'build/\n');
  // A rule from outside the folder (a global excludes file) is matched in the repository's own exclude file.
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

test('an owner\'s repository that ignores only FULL-ALPHA.md still joins in folder mode after an install, and NOTEBOOK.md stays out of it',async t=>{
  const w=world(t),seed=path.join(w.base,'seed'),ignore='/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n';
  for(const [file,text] of [['.gitignore',ignore],['.gitattributes','* text=auto eol=lf\nnotebook/** -text\n'],['AGENTS.md','Owner manual\n'],['tools/run.sh','echo owner\n']])atomic(path.join(seed,file),text);
  w.run(seed,'init','-q','-b','main');w.run(seed,'add','-A');w.run(seed,'-c','user.name=Owner','-c','user.email=owner@localhost','commit','-qm','Owner');w.run(seed,'push','-q',address,'main');
  // The installer's order on a new computer: clone, init, then join (scripts/install-native-notebook.sh).
  const dir=path.join(w.base,'computer');w.run(w.base,'clone','-q',address,dir);
  init(dir);
  assert.equal(read(dir,'NOTEBOOK.md'),notebookNoteText);
  assert.equal(read(dir,'.gitignore'),'/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/NOTEBOOK.md\n/assistant-state/\n');
  const joined=await joinRepository(new Store(dir));
  assert.equal(joined.repository,'folder');assert.deepEqual(joined.paths,['notebook']);
  assert.ok(ignored(dir,'NOTEBOOK.md'));
  assert.ok(!w.run(dir,'status','--porcelain','--untracked-files=all').split('\n').some(line=>line.endsWith('NOTEBOOK.md')),'the owner\'s Git does not see the note');
});

test('through a copy made in Settings the rename reaches GitHub and the other computers, and the old name leaves the repository',async t=>{
  const w=world(t),server=path.join(w.base,'server');
  for(const [file,text] of [['FULL-ALPHA.md',notebookNoteText],['AGENTS.md','# My mission control\n'],['rules/server-rule.md','A rule written on the server.\n']])atomic(path.join(server,file),text);
  const serverStore=new Store(server,{device:'vps'}),serverSync=new FileSync(serverStore);
  await serverSync.verifyRemote(address);serverSync.initialize(address);atomic(path.join(serverStore.state,'sync-config.json'),JSON.stringify({enabled:true}));
  assert.equal(serverSync.reconcile().state,'synced');
  const remoteFiles=()=>w.run(w.remote,'ls-tree','-r','--name-only','main').split('\n');
  assert.ok(remoteFiles().includes('FULL-ALPHA.md'),'precondition: the copy carries the note under its old name');
  // A computer joined that copy before the update.
  const computer=path.join(w.base,'computer');w.run(w.base,'clone','-q',address,computer);
  const computerStore=new Store(computer,{device:'laptop-1234abcd'});await joinRepository(computerStore);
  const computerSync=new FileSync(computerStore);assert.equal(computerSync.reconcile().state,'synced');
  assert.equal(read(computer,'FULL-ALPHA.md'),notebookNoteText);
  // The server updates: its notebook renames the note, and the next round syncs it.
  assert.equal(settleNotebookNote(server,{write:true}).state,'renamed');
  assert.equal(serverSync.reconcile().state,'synced');
  assert.ok(remoteFiles().includes('NOTEBOOK.md'),'the new name is on GitHub');
  assert.ok(!remoteFiles().includes('FULL-ALPHA.md'),'the old name is not');
  // The computer takes the rename on its next round.
  assert.equal(computerSync.reconcile().state,'synced');
  assert.equal(read(computer,'NOTEBOOK.md'),notebookNoteText);
  assert.equal(has(computer,'FULL-ALPHA.md'),false);
  assert.deepEqual(serverSync.pendingConflicts(),[]);assert.deepEqual(computerSync.pendingConflicts(),[]);
  // A computer that joins after the update gets only the new name.
  const later=path.join(w.base,'later');w.run(w.base,'clone','-q',address,later);
  assert.ok(has(later,'NOTEBOOK.md')&&!has(later,'FULL-ALPHA.md'));
});
