import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {planWorkspaceMove,moveWorkspace,undoWorkspaceMove} from '../core/workspace-move.mjs';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
function fixture(){const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-owned-move-')),root=path.join(base,'workspace'),to=path.join(base,'new-workspace'),installationFile=path.join(base,'installation.json'),store=new Store(root);fs.writeFileSync(path.join(root,'FULL-ALPHA.md'),'Isolated fictional test workspace');fs.writeFileSync(installationFile,JSON.stringify({channel:'full-alpha',dataFormat:1,workspace:root}));return {base,root,to,installationFile,store};}
test('physical move verifies recovery, keeps original bytes and old aliases; undo keeps later knowledge',()=>{
 const f=fixture(),note=f.store.save('notes',{title:'Fictional move source',content:'Before moving'});fs.mkdirSync(path.join(f.root,'.godspeed','private-fixture'));fs.writeFileSync(path.join(f.root,'.godspeed','private-fixture','retained.txt'),'Retained device fixture');
 const plan=planWorkspaceMove(f),before=fs.readFileSync(f.installationFile,'utf8');assert.equal(fs.readFileSync(f.installationFile,'utf8'),before);assert.equal(fs.existsSync(f.to),false);
 const moved=moveWorkspace(plan);assert.equal(moved.state,'verified');assert.equal(moved.restoration_verified,true);assert.equal(fs.realpathSync(f.root),fs.realpathSync(f.to));assert.equal(fs.readFileSync(path.join(moved.retained_original,'.godspeed','private-fixture','retained.txt'),'utf8'),'Retained device fixture');
 const current=new Store(f.to);assert.equal(current.get('notes',note.id).content,'Before moving');current.save('notes',{id:note.id,content:'After moving'});
 const undone=undoWorkspaceMove(moved.receipt_file);assert.equal(undone.state,'undone');assert.equal(new Store(f.root).get('notes',note.id).content,'After moving');assert.equal(fs.realpathSync(f.to),fs.realpathSync(f.root));assert.equal(fs.existsSync(moved.retained_original),true);assert.equal(fs.existsSync(undone.undo_retained),true);assert.equal(JSON.parse(fs.readFileSync(f.installationFile)).workspace,f.root);
});
test('move rejects changed plans, foreign pointers, nested destinations and live owned processes without copying',()=>{
 const f=fixture(),plan=planWorkspaceMove(f);f.store.save('notes',{content:'Later work'});assert.throws(()=>moveWorkspace(plan),/plan changed/);assert.equal(fs.existsSync(f.to),false);
 assert.throws(()=>planWorkspaceMove({...f,to:path.join(f.root,'nested')}),/outside/);
 fs.writeFileSync(path.join(f.root,'.godspeed','supervisor.json'),JSON.stringify({pid:process.pid}));const active=planWorkspaceMove(f);assert.equal(active.requires_owned_stop,true);assert.throws(()=>moveWorkspace(active),/Stop only/);assert.equal(fs.existsSync(f.to),false);
 fs.writeFileSync(f.installationFile,JSON.stringify({channel:'full-alpha',dataFormat:1,workspace:f.base}));assert.throws(()=>planWorkspaceMove(f),/does not own/);
});
// The folder's note is NOTEBOOK.md since 2.0.0-beta.11; an install that has not started since its
// update still has FULL-ALPHA.md (the fixture's), and both are a mission control with the notebook.
test('move takes a folder by its note under either name, and refuses one with neither',()=>{
 const f=fixture();fs.renameSync(path.join(f.root,'FULL-ALPHA.md'),path.join(f.root,'NOTEBOOK.md'));
 assert.equal(planWorkspaceMove(f).source,path.resolve(f.root));
 const g=fixture();assert.equal(planWorkspaceMove(g).source,path.resolve(g.root));
 const h=fixture();fs.rmSync(path.join(h.root,'FULL-ALPHA.md'));
 assert.throws(()=>planWorkspaceMove(h),/it holds NOTEBOOK\.md and notebook\//);assert.equal(fs.existsSync(h.to),false);
});
test('move refuses linked contents and installation pointers stored inside the folder being moved',()=>{
 const f=fixture();fs.symlinkSync(f.installationFile,path.join(f.root,'linked.json'));assert.throws(()=>planWorkspaceMove(f),/linked folder/);
 const g=fixture(),inside=path.join(g.root,'installation.json');fs.copyFileSync(g.installationFile,inside);assert.throws(()=>planWorkspaceMove({...g,installationFile:inside}),/outside/);
});
test('installed CLI dry run leaves the entire selected workspace unchanged and refuses another workspace plan',()=>{
 const f=fixture(),cli=fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url)),env={...process.env,GODSPEED_WORKSPACE:f.root};
 const before=planWorkspaceMove(f).files_hash,plan=JSON.parse(execFileSync(process.execPath,[cli,'workspace-move','plan',f.to,f.installationFile],{env,encoding:'utf8',windowsHide:true}));assert.equal(plan.files_hash,before);assert.equal(planWorkspaceMove(f).files_hash,before);
 const file=path.join(f.base,'plan.json');fs.writeFileSync(file,JSON.stringify({...plan,source:f.to}));assert.throws(()=>execFileSync(process.execPath,[cli,'workspace-move','apply',file],{env,encoding:'utf8',windowsHide:true,stdio:'pipe'}),/must own/);assert.equal(fs.existsSync(f.to),false);
 fs.writeFileSync(file,JSON.stringify(plan));const moved=JSON.parse(execFileSync(process.execPath,[cli,'workspace-move','apply',file],{env,encoding:'utf8',windowsHide:true,stdio:'pipe'}));assert.equal(moved.state,'verified');
 const undone=JSON.parse(execFileSync(process.execPath,[cli,'workspace-move','undo',moved.receipt_file],{env:{...env,GODSPEED_WORKSPACE:f.to},encoding:'utf8',windowsHide:true,stdio:'pipe'}));assert.equal(undone.state,'undone');
});
// Until 6 October 2026 the writer lock was released before the old folder was
// renamed aside, so a save made in between went into the retired folder and
// never into the moved copy; the same in an undo.
test('the old folder is renamed aside while the move still holds the writer lock, and an undo likewise',t=>{
 const f=fixture();f.store.save('notes',{title:'Fictional move source',content:'Before moving'});
 const plan=planWorkspaceMove(f),rename=fs.renameSync,locked={};
 t.mock.method(fs,'renameSync',(from,to)=>{for(const [name,folder] of [['move',plan.source],['undo',plan.destination]])if(from===folder&&!(name in locked))locked[name]=fs.existsSync(path.join(from,'.godspeed','workspace.lock'));return rename(from,to);});
 const moved=moveWorkspace(plan);
 assert.equal(locked.move,true);assert.equal(moved.state,'verified');
 assert.equal(fs.existsSync(path.join(moved.retained_original,'.godspeed','workspace.lock')),false,'the retained original keeps no lock');
 const undone=undoWorkspaceMove(moved.receipt_file);t.mock.restoreAll();
 assert.equal(locked.undo,true);assert.equal(undone.state,'undone');
 assert.equal(fs.existsSync(path.join(undone.undo_retained,'.godspeed','workspace.lock')),false);
 assert.equal(fs.existsSync(path.join(f.root,'.godspeed','workspace.lock')),false);
});
// Every new installation links .claude/skills and .agents/skills to skills/ (wire-assistant.mjs;
// on Windows they are junctions), and until 18 October 2026 those links made plan refuse every
// Windows installation with "The workspace contains a linked folder or file".
function linkSkills(root){
 fs.mkdirSync(path.join(root,'skills','plan-my-day'),{recursive:true});fs.writeFileSync(path.join(root,'skills','plan-my-day','SKILL.md'),'# Plan my day\n');
 for(const folder of ['.claude','.agents']){fs.mkdirSync(path.join(root,folder),{recursive:true});fs.symlinkSync(process.platform==='win32'?path.join(root,'skills'):'../skills',path.join(root,folder,'skills'),process.platform==='win32'?'junction':'dir');}
}
const leadsTo=(link,folder)=>fs.realpathSync(link)===fs.realpathSync(folder);
test('a folder whose skills are linked inside it moves, and its links lead into each copy afterwards',()=>{
 const f=fixture();f.store.save('notes',{title:'Fictional move source',content:'Before moving'});linkSkills(f.root);
 const plan=planWorkspaceMove(f);
 assert.deepEqual(Object.keys(plan.links).sort(),['.agents/skills','.claude/skills']);
 assert.equal(plan.links['.claude/skills'].target,'skills');
 assert.ok(!Object.keys(plan.files).some(name=>name.startsWith('.claude/skills/')),'a link is not followed');
 const moved=moveWorkspace(plan);assert.equal(moved.state,'verified');assert.equal(moved.copied_links,2);
 for(const folder of ['.claude','.agents']){
  assert.ok(leadsTo(path.join(f.to,folder,'skills'),path.join(f.to,'skills')),'the moved copy\'s '+folder+'/skills leads to its own skills');
  assert.ok(fs.lstatSync(path.join(f.to,folder,'skills')).isSymbolicLink(),'it is still a link');
  assert.ok(leadsTo(path.join(moved.retained_original,folder,'skills'),path.join(moved.retained_original,'skills')),'the retained original keeps its own');
 }
 assert.equal(fs.readFileSync(path.join(f.to,'.claude','skills','plan-my-day','SKILL.md'),'utf8'),'# Plan my day\n');
 const undone=undoWorkspaceMove(moved.receipt_file);assert.equal(undone.state,'undone');
 for(const folder of ['.claude','.agents']){
  assert.ok(leadsTo(path.join(f.root,folder,'skills'),path.join(f.root,'skills')),'after undo the folder\'s links lead into it');
  assert.ok(leadsTo(path.join(undone.undo_retained,folder,'skills'),path.join(undone.undo_retained,'skills')));
 }
});
test('a link that leads nowhere still stops the move, and so does one that leads outside',()=>{
 const f=fixture();fs.mkdirSync(path.join(f.root,'gone'));fs.symlinkSync(process.platform==='win32'?path.join(f.root,'gone'):'gone',path.join(f.root,'old-link'),process.platform==='win32'?'junction':'dir');fs.rmSync(path.join(f.root,'gone'),{recursive:true});
 assert.throws(()=>planWorkspaceMove(f),/leads nowhere \(old-link\)/);
 const g=fixture(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-outside-'));fs.symlinkSync(outside,path.join(g.root,'elsewhere'),process.platform==='win32'?'junction':'dir');
 assert.throws(()=>planWorkspaceMove(g),/linked folder or file that leads outside it \(elsewhere/);
});
test('a plan saved by Windows PowerShell 5.1 (UTF-16) is read by apply',()=>{
 const f=fixture(),cli=fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url)),env={...process.env,GODSPEED_WORKSPACE:f.root};linkSkills(f.root);
 const plan=execFileSync(process.execPath,[cli,'workspace-move','plan',f.to,f.installationFile],{env,encoding:'utf8',windowsHide:true});
 const file=path.join(f.base,'move-plan.json');fs.writeFileSync(file,Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(plan.replace(/\n/g,'\r\n'),'utf16le')]));
 const moved=JSON.parse(execFileSync(process.execPath,[cli,'workspace-move','apply',file],{env,encoding:'utf8',windowsHide:true,stdio:'pipe'}));
 assert.equal(moved.state,'verified');assert.equal(moved.copied_links,2);
 fs.writeFileSync(file,'not a plan');
 assert.throws(()=>execFileSync(process.execPath,[cli,'workspace-move','apply',file],{env,encoding:'utf8',windowsHide:true,stdio:'pipe'}),/The move plan .* cannot be read/);
});
