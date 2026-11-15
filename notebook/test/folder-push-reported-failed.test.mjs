import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store,atomic} from '../core/records/store.mjs';
import {FileSync} from '../core/sync/git.mjs';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const identity=(dir,name)=>{git(dir,'config','user.name',name);git(dir,'config','user.email',name.toLowerCase()+'@localhost');};

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-push-failed-')),origin=path.join(root,'origin.git');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(origin);git(origin,'init','--bare','--initial-branch=main');
  const seed=path.join(root,'seed');git(root,'clone',origin,seed);identity(seed,'Owner');
  for(const [file,text] of [['.gitignore','/.godspeed/\n/conflicts/\n/FULL-ALPHA.md\n/assistant-state/\n'],['.gitattributes','* text=auto eol=lf\nnotebook/** -text\n'],['AGENTS.md','Owner manual\n']])atomic(path.join(seed,file),text);
  git(seed,'add','-A');git(seed,'commit','-m','Owner mission control');git(seed,'push','origin','main');
  const machine=name=>{const dir=path.join(root,name);git(root,'clone',origin,dir);identity(dir,'Owner');const store=new Store(dir,{device:name});atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true,repository:'folder',paths:['notebook']}));return {dir,store,sync:new FileSync(store)};};
  return {machine};
}
const reviews=dir=>{const folder=path.join(dir,'conflicts');return fs.existsSync(folder)?fs.readdirSync(folder).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(folder,n),'utf8'))):[];};

// Both machines changed the same line of a note. The merge keeps this
// machine's version and saves the other machine's for review once the push
// is through. A push that reached GitHub but was reported as failed (the
// connection dropped after the remote took it, a time limit) threw that
// review away: the other machine's edit then lived only in Git's history
// (7 October 2026). Whether it arrived is now checked, at once or, offline,
// on the next round.
function conflicting(t){
  const {machine}=fixture(t),envy=machine('envy'),laptop=machine('laptop');
  const note=envy.store.save('notes',{title:'Plan',content:'Line one\n'});
  assert.equal(envy.sync.reconcile().state,'synced');assert.equal(laptop.sync.reconcile().state,'synced');
  laptop.store.save('notes',{...laptop.store.get('notes',note.id),content:'Line one, as the laptop has it\n'},laptop.store.get('notes',note.id)._hash);
  assert.equal(laptop.sync.reconcile().state,'synced');
  envy.store.save('notes',{...envy.store.get('notes',note.id),content:'Line one, as envy has it\n'},envy.store.get('notes',note.id)._hash);
  return {envy,note};
}
// Git fails as told for the commands named, in that order, once each, and
// answers as itself otherwise. A push cut off after the remote took it
// (`after`) leaves this machine's copy of the remote branch where it was, as
// a dropped connection or a time limit does.
function failing(sync,plan){
  const real=sync.git.bind(sync),calls=[];
  sync.git=(args,...rest)=>{
    const next=plan.find(p=>!p.done),step=next?.command===args[0]?next:null;calls.push(args[0]);
    if(!step)return real(args,...rest);
    step.done=true;
    if(step.after){const before=real(['rev-parse','origin/main']);real(args,...rest);real(['update-ref','refs/remotes/origin/main',before]);}
    throw new Error(step.message);
  };
  return calls;
}
function kept(envy,note){
  const found=reviews(envy.dir).filter(r=>r.path==='notebook/Plan.md');
  assert.equal(found.length,1,'the other machine edit is kept for review');
  assert.match(found[0].remote,/as the laptop has it/);
  assert.equal(envy.store.get('notes',note.id).content,'Line one, as envy has it\n');
}

test('a push that arrived but was reported as failed finishes as synced and keeps the review',t=>{
  const {envy,note}=conflicting(t);
  failing(envy.sync,[{command:'push',after:true,message:'Connection reset after the remote took the push'}]);
  assert.equal(envy.sync.reconcile().state,'synced');
  kept(envy,note);
  assert.equal(git(envy.dir,'rev-parse','HEAD'),git(envy.dir,'rev-parse','origin/main'));
});

test('offline right after such a push, the review is kept on the next round',t=>{
  const {envy,note}=conflicting(t);
  failing(envy.sync,[{command:'push',after:true,message:'Connection reset after the remote took the push'},{command:'fetch',message:'Could not resolve host'}]);
  assert.equal(envy.sync.reconcile().state,'pending');
  assert.ok(fs.existsSync(path.join(envy.store.state,'sync-pushing.json')),'what to finish is kept');
  assert.equal(envy.sync.reconcile().state,'synced');
  kept(envy,note);
});
