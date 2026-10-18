import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, atomic } from '../core/records/store.mjs';
import { FileSync } from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-sync-test-')),remote=path.join(root,'remote.git');fs.mkdirSync(remote);git(remote,'init','--bare','--initial-branch=main');
  const a=path.join(root,'desktop');git(root,'clone',remote,a);git(a,'config','user.name','Candidate Test');git(a,'config','user.email','test@localhost');
  const store=new Store(a,{device:'desktop'});atomic(path.join(a,'.gitignore'),'*\n!records/\n!records/**\n!.gitignore\n');
  const note=store.save('notes',{title:'Shared',content:'Base'});const sync=new FileSync(store);sync.commitLocal();git(a,'push','origin','main');
  const b=path.join(root,'laptop');git(root,'clone',remote,b);git(b,'config','user.name','Candidate Test');git(b,'config','user.email','test@localhost');
  return {a:store,b:new Store(b,{device:'laptop'}),note,remote};
}
test('offline independent edits and reconnect converge through actual Git',()=>{
  const {a,b}=fixture();a.save('notes',{title:'Desktop note',content:'A'});b.save('contacts',{name:'Laptop person'});
  assert.equal(new FileSync(a).reconcile().state,'synced');assert.equal(new FileSync(b).reconcile().state,'synced');assert.equal(new FileSync(a).reconcile().state,'synced');
  assert.equal(a.list('notes').length,2);assert.equal(b.list('notes').length,2);assert.equal(a.list('contacts').length,1);
});
test('same record conflict preserves base and both sides, never puts conflict markers into notes',()=>{
  const {a,b,note}=fixture();a.save('notes',{id:note.id,content:'Desktop'});b.save('notes',{id:note.id,content:'Laptop'});
  new FileSync(a).reconcile();const sync=new FileSync(b);assert.equal(sync.reconcile().state,'conflict');
  const id=sync.pendingConflicts()[0].replace('.json',''),conflict=JSON.parse(fs.readFileSync(path.join(b.root,'conflicts',id+'.json'),'utf8'));
  assert.match(conflict.base,/Base/);assert.match(conflict.local,/Laptop/);assert.match(conflict.remote,/Desktop/);
  assert.equal(b.get('notes',note.id).content,'Laptop');assert.doesNotMatch(fs.readFileSync(b.file(note),'utf8'),/<<<<<<<|>>>>>>>/);
  sync.resolve(id,'local');assert.equal(sync.reconcile().state,'synced');new FileSync(a).reconcile();assert.equal(a.get('notes',note.id).content,'Laptop');
});
test('network loss leaves offline edits available and secrets and index never enter Git',()=>{
  const {a,remote}=fixture();atomic(path.join(a.root,'private-token.txt'),'synthetic-secret');a.save('notes',{title:'Offline',content:'Still available'});
  git(a.root,'remote','set-url','origin',path.join(remote,'missing'));
  const result=new FileSync(a).reconcile();assert.equal(result.state,'pending');assert.ok(a.list('notes').some(r=>r.title==='Offline'));
  const tracked=git(a.root,'ls-files');assert.doesNotMatch(tracked,/private-token|sqlite|\.godspeed/);
});

test('network waits permit local saves and include edits made during fetch',()=>{
  const {a,b}=fixture(),sync=new FileSync(a),original=sync.git.bind(sync);
  b.save('notes',{title:'Remote before fetch',content:'Remote change'});
  assert.equal(new FileSync(b).reconcile().state,'synced');
  const observed=[];
  sync.git=(args,cwd)=>{
    if(['fetch','push','ls-remote'].includes(args[0])){
      assert.equal(fs.existsSync(path.join(a.state,'workspace.lock')),false,'Network access must not hold the local writer lock');
      observed.push(args[0]);
      if(args[0]==='fetch')a.save('notes',{title:'Saved while fetching',content:'Local change'});
    }
    return original(args,cwd);
  };
  assert.equal(sync.reconcile().state,'synced');
  assert.deepEqual(observed,['fetch','push']);
  assert.ok(a.list('notes').some(r=>r.title==='Remote before fetch'));
  assert.ok(a.list('notes').some(r=>r.title==='Saved while fetching'));
  assert.equal(new FileSync(b).reconcile().state,'synced');
  assert.ok(b.list('notes').some(r=>r.title==='Saved while fetching'));
});

test('a local save during upload remains available and is reported pending until uploaded',()=>{
  const {a,b}=fixture(),sync=new FileSync(a),original=sync.git.bind(sync);
  let edited=false;
  sync.git=(args,cwd)=>{
    if(args[0]==='push'&&!edited){edited=true;a.save('notes',{title:'Saved during upload',content:'Retain and upload next cycle'});}
    return original(args,cwd);
  };
  const first=sync.reconcile();assert.equal(first.state,'pending');assert.equal(first.pending,1);
  assert.ok(a.list('notes').some(r=>r.title==='Saved during upload'));
  assert.equal(sync.reconcile().state,'synced');assert.equal(new FileSync(b).reconcile().state,'synced');
  assert.ok(b.list('notes').some(r=>r.title==='Saved during upload'));
});

test('packaged hidden skill markers never enter synced files',()=>{
  const {a}=fixture(),sync=new FileSync(a);
  sync.initialize('https://github.com/synthetic/private.git');
  fs.mkdirSync(path.join(a.root,'skills','example'),{recursive:true});
  atomic(path.join(a.root,'skills','example','SKILL.md'),'Synthetic skill');
  atomic(path.join(a.root,'skills','example','.shipped-sha256'),'packaging marker');
  sync.commitLocal();const tracked=git(a.root,'ls-files');
  assert.match(tracked,/skills\/example\/SKILL.md/);assert.doesNotMatch(tracked,/shipped-sha256/);
});

test('similar independent assistant profiles keep their paths when syncing',()=>{
  const {a,b}=fixture();const sa=new FileSync(a),sb=new FileSync(b);
  sa.initialize('https://github.com/synthetic/private.git');sb.initialize('https://github.com/synthetic/private.git');
  const first='assistant-state/00000000-0000-4000-8000-000000000001/database.json',second='assistant-state/00000000-0000-4000-8000-000000000002/database.json';
  atomic(path.join(a.root,first),JSON.stringify({format:1,database:'state.db',profile:first.split('/')[1],tables:[],padding:'same '.repeat(100)}));
  assert.equal(sa.reconcile().state,'synced');assert.equal(sb.reconcile().state,'synced');
  fs.unlinkSync(path.join(b.root,first));atomic(path.join(b.root,second),JSON.stringify({format:1,database:'state.db',profile:second.split('/')[1],tables:[],padding:'same '.repeat(100)}));
  assert.equal(sb.reconcile().state,'synced');
  atomic(path.join(a.root,first),JSON.stringify({format:1,database:'state.db',profile:first.split('/')[1],tables:['new message'],padding:'same '.repeat(100)}));
  const outcome=sa.reconcile();assert.equal(outcome.state,'conflict');
  const conflicts=sa.pendingConflicts().map(n=>JSON.parse(fs.readFileSync(path.join(a.root,'conflicts',n))));
  assert.ok(conflicts.every(c=>c.path===first),JSON.stringify(conflicts.map(c=>c.path)));assert.ok(conflicts.every(c=>!c.local||JSON.parse(c.local).profile===first.split('/')[1]));
});

test('invalid assistant snapshots stay local instead of entering Git',()=>{
  const {a}=fixture(),sync=new FileSync(a);
  sync.initialize('https://github.com/synthetic/private.git');
  const name='assistant-state/00000000-0000-4000-8000-000000000001/state.json';
  atomic(path.join(a.root,name),'<<<<<<< unresolved merge');
  assert.equal(sync.reconcile().state,'pending');
  assert.doesNotMatch(git(a.root,'ls-files'),/state.json/);
});
test('binary skill edits keep both exact versions through conflict resolution and reconnect',()=>{
 const {a,b}=fixture(),file='skills/fictional/assets/font.bin',base=Buffer.alloc(1100000,255),local=Buffer.alloc(1100000,254),remote=Buffer.alloc(1100000,253),sa=new FileSync(a),sb=new FileSync(b);base[0]=local[0]=remote[0]=0;
 sa.initialize('https://github.com/synthetic/private.git');sb.initialize('https://github.com/synthetic/private.git');atomic(path.join(a.root,file),base);assert.equal(sa.reconcile().state,'synced');assert.equal(sb.reconcile().state,'synced');assert.deepEqual(fs.readFileSync(path.join(b.root,file)),base);
 atomic(path.join(a.root,file),remote);atomic(path.join(b.root,file),local);assert.equal(sa.reconcile().state,'synced');assert.equal(sb.reconcile().state,'conflict');const conflict=JSON.parse(fs.readFileSync(path.join(b.root,'conflicts',sb.pendingConflicts()[0])));assert.equal(conflict.encoding,'base64');assert.deepEqual(Buffer.from(conflict.local,'base64'),local);assert.deepEqual(Buffer.from(conflict.remote,'base64'),remote);sb.resolve(conflict.id,'local');assert.equal(sb.reconcile().state,'synced');assert.equal(sa.reconcile().state,'synced');assert.deepEqual(fs.readFileSync(path.join(a.root,file)),local);
});

// On the test server two devices merged each other's merge commits every
// minute for hours: 46 of 70 merges in three hours changed nothing. Each one
// made the other side merge again, and each merge re-read the whole vault
// while holding the workspace, so a note save waited behind it.
test('two devices with nothing new stop creating merge commits',()=>{
  const {a,b,remote}=fixture(),A=new FileSync(a),B=new FileSync(b);
  a.save('notes',{title:'Desktop note',content:'A'});b.save('contacts',{name:'Laptop person'});
  A.reconcile();B.reconcile();A.reconcile();
  const commits=()=>Number(git(remote,'rev-list','--count','main')),settled=commits();
  let merges=0;for(const sync of [A,B]){const integrate=sync.integrate.bind(sync);sync.integrate=(...args)=>{merges++;return integrate(...args);};}
  for(let round=0;round<3;round++){assert.equal(A.reconcile().state,'synced');assert.equal(B.reconcile().state,'synced');}
  assert.equal(commits()-settled,0,'idle devices added '+(commits()-settled)+' commits that change nothing');
  assert.equal(merges,0,'idle devices merged '+merges+' times');
  assert.equal(a.list('contacts').length,1);assert.equal(b.list('notes').length,2);
});

test('a device that only needs to catch up takes the other side as it is',()=>{
  const {a,b,remote}=fixture(),A=new FileSync(a),B=new FileSync(b);
  a.save('notes',{title:'Only on the desktop',content:'A'});A.reconcile();
  const before=git(remote,'rev-parse','main');
  assert.equal(B.reconcile().state,'synced');
  assert.equal(git(b.root,'rev-parse','HEAD'),before,'catching up must not add a merge commit of its own');
  assert.equal(git(remote,'rev-parse','main'),before);
  assert.ok(b.list('notes').some(n=>n.title==='Only on the desktop'));
});

// One idle round on the imported test server held the workspace for 2.3 s,
// 2.1 s of it validating a vault that nothing had changed, and a note save
// waited behind it once a minute.
test('a sync round with nothing new does not read the whole vault while holding it',()=>{
  const {a,b}=fixture(),A=new FileSync(a);
  a.save('notes',{title:'Desktop note',content:'A'});A.reconcile();new FileSync(b).reconcile();A.reconcile();
  const reads=a.reads;
  assert.equal(A.reconcile().state,'synced');
  assert.equal(a.reads-reads,0,'an idle sync round read the whole vault '+(a.reads-reads)+' times');
});

test('a sync round with a saved conflict still refuses, even with nothing new to upload',()=>{
  const {a}=fixture(),A=new FileSync(a);
  fs.mkdirSync(path.join(a.root,'conflicts'),{recursive:true});
  atomic(path.join(a.root,'conflicts','pending.json'),JSON.stringify({id:'pending',path:'notebook/notes/x.md'}));
  assert.equal(A.reconcile().state,'conflict');
});

test('taking the other side\'s commit that changes nothing does not rebuild the workspace',()=>{
  const {a,b,remote}=fixture(),A=new FileSync(a),B=new FileSync(b);
  a.save('notes',{title:'Desktop note',content:'A'});A.reconcile();B.reconcile();A.reconcile();
  // An older device wraps every head it receives in a merge of its own.
  git(b.root,'commit','--allow-empty','-m','Merge that changes nothing');git(b.root,'push','origin','HEAD:main');
  let integrations=0;const integrate=A.integrate.bind(A);A.integrate=(...args)=>{integrations++;return integrate(...args);};
  const reads=a.reads;
  assert.equal(A.reconcile().state,'synced');
  assert.equal(git(a.root,'rev-parse','HEAD'),git(remote,'rev-parse','main'),'this side must stand on the other side\'s commit');
  assert.equal(integrations,0,'a commit that changes nothing was integrated '+integrations+' times');
  assert.equal(a.reads-reads,0,'taking a commit that changes nothing read the vault '+(a.reads-reads)+' times');
});

test('a merge never acts on a view of the vault older than the lock it holds',()=>{
  const {a,b,note}=fixture(),A=new FileSync(a);
  b.save('contacts',{name:'Laptop person'});new FileSync(b).reconcile();
  a.scan();
  // Between this process reading the vault and taking the lock, another
  // program saves a note here.
  const other=new Store(a.root,{device:'desktop'});other.save('notes',{id:note.id,content:'Saved here a moment ago'},other.get('notes',note.id)._hash);
  assert.equal(A.reconcile().state,'synced');
  assert.equal(new Store(a.root).get('notes',note.id).content,'Saved here a moment ago','the merge must keep the newer local save');
  assert.equal(new Store(a.root).list('contacts').length,1);
});
