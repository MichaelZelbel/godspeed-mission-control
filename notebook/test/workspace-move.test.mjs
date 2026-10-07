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
