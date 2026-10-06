import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, atomic, hash } from '../core/records/store.mjs';
import { FileSync, useFolderRepository } from '../core/sync/git.mjs';
import { MediaSync } from '../core/sync/media.mjs';
import { SyncRunner } from '../core/sync/runner.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const tryGit=(cwd,...args)=>{try{return git(cwd,...args);}catch(error){return 'failed: '+String(error.stderr||error.message);}};
const read=(...parts)=>fs.readFileSync(path.join(...parts),'utf8');
const exists=(...parts)=>fs.existsSync(path.join(...parts));
const edit=(store,type,id,patch)=>{const r=store.get(type,id);return store.save(type,{...r,...patch},r._hash);};
const pages=root=>{const out=[],walk=(dir,rel)=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())walk(path.join(dir,e.name),r);else out.push(r);}};walk(path.join(root,'notebook'),'');return out.filter(f=>!f.startsWith('_system/')).sort();};
const reviews=m=>m.sync.pendingConflicts().map(n=>JSON.parse(read(m.dir,'conflicts',n)));
const identity=(dir,name='Owner')=>{git(dir,'config','user.name',name);git(dir,'config','user.email',name.toLowerCase()+'@localhost');};
const tmp=name=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-'+name+'-'));

// The review of 6 October 2026 found these with two machines and one private
// repository. Each test is one of its findings, in the way it happened.
const ownerIgnore='/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n';
function folder({ignore=ownerIgnore,attributes='* text=auto eol=lf\nnotebook/** -text\n'}={}){
  const root=tmp('review-folder'),origin=path.join(root,'origin.git');
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');
  const seed=path.join(root,'seed');git(root,'clone',origin,seed);identity(seed);
  for(const [file,text] of [['.gitignore',ignore],['AGENTS.md','Owner manual\n'],['rules/own.md','Owner rule\n'],...(attributes===null?[]:[['.gitattributes',attributes]])])atomic(path.join(seed,file),text);
  git(seed,'add','-A');git(seed,'commit','-m','Owner mission control');git(seed,'push','origin','main');
  const clone=(name,config=[])=>{const dir=path.join(root,name);git(root,'clone',...config.flatMap(c=>['-c',c]),origin,dir);identity(dir);return dir;};
  const machine=(name,paths=['notebook'],config)=>{const dir=clone(name,config),store=new Store(dir,{device:name});atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true,repository:'folder',paths}));return {dir,store,sync:new FileSync(store)};};
  return {root,origin,clone,machine};
}
function knowledge(){
  const root=tmp('review-knowledge'),origin=path.join(root,'origin.git');
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone','-c','core.autocrlf=false',origin,dir);identity(dir);const store=new Store(dir,{device:name}),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');return {dir,store,sync};};
  return {root,origin,machine};
}
const synced=(...list)=>{for(const m of list)assert.equal(m.sync.reconcile().state,'synced',JSON.stringify(m.sync.last));};

// 1. Folder mode took a merged commit without checking it: a page deleted on
// one machine and a link to it added on the other gave both machines a
// broken notebook, and every save on either failed from then on.
test('folder: a merge that would leave a reference broken is not taken, nothing is pushed and the removed record is kept for review',()=>{
  const {machine}=folder(),envy=machine('envy'),server=machine('server');
  const person=envy.store.save('contacts',{name:'Pat Example'}),note=envy.store.save('notes',{title:'Meeting',content:'x\n'});
  synced(envy,server);
  fs.unlinkSync(envy.store.file(envy.store.get('contacts',person.id)));synced(envy);
  edit(server.store,'notes',note.id,{references:[{type:'contacts',id:person.id,uid:person.uid}]});
  const before=git(server.dir,'rev-parse','HEAD'),result=server.sync.reconcile();
  assert.notEqual(result.state,'synced');
  server.store.scan(true);assert.deepEqual(server.store.problems,[],'The notebook here is not broken');
  assert.equal(git(server.dir,'rev-parse','HEAD'),before,'The branch did not move');
  assert.equal(git(server.dir,'rev-parse','origin/main'),git(envy.dir,'rev-parse','HEAD'),'Nothing was pushed');
  const [review]=reviews(server);assert.equal(review.path,'notebook/People/Pat Example.md');assert.equal(review.remote,null);assert.match(review.local,/Pat Example/);
  server.store.save('notes',{title:'Unrelated',content:'y\n'});
  // Keeping the person here brings it back on the other machine too.
  server.sync.resolve(review.id,'local');
  synced(server,envy);
  for(const m of [server,envy]){m.store.scan(true);assert.deepEqual(m.store.problems,[]);assert.equal(m.store.get('contacts',person.id).name,'Pat Example');}
});

// 2. The folder guard divided by every file under notebook/, history
// snapshots included, and an outgoing mass deletion was never guarded: all
// 40 notes went on the other machine.
test('folder: deleting every note at once is stopped on the way out and on the way in',()=>{
  const {clone,machine}=folder(),envy=machine('envy'),server=machine('server');
  const notes=Array.from({length:40},(_,i)=>envy.store.save('notes',{title:'Note '+i,content:'Text '+i+'\n'}));
  for(const n of notes)for(let k=0;k<4;k++)edit(envy.store,'notes',n.id,{content:'Text v'+k+'\n'});
  synced(envy,server);assert.equal(server.store.list('notes').length,40);
  for(const n of notes)fs.unlinkSync(envy.store.file(envy.store.get('notes',n.id)));
  const out=envy.sync.reconcile();assert.notEqual(out.state,'synced');assert.match(out.detail,/Removal of 40/);
  assert.equal(git(envy.dir,'ls-tree','-r','--name-only','origin/main','--','notebook').split('\n').filter(f=>/^notebook\/Note \d+\.md$/.test(f)).length,40,'Nothing was uploaded');
  // The same deletion committed by the owner's own Git elsewhere.
  const laptop=clone('laptop');git(laptop,'rm','-q','notebook/Note *.md');git(laptop,'commit','-qm','Bulk delete');git(laptop,'push','-q','origin','main');
  const incoming=server.sync.reconcile();assert.notEqual(incoming.state,'synced');assert.match(incoming.detail,/Removal of 40/);
  assert.equal(server.store.list('notes').length,40);
});

// 3. Every save rewrites `modified:`, so two machines editing different
// fields of one note never merged by lines: one edit was dropped (folder) or
// the sync stayed in conflict (knowledge).
for(const mode of ['folder','knowledge']){
  const pair=()=>{if(mode==='folder'){const {machine}=folder();return [machine('laptop'),machine('server')];}const {machine}=knowledge(),a=machine('laptop');synced(a);return [a,machine('server')];};
  test(mode+': different fields of one note edited on two machines both survive, with no review',()=>{
    const [a,b]=pair(),n=a.store.save('notes',{title:'Shopping',content:'milk\n',tags:[]});
    synced(a,b);
    edit(a.store,'notes',n.id,{tags:['home']});edit(b.store,'notes',n.id,{content:'milk\nbread\n'});
    synced(a,b,a);
    for(const m of [a,b]){const r=m.store.get('notes',n.id);assert.deepEqual(r.tags,['home'],m.dir);assert.equal(r.content,'milk\nbread\n');assert.deepEqual(m.sync.pendingConflicts(),[]);}
  });
  test(mode+': a title changed only in letter case on one machine and an edit on the other end as one renamed note',()=>{
    const [a,b]=pair(),n=a.store.save('notes',{title:'Original',content:'base\n'});
    synced(a,b);
    edit(a.store,'notes',n.id,{title:'ORIGINAL'});edit(b.store,'notes',n.id,{content:'edited on B\n'});
    synced(a,b,a);
    for(const m of [a,b]){
      const r=m.store.get('notes',n.id);assert.equal(r.title,'ORIGINAL',m.dir);assert.equal(r.content,'edited on B\n');
      assert.deepEqual(pages(m.dir),['ORIGINAL.md']);assert.deepEqual(m.sync.pendingConflicts(),[]);
    }
    assert.ok(git(a.dir,'ls-tree','-r','--name-only','origin/main','--','notebook').split('\n').includes('notebook/ORIGINAL.md'),'The repository has the new spelling');
  });
}

// 4. Knowledge mode: a page deleted by hand was pushed as a plain removal,
// and every other machine refused it for good, with no review item.
test('knowledge: a page deleted by hand leaves as a tombstone and the other machines keep syncing',()=>{
  const {machine}=knowledge(),a=machine('desktop'),doomed=a.store.save('notes',{title:'Old page',content:'bye\n'});
  synced(a);const b=machine('laptop');synced(b);
  fs.unlinkSync(a.store.file(a.store.get('notes',doomed.id)));synced(a);
  assert.ok(a.store.list('notes',{removed:true}).find(n=>n.id===doomed.id)?.removed_at,'The removal is a tombstone');
  b.store.save('notes',{title:'Written on the laptop',content:'important\n'});
  synced(b,a);
  assert.ok(b.store.list('notes',{removed:true}).find(n=>n.id===doomed.id).removed_at);assert.deepEqual(pages(b.dir),['Written on the laptop.md']);
  assert.ok(a.store.list('notes').some(n=>n.title==='Written on the laptop'));
});
test('knowledge: a removal without a tombstone from an older machine becomes a review item, and choosing it removes the record',()=>{
  const {machine}=knowledge(),a=machine('desktop'),doomed=a.store.save('notes',{title:'Old page',content:'bye\n'});
  synced(a);const b=machine('laptop');synced(b);
  git(a.dir,'rm','-q','notebook/Old page.md');git(a.dir,'commit','-qm','Removed by an older version');git(a.dir,'push','-q','origin','main');
  const first=b.sync.reconcile();assert.equal(first.state,'conflict',JSON.stringify(first));
  const [review]=reviews(b);assert.equal(review.path,'notebook/Old page.md');assert.equal(review.remote,null);assert.match(review.local,/bye/);
  b.sync.resolve(review.id,'remote');
  synced(b,a,b);
  for(const m of [a,b])assert.ok(m.store.list('notes',{removed:true}).find(n=>n.id===doomed.id).removed_at,m.dir);
  assert.deepEqual(b.sync.pendingConflicts(),[]);
});

// 5. A second device set up from Settings (a plain folder, git init) could
// never join an existing repository: no history in common.
test('knowledge: a second device set up on a plain folder joins the existing notebook and keeps what it wrote',()=>{
  const {root,origin,machine}=knowledge(),a=machine('desktop');a.store.save('notes',{title:'From the desktop',content:'A\n'});synced(a);
  const dir=path.join(root,'laptop');fs.mkdirSync(dir);
  const store=new Store(dir,{device:'laptop'}),sync=new FileSync(store);
  store.save('notes',{title:'Written on the laptop before joining',content:'B\n'});atomic(path.join(dir,'AGENTS.md'),'Starter manual\n');
  atomic(path.join(a.dir,'AGENTS.md'),'The real manual\n');synced(a);
  sync.initialize('https://github.com/synthetic/private.git');identity(dir);git(dir,'remote','set-url','origin',origin);
  const b={dir,store,sync};synced(b,a);
  for(const m of [a,b])assert.deepEqual(m.store.list('notes').map(n=>n.title).sort(),['From the desktop','Written on the laptop before joining'],m.dir);
  assert.equal(read(dir,'AGENTS.md'),'The real manual\n','The joining device takes the notebook it joins, not its starter copy');
  assert.equal(read(a.dir,'AGENTS.md'),'The real manual\n');
});

// 6. A merge commit left unpushed on the owner's branch: the owner's
// scheduled `git pull --rebase` then stopped with conflict markers in a note.
test('folder: when the push is refused the owner branch does not move, and a plain pull --rebase meets no conflict',()=>{
  const {machine}=folder(),envy=machine('envy'),server=machine('server',['*']);
  const note=envy.store.save('notes',{title:'Contested',content:'Line one\n'});
  synced(envy,server);
  edit(server.store,'notes',note.id,{content:'Server version\n'});synced(server);
  edit(envy.store,'notes',note.id,{content:'Envy version\n'});
  const hook=path.join(envy.dir,'.git','hooks','pre-push');fs.writeFileSync(hook,'#!/bin/sh\necho "owner check failed" >&2\nexit 1\n',{mode:0o755});
  const head=git(envy.dir,'rev-parse','HEAD'),refused=envy.sync.reconcile();
  assert.equal(refused.state,'pending');assert.equal(git(envy.dir,'rev-parse','HEAD'),head,'No merge and no notebook commit on the owner branch');
  tryGit(envy.dir,'pull','--rebase','origin','main');
  assert.equal(exists(envy.dir,'.git','rebase-merge')||exists(envy.dir,'.git','rebase-apply'),false,'The pull did not stop in the middle of a rebase');
  assert.doesNotMatch(read(envy.dir,'notebook','Contested.md'),/<<<<<<<|>>>>>>>/);
  fs.unlinkSync(hook);
  synced(envy,server);
  assert.equal(git(envy.dir,'rev-parse','HEAD'),git(envy.dir,'rev-parse','origin/main'),'After the push the branch stands on the pushed commit');
  assert.match(read(server.dir,'notebook','Contested.md'),/Envy version/);assert.equal(reviews(envy).length,1);
});

// 7. Knowledge mode overwrote a document written during the merge by a
// program that does not take the workspace lock.
test('knowledge: a document written while the merge runs is kept, with the other version for review',()=>{
  const {machine}=knowledge(),a=machine('desktop');atomic(path.join(a.dir,'journal','today.md'),'09:00 started\n');synced(a);
  const b=machine('laptop');synced(b);
  atomic(path.join(b.dir,'journal','today.md'),'09:00 started\n10:00 laptop entry\n');synced(b);
  const original=a.sync.git.bind(a.sync);
  a.sync.git=(args,cwd,options)=>{const out=original(args,cwd,options);if(args[0]==='merge'&&cwd&&cwd.includes('sync-worktrees'))atomic(path.join(a.dir,'journal','today.md'),'09:00 started\n11:00 desktop entry written during the merge\n');return out;};
  a.sync.reconcile();a.sync.git=original;
  assert.equal(read(a.dir,'journal','today.md'),'09:00 started\n11:00 desktop entry written during the merge\n');
  const [review]=reviews(a);assert.equal(review.path,'journal/today.md');assert.match(review.remote,/laptop entry/);assert.match(review.local,/desktop entry/);
});

// 8. Folder mode listed what to commit with `git status`, which hides what
// the owner's ignore rules match, and still said "synced".
test('folder: notebook pages that the owner ignore rules happen to match still travel, and setup refuses rules that hide every page',async()=>{
  const {machine}=folder({ignore:ownerIgnore+'id_rsa*\n__pycache__/\n'}),envy=machine('envy'),server=machine('server');
  envy.store.save('notes',{title:'id_rsa rotation checklist',content:'rotate keys\n'});envy.store.save('notes',{title:'Notes',folder_path:'__pycache__',content:'a folder name\n'});
  synced(envy,server);
  assert.deepEqual(server.store.list('notes').map(n=>n.title).sort(),['Notes','id_rsa rotation checklist']);
  const {clone}=folder({ignore:ownerIgnore+'*.md\n'}),dir=clone('owner'),store=new Store(dir);
  const original=FileSync.prototype.verifyRemote;FileSync.prototype.verifyRemote=async()=>{};
  try{await assert.rejects(useFolderRepository(store,[]),/hides notebook pages/);}finally{FileSync.prototype.verifyRemote=original;}
  assert.equal(exists(store.state,'sync-config.json'),false);
});

// 9. Folder mode inherited Git for Windows' core.autocrlf=true: a note's
// line endings changed on the way to another machine.
test('folder: notebook pages arrive byte for byte, and Git settings that would change their line endings are refused',async()=>{
  const {machine}=folder({attributes:'* text=auto eol=lf\n'}),envy=machine('envy'),laptop=machine('laptop');
  const note=envy.store.save('notes',{title:'Pasted',content:'From Windows\r\nclipboard\r\n'});
  synced(envy,laptop);
  assert.equal(laptop.store.get('notes',note.id).content,'From Windows\r\nclipboard\r\n');
  assert.deepEqual(fs.readFileSync(laptop.store.file(note)),fs.readFileSync(envy.store.file(note)));
  assert.equal(git(envy.dir,'status','--porcelain'),'');
  const plain=folder({attributes:null}),owner=plain.clone('owner',['core.autocrlf=true']),store=new Store(owner);
  const original=FileSync.prototype.verifyRemote;FileSync.prototype.verifyRemote=async()=>{};
  try{await assert.rejects(useFolderRepository(store,[]),/line endings/);}finally{FileSync.prototype.verifyRemote=original;}
  const m=plain.machine('desktop',['notebook'],['core.autocrlf=true']);m.store.save('notes',{title:'Kept here',content:'x\n'});
  const result=m.sync.reconcile();assert.equal(result.state,'pending');assert.match(result.detail,/line endings/);
  assert.equal(git(m.dir,'ls-tree','-r','--name-only','origin/main','--','notebook'),'','Nothing was committed or pushed');
});

// 10. Stale lock files kept sync waiting for good.
test('folder: Git locks left by a killed process are cleared, a lock a running Git may hold is not',()=>{
  const {machine}=folder(),envy=machine('envy'),server=machine('server');
  synced(envy,server);envy.store.save('notes',{title:'From envy',content:'a\n'});synced(envy);
  server.store.save('notes',{title:'From the server',content:'b\n'});
  fs.writeFileSync(path.join(server.store.state,'sync-merge-index.lock'),'');
  synced(server);assert.ok(server.store.list('notes').some(n=>n.title==='From envy'));
  const lock=path.join(server.dir,'.git','index.lock'),old=new Date(Date.now()-86400e3);
  fs.writeFileSync(lock,'');fs.utimesSync(lock,old,old);envy.store.save('notes',{title:'Later',content:'c\n'});synced(envy);
  server.sync.gitRunning=()=>true;
  assert.match(server.sync.reconcile().detail,/busy/,'Another Git is running: its lock stays');assert.ok(fs.existsSync(lock));
  server.sync.gitRunning=()=>false;
  synced(server);assert.equal(fs.existsSync(lock),false);assert.ok(server.store.list('notes').some(n=>n.title==='Later'));
  fs.writeFileSync(lock,'');server.sync.gitRunning=()=>false;
  assert.match(server.sync.reconcile().detail,/busy/,'A fresh lock is a Git at work');fs.unlinkSync(lock);
});
test('stopping the sync runner lets a running worker finish instead of killing it in the middle of Git',async()=>{
  const root=tmp('runner-stop'),worker=path.join(root,'worker.mjs'),done=path.join(root,'done.txt');
  fs.writeFileSync(worker,"import fs from 'node:fs';setTimeout(()=>{fs.writeFileSync("+JSON.stringify(done)+",'x');console.log(JSON.stringify({state:'synced'}));},1200)");
  const runner=new SyncRunner(root,{worker}),running=runner.run();
  await new Promise(resolve=>setTimeout(resolve,200));
  await runner.close();
  assert.ok(fs.existsSync(done),'The worker finished its round');assert.equal((await running).state,'synced');
});

// 11. The media sync saved its review again every minute: a dismissed
// review came back as pending, with a new history file each time.
test('media: a review of a removed media file is created once and a decision on it stays',async()=>{
  const root=tmp('media-review'),store=new Store(root),media=path.join(store.state,'media');fs.mkdirSync(media,{recursive:true});
  const bytes=Buffer.from('local photo bytes'),sha=hash(bytes),file=sha+'-photo.jpg';fs.writeFileSync(path.join(media,file),bytes);
  atomic(path.join(media,hash('photos/photo.jpg')+'.mapping.json'),JSON.stringify({path:'photos/photo.jpg',file,sha256:sha,size:bytes.length}));
  const remote={path:'photos/photo.jpg',file:'f'.repeat(64)+'-photo.jpg',sha256:'f'.repeat(64),size:3,removed_at:'2026-10-06T10:00:00.000Z'};
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/api/media/manifest'?{data:[remote]}:{}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    atomic(path.join(store.state,'pair.json'),JSON.stringify({origin:'http://127.0.0.1:'+server.address().port,key:'k',offline:'all'}));
    const sync=new MediaSync(store,media),id='media-delete-conflict-'+hash([remote.path,sha,remote.sha256]).slice(0,24);
    await sync.reconcile();const first=store.get('review_queue',id);assert.equal(first.status,'pending_review');
    store.save('review_queue',{...first,status:'dismissed'},first._hash);const decided=store.get('review_queue',id);
    for(let i=0;i<3;i++)await sync.reconcile();
    const now=store.get('review_queue',id);assert.equal(now.status,'dismissed');assert.equal(now.revision,decided.revision);
    assert.equal(store.list('record_history').filter(h=>h.source_id===id).length,1);
  }finally{server.close();}
});

// 12. Knowledge mode committed with whatever identity Git found; a clone on
// a machine without one could never commit.
test('knowledge: a clone on a machine with no Git identity still commits and syncs',()=>{
  const saved={...process.env},empty=path.join(tmp('no-identity'),'gitconfig');fs.writeFileSync(empty,'');
  try{
    Object.assign(process.env,{GIT_CONFIG_GLOBAL:empty,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'user.useConfigOnly',GIT_CONFIG_VALUE_0:'true'});
    for(const k of ['GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL','EMAIL'])delete process.env[k];
    const root=tmp('no-identity-sync'),origin=path.join(root,'origin.git');fs.mkdirSync(origin);git(origin,'init','-q','--bare','--initial-branch=main');
    const dir=path.join(root,'server');git(root,'clone','-q','-c','core.autocrlf=false',origin,dir);
    const store=new Store(dir),sync=new FileSync(store);sync.initialize('https://github.com/synthetic/private.git');
    store.save('notes',{title:'First',content:'x\n'});
    assert.equal(sync.reconcile().state,'synced',JSON.stringify(sync.last));
    assert.equal(git(dir,'log','-1','--format=%an'),'Godspeed Mission Control');
  }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});

// 13. Connecting a repository in Settings replaced folder mode with
// {"enabled":true} and could rewrite the owner's ignore file.
test('folder: connecting a separate repository from Settings is refused while the notebook syncs through the folder repository',()=>{
  const {machine}=folder(),envy=machine('envy'),config=read(envy.store.state,'sync-config.json'),ignore=read(envy.dir,'.gitignore');
  const worker=fileURLToPath(new URL('../scripts/sync-worker.mjs',import.meta.url));
  const out=JSON.parse(execFileSync(process.execPath,[worker,envy.dir,'configure','https://github.com/synthetic/private.git'],{encoding:'utf8',windowsHide:true}).trim().split('\n').at(-1));
  assert.equal(out.state,'configuration_failed');assert.match(out.configuration_error,/folder/);
  assert.equal(read(envy.store.state,'sync-config.json'),config);assert.equal(read(envy.dir,'.gitignore'),ignore);
  assert.equal(fs.existsSync(path.join(envy.store.state,'sync.git')),false);
});

// 14. The notebook pushed whatever HEAD was after the lock was released, and
// set files aside with glob pathspecs.
test('folder: the push carries exactly the commit checked under the lock',()=>{
  const {machine}=folder(),envy=machine('envy');synced(envy);
  envy.store.save('notes',{title:'Checked',content:'x\n'});
  const original=envy.store.withLock.bind(envy.store);let first=true;
  envy.store.withLock=fn=>{const out=original(fn);if(first){first=false;atomic(path.join(envy.dir,'rules','late.md'),'Committed by a session after the check\n');git(envy.dir,'add','rules/late.md');git(envy.dir,'commit','-qm','Session commit');}return out;};
  envy.sync.reconcile();envy.store.withLock=original;
  assert.equal(tryGit(envy.dir,'cat-file','-e','origin/main:rules/late.md').startsWith('failed'),true,'The session commit made after the check was not pushed by the notebook');
  assert.ok(git(envy.dir,'ls-tree','-r','--name-only','origin/main').split('\n').includes('notebook/Checked.md'));
});
test('folder: setting a blocking file aside restores that file only, never another one its name matches as a pattern',()=>{
  const {machine}=folder(),server=machine('server',['*']);
  atomic(path.join(server.dir,'rules','a1.md'),'Tracked rule\n');synced(server);
  atomic(path.join(server.dir,'rules','a[1].md'),'Written on the server\n');atomic(path.join(server.dir,'rules','a1.md'),'Edited on the server, not yet committed\n');
  server.sync.setAside(['rules/a[1].md']);
  assert.equal(read(server.dir,'rules','a1.md'),'Edited on the server, not yet committed\n','The other file kept its edit');
  assert.equal(exists(server.dir,'rules','a[1].md'),false);
});
