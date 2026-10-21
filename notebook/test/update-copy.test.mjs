import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {Store,hash} from '../core/records/store.mjs';
import {backup,restore,restoreSeparateCopy} from '../core/archives.mjs';
import {makeUpdateCopy,folderCommit} from '../core/update-copy.mjs';
import {inUpdateCopy} from '../core/file-policy.mjs';

// THE COPY AN UPDATE MAKES BEFORE IT CHANGES ANYTHING (core/update-copy.mjs). Until 21 October
// 2026 every update first copied every durable folder whole: on one computer 8.33 GB and sixteen
// minutes, and with 5.4 GB free the update refused to start. Most of it was work/, which no
// update writes, and most of the rest was already in the folder's Git history.
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-update-copy-'));
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const write=(root,name,bytes)=>{const file=path.join(root,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
const read=(root,name)=>fs.readFileSync(path.join(root,...name.split('/')));
// Every file under a folder by name, with its bytes' hash; .godspeed and .git are left out.
const tree=root=>{const out={};const walk=(dir,rel)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(!rel&&['.godspeed','.git'].includes(e.name))continue;const r=rel?rel+'/'+e.name:e.name,f=path.join(dir,e.name);if(e.isDirectory())walk(f,r);else out[r]=hash(fs.readFileSync(f));}};walk(root,'');return out;};
const inScope=files=>Object.fromEntries(Object.entries(files).filter(([name])=>inUpdateCopy(name)));

// A mission control that is its own repository, committed, and then changed the way a day of use
// changes one: a note edited and one added after the last commit, a committed page deleted, a
// recipe nobody committed, the assistant's state that is ignored, its undo archive, and work/.
function repository(){
  const base=temp(),root=path.join(base,'mission control'),media=path.join(base,'media');
  fs.mkdirSync(root,{recursive:true});fs.mkdirSync(media);write(media,'photo.bin',Buffer.from([0,255,7,19]));
  git(root,'init','-q');git(root,'config','user.name','Fictional');git(root,'config','user.email','fictional@example.invalid');
  write(root,'.gitignore','.godspeed/\nassistant-state/\n');
  const store=new Store(root);
  const kept=store.save('notes',{title:'Kept',content:'committed and unchanged'}),edited=store.save('notes',{title:'Edited',content:'as committed'});
  write(root,'AGENTS.md','# Fictional manual\n');write(root,'goals/finished.md','A fictional goal\n');write(root,'skills/committed/SKILL.md','A committed recipe\n');
  write(root,'work/committed-plan.md','A plan in work/\n');
  git(root,'add','-A');git(root,'commit','-q','-m','A fictional day');
  store.save('notes',{id:edited.id,content:'edited after the commit'});const added=store.save('notes',{title:'Added',content:'never committed'});
  fs.rmSync(path.join(root,'goals','finished.md'));
  write(root,'skills/uncommitted/SKILL.md','A recipe nobody committed\n');
  write(root,'assistant-state/state.json','{"ignored":"by Git"}');write(root,'assistant-state/history/old.json','{"undo":"archive"}');
  write(root,'work/recording.bin',Buffer.alloc(256*1024,7));write(root,'work/committed-plan.md','Changed, but no update writes work/\n');
  return {base,root,media,store,kept,edited,added};
}

test('in a folder with Git the copy holds only what its commit does not, and never work/',()=>{
  const f=repository(),index=read(f.root,'.git/index'),status=git(f.root,'status','--porcelain','--ignored');
  const result=makeUpdateCopy(f.store,f.media,path.join(f.base,'backups','20261021-120000-001'));
  const manifest=JSON.parse(read(result.path,'backup.json'));
  assert.equal(result.kind,'git');assert.equal(manifest.format,2);assert.equal(manifest.kind,'update-copy');
  assert.equal(manifest.git.commit,git(f.root,'rev-parse','HEAD'));
  assert.equal(git(f.root,'rev-parse',manifest.git.ref),manifest.git.commit,'the commit is kept by a ref of its own');
  const saved=manifest.files.map(entry=>entry.path).sort(),page=record=>path.relative(f.root,f.store.file(record)).split(path.sep).join('/');
  // The notebook's own history of the two saves (notebook/_system/record_history) comes along too.
  assert.deepEqual(saved.filter(name=>!name.startsWith('notebook/_system/')),['assistant-state/state.json','media/photo.bin',page(f.added),page(f.edited),'skills/uncommitted/SKILL.md'].sort());
  assert.ok(!saved.some(name=>name.startsWith('work/')||name.startsWith('assistant-state/history')||name==='AGENTS.md'||name.includes('Kept')),'nothing Git holds as it is, nothing in work/, not the undo archive');
  assert.deepEqual(manifest.absent,['goals/finished.md']);
  assert.equal(manifest.records,f.store.scan(true).size);
  assert.ok(result.bytes<10000,'a few kilobytes, not the 256 KB recording');
  assert.deepEqual(read(f.root,'.git/index'),index,'the owner\'s index is never written');
  assert.equal(git(f.root,'status','--porcelain','--ignored'),status,'nor anything in the folder');
});

test('restoring the copy gives back exactly what an update can change, and only reads the repository',()=>{
  const f=repository(),before=inScope(tree(f.root));
  const copy=makeUpdateCopy(f.store,f.media,path.join(f.base,'backups','20261021-120000-001')).path;
  const index=read(f.root,'.git/index'),live=tree(f.root),saved=tree(copy);
  for(const name of ['first','second']){
    const target=new Store(path.join(f.base,name)),media=path.join(f.base,name+'-media');
    assert.equal(restore(target,media,copy),f.store.scan(true).size);
    assert.deepEqual(inScope(tree(target.root)),before,'every file an update can change, byte for byte, and no other');
    assert.equal(target.get('notes',f.edited.id).content,'edited after the commit');assert.equal(target.get('notes',f.added.id).content,'never committed');
    assert.equal(fs.existsSync(path.join(target.root,'goals','finished.md')),false,'a deleted page stays deleted');
    assert.deepEqual(fs.readdirSync(media),['photo.bin']);
    assert.deepEqual(fs.readdirSync(target.state).filter(name=>name.startsWith('.laid-out-')),[],'and nothing of the laying out is left');
  }
  const separate=restoreSeparateCopy(new Store(path.join(f.base,'live')),copy);
  assert.equal(separate.verified,true);assert.equal(separate.source,copy);assert.equal(separate.records,f.store.scan(true).size);
  assert.deepEqual(inScope(tree(separate.workspace)),before);
  assert.deepEqual(read(f.root,'.git/index'),index);assert.deepEqual(tree(f.root),live);assert.deepEqual(tree(copy),saved,'the copy is exactly as it was');
});

// A Windows Git set to convert line endings (core.autocrlf, Git for Windows' own default) calls a
// file unchanged whose bytes on disk are not the commit's. The copy compares bytes, never Git's view.
test('files Git checked out with other line endings are left to the commit when Git gives them back exactly, and every file comes back byte for byte',()=>{
  const f=repository();
  write(f.root,'rules/two-lines.md','one\ntwo\n');git(f.root,'add','rules/two-lines.md');git(f.root,'commit','-q','-m','A rule');
  // Git itself writes the files with CRLF, as a checkout or a pull on such a computer does.
  git(f.root,'config','core.autocrlf','true');
  for(const name of ['AGENTS.md','rules/two-lines.md']){fs.rmSync(path.join(f.root,...name.split('/')));git(f.root,'checkout','--',name);}
  assert.deepEqual(read(f.root,'AGENTS.md'),Buffer.from('# Fictional manual\r\n'));
  assert.equal(git(f.root,'status','--porcelain','--','AGENTS.md','rules'),'','Git calls both unchanged');
  // And an editor saved one with mixed line endings, which Git's checkout would not give back.
  write(f.root,'rules/two-lines.md','one\r\ntwo\n');
  const copy=makeUpdateCopy(f.store,f.media,path.join(f.base,'backups','20261021-120000-001')).path,manifest=JSON.parse(read(copy,'backup.json'));
  assert.deepEqual(Object.keys(manifest.converted),['AGENTS.md'],'left to the commit and Git\'s own checkout');
  assert.ok(!manifest.files.some(entry=>entry.path==='AGENTS.md'));
  assert.ok(manifest.files.some(entry=>entry.path==='rules/two-lines.md'),'one Git would not give back exactly is saved');
  assert.deepEqual(fs.readdirSync(path.dirname(copy)),['20261021-120000-001'],'nothing of the check is left');
  const target=new Store(path.join(f.base,'restored'));restore(target,path.join(f.base,'restored-media'),copy);
  assert.deepEqual(read(target.root,'AGENTS.md'),Buffer.from('# Fictional manual\r\n'));
  assert.deepEqual(read(target.root,'rules/two-lines.md'),Buffer.from('one\r\ntwo\n'));
  assert.deepEqual(read(target.root,'skills/committed/SKILL.md'),Buffer.from('A committed recipe\n'),'a file Git never converted keeps its own line endings');
  // Git's settings changed since: the commit's own bytes, which Git counts as the same file.
  git(f.root,'config','core.autocrlf','false');
  const later=new Store(path.join(f.base,'later'));restore(later,path.join(f.base,'later-media'),copy);
  assert.deepEqual(read(later.root,'AGENTS.md'),Buffer.from('# Fictional manual\n'));
});

test('a file Git calls unchanged but whose checkout would give other bytes is saved',()=>{
  const f=repository();
  // core.autocrlf=input: Git reads CRLF as LF but checks out LF, so a CRLF file looks unchanged.
  git(f.root,'config','core.autocrlf','input');write(f.root,'AGENTS.md','# Fictional manual\r\n');
  assert.equal(git(f.root,'hash-object','AGENTS.md'),git(f.root,'rev-parse','HEAD:AGENTS.md'),'Git reads it as the committed file');
  const copy=makeUpdateCopy(f.store,f.media,path.join(f.base,'backups','20261021-120000-001')).path,manifest=JSON.parse(read(copy,'backup.json'));
  assert.deepEqual(manifest.converted,{});assert.ok(manifest.files.some(entry=>entry.path==='AGENTS.md'));
  const target=new Store(path.join(f.base,'restored'));restore(target,path.join(f.base,'restored-media'),copy);
  assert.deepEqual(read(target.root,'AGENTS.md'),Buffer.from('# Fictional manual\r\n'));
});

test('a folder without a repository of its own gets what an update can change copied whole, which any restore reads',()=>{
  for(const inside of [false,true]){
    const base=temp(),root=inside?path.join(base,'outer','mission control'):path.join(base,'mission control'),media=path.join(base,'media');
    fs.mkdirSync(root,{recursive:true});fs.mkdirSync(media);
    if(inside){git(path.join(base,'outer'),'init','-q');}
    const store=new Store(root);store.save('notes',{title:'Only here',content:'no repository'});
    write(root,'AGENTS.md','manual\n');write(root,'work/recording.bin',Buffer.alloc(64*1024,1));write(root,'assistant-state/history/old.json','{}');
    assert.equal(folderCommit(root),null);
    const result=makeUpdateCopy(store,media,path.join(base,'backups','20261021-120000-001')),manifest=JSON.parse(read(result.path,'backup.json'));
    assert.equal(result.kind,'files');assert.equal(manifest.format,1,'a whole copy, which every version restores');assert.equal(manifest.kind,'update-copy');
    assert.ok(manifest.files.some(entry=>entry.path==='AGENTS.md')&&manifest.files.some(entry=>entry.path.startsWith('notebook/')));
    assert.ok(!manifest.files.some(entry=>entry.path.startsWith('work/')||entry.path.startsWith('assistant-state/history')));
    const target=new Store(path.join(base,'restored'));assert.equal(restore(target,path.join(base,'restored-media'),result.path),1);
    assert.equal(target.list('notes')[0].content,'no repository');
  }
});

test('the space it asks for is the copy\'s own, so a computer without room for a whole copy still updates',t=>{
  const f=repository();write(f.root,'work/big.bin',Buffer.alloc(4*1024*1024,3));
  // Room for this copy and the reserve, but not for a whole one of every durable folder.
  const reserve=256*1024*1024,room=BigInt(reserve+2*1024*1024);
  t.mock.method(fs,'statfsSync',()=>({bavail:room,bsize:1n}));
  assert.throws(()=>backup(f.store,f.media,path.join(f.base,'whole')),/Creating a backup needs .* GB free/);
  const made=makeUpdateCopy(f.store,f.media,path.join(f.base,'backups','20261021-120000-001'));
  assert.equal(made.kind,'git');
  // And with no room at all it stops before it writes anything, with the same words as before.
  t.mock.method(fs,'statfsSync',()=>({bavail:0n,bsize:4096n}));
  const destination=path.join(f.base,'backups','20261022-120000-001');
  assert.throws(()=>makeUpdateCopy(f.store,f.media,destination),/Creating a backup needs .* GB free, but only 0\.00 GB is available/);
  assert.deepEqual(fs.readdirSync(path.join(f.base,'backups')),['20261021-120000-001']);
  assert.equal(git(f.root,'for-each-ref','--format=%(refname)','refs/godspeed/'),made.ref);
});

test('a copy that stops part-way leaves neither a folder nor a ref',t=>{
  const f=repository(),parent=path.join(f.base,'backups'),rename=fs.renameSync;
  t.mock.method(fs,'renameSync',(from,to)=>{if(String(to).endsWith('20261021-120000-001'))throw Object.assign(Error('ENOSPC: the fictional disk is full'),{code:'ENOSPC'});return rename(from,to);});
  assert.throws(()=>makeUpdateCopy(f.store,f.media,path.join(parent,'20261021-120000-001')),/fictional disk is full/);
  t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(parent),[]);
  assert.equal(git(f.root,'for-each-ref','refs/godspeed/'),'');
  const copyFile=fs.copyFileSync;let copies=0;
  t.mock.method(fs,'copyFileSync',(...args)=>{if(++copies===2)throw Object.assign(Error('EIO: a fictional read error'),{code:'EIO'});return copyFile(...args);});
  assert.throws(()=>makeUpdateCopy(f.store,f.media,path.join(parent,'20261021-120000-002')),/fictional read error/);
  t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(parent),[]);assert.equal(git(f.root,'for-each-ref','refs/godspeed/'),'');
});

test('a commit that is not in the repository is said plainly, and --repository names one that has it',()=>{
  const f=repository();
  const copy=makeUpdateCopy(f.store,f.media,path.join(f.base,'backups','20261021-120000-001')).path,records=f.store.scan(true).size;
  const moved=path.join(f.base,'moved');fs.renameSync(f.root,moved);
  const target=new Store(path.join(f.base,'restored'));
  assert.throws(()=>restore(target,path.join(f.base,'restored-media'),copy),/that commit is not there\. Restore it on the computer it was made on, or name the repository that has the commit with --repository/);
  assert.equal(restore(target,path.join(f.base,'restored-media'),copy,{repository:moved}),records);
});

test('a saved file that changed since is refused before anything is restored',()=>{
  const f=repository();
  const copy=makeUpdateCopy(f.store,f.media,path.join(f.base,'backups','20261021-120000-001')).path;
  write(copy,'skills/uncommitted/SKILL.md','tampered\n');
  const target=new Store(path.join(f.base,'restored'));
  assert.throws(()=>restore(target,path.join(f.base,'restored-media'),copy),/Backup integrity mismatch/);
  assert.equal(target.scan().size,0);
});

const cli=fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url));
const run=(root,args,extra={})=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...process.env,GODSPEED_WORKSPACE:root,...extra}});
test('godspeed.mjs backup --before-update makes this copy, and backup alone still the whole one',()=>{
  const f=repository(),env={GODSPEED_MEDIA_ROOT:f.media};
  const small=run(f.root,['backup',path.join(f.base,'small'),'--before-update'],env);
  assert.equal(small.status,0,small.stderr);
  assert.equal(JSON.parse(small.stdout).kind,'git');assert.equal(JSON.parse(read(path.join(f.base,'small'),'backup.json')).format,2);
  const whole=run(f.root,['backup',path.join(f.base,'whole')],env);
  assert.equal(whole.status,0,whole.stderr);
  const manifest=JSON.parse(read(path.join(f.base,'whole'),'backup.json'));
  assert.equal(manifest.format,1);assert.ok(manifest.files.some(entry=>entry.path==='work/recording.bin'),'the whole backup an owner asks for still holds work/');
  const empty=path.join(f.base,'restored');fs.mkdirSync(empty);
  const restored=run(empty,['restore',path.join(f.base,'small')],{GODSPEED_MEDIA_ROOT:path.join(f.base,'restored-media')});
  assert.equal(restored.status,0,restored.stderr);assert.equal(JSON.parse(restored.stdout),f.store.scan(true).size);
  const unnamed=run(empty,['restore',path.join(f.base,'small'),'--repository']);
  assert.notEqual(unnamed.status,0);assert.match(unnamed.stderr,/Name the repository after --repository/);
});

// The promise the scope rests on: an update never changes or removes a file outside what the copy
// holds. Here the real init every installer runs on an update, over a mission control in use.
test('an update changes nothing outside what the copy holds: init over a mission control in use',()=>{
  const base=temp(),root=path.join(base,'mission control');fs.mkdirSync(root);
  const env={GODSPEED_MEDIA_ROOT:path.join(base,'media')};
  const first=run(root,['init'],env);assert.equal(first.status,0,first.stderr);
  // A month of use: the owner's work, edits to what the starter brought, a recipe of their own.
  for(const [name,text] of [['work/plan.md','My plan\n'],['work/recording.bin','x'.repeat(4096)],['goals/mine.md','My goal\n'],['profile/me.md','About me\n'],['rules/mine.md','My rule\n'],['skills/mine/SKILL.md','My recipe\n'],['prompts/2026-10/chat.md','A chat\n'],['world/events/e.md','An event\n']])write(root,name,text);
  for(const name of Object.keys(tree(root)).filter(n=>/^(work|goals|profile|rules|observations|ideas|due|world|forecasts|inbox)\//.test(n)).slice(0,20))fs.appendFileSync(path.join(root,...name.split('/')),'\nEdited by the owner.\n');
  // What an earlier version left, which this update brings up to date: the notebook's note as
  // it read before the notebook folder was renamed (bin/godspeed.mjs init).
  write(root,'FULL-ALPHA.md','# Integrated notebook\n\nThis is the complete Godspeed Mission Control starter with an integrated notebook. AGENTS.md and the original folder workflow remain the operating manual. Notebook records live in records/ alongside those folders. Use the notebook or its MCP tools for notebook edits; use the original commands and readable files for Godspeed work. Credentials and disposable SQLite indexes stay in .godspeed and never enter private Git sync. Connected file sync uses the conflict-preserving reconciler; do not run a second Git synchronizer on the same workspace.\n');
  const before=tree(root);
  const again=run(root,['init'],env);assert.equal(again.status,0,again.stderr);
  const after=tree(root),touched=Object.keys(before).filter(name=>after[name]!==before[name]);
  assert.ok(touched.includes('FULL-ALPHA.md'),'the update did change something');
  assert.deepEqual(touched.filter(name=>!inUpdateCopy(name)),[],'every file the update changed or removed is in the copy');
  for(const name of Object.keys(before).filter(n=>n.startsWith('work/')))assert.equal(after[name],before[name],name+' is as it was');
});
