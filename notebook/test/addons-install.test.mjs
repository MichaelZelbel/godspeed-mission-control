import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {Addons,resolveAddon,loadCatalog,readAdded,REFUSED} from '../core/addons-install.mjs';
import {runChild} from '../core/child-process.mjs';
// Adding an add-on (#1162), against a local test add-on repository: nothing reaches GitHub.
// This is in addition to the contract's own scenario with the real Wingman, never instead of it.
const git=(cwd,...args)=>execFileSync('git',['-c','user.email=t@t','-c','user.name=t',...args],{cwd,stdio:'pipe'});
function world(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'addon-world-'));
  const remote=path.join(base,'remotes','acme','demo.git'),root=path.join(base,'mission');
  fs.mkdirSync(path.join(remote,'bin'),{recursive:true});fs.mkdirSync(root);
  fs.writeFileSync(path.join(remote,'package.json'),JSON.stringify({name:'demo',bin:{demo:'bin/demo.mjs'}}));
  fs.writeFileSync(path.join(remote,'bin','demo.mjs'),"import fs from 'node:fs';const w=process.env.GODSPEED_WORKSPACE,v=process.argv[2];if(v==='setup')fs.appendFileSync(w+'/setups.txt','x\\n');if(v==='check')process.exit(fs.existsSync(w+'/setups.txt')?0:1);");
  git(remote,'init','-q');git(remote,'add','-A');git(remote,'commit','-qm','one');
  const catalog=[{id:'demo',name:'the Demo',aliases:['the demo'],repository:'acme/demo',description:'A test add-on.',start:'Open your Demo page.'}];
  return {base,root,catalog,url:'file://'+path.join(base,'remotes')+'/'};
}

test('the shipped list names the Wingman and the video add-on with the commands each runs',()=>{
  const catalog=loadCatalog(),wingman=catalog.find(e=>e.id==='wingman');
  assert.equal(wingman.repository,'MichaelZelbel/godspeed-wingman');
  assert.deepEqual([wingman.setup,wingman.check],[['bin/godspeed-wingman.mjs','setup'],['bin/godspeed-wingman.mjs','check']]);
  assert.equal(resolveAddon('Video',catalog).repository,'MichaelZelbel/mc-video');
  assert.equal(resolveAddon('https://github.com/MichaelZelbel/godspeed-wingman.git',catalog).id,'wingman');
  assert.throws(()=>resolveAddon('somebody said wingman?',catalog),/GitHub repository/);
});

test('adding an add-on fetches, sets up, checks and records it; adding again updates without asking',async()=>{
  const w=world(),addons=new Addons({root:w.root,base:w.url,catalog:w.catalog});
  assert.equal(addons.list()[0].added,false);
  const first=await addons.add('the demo');
  assert.equal(first.state,'added');assert.equal(first.message,'I added the Demo. Open your Demo page.');
  assert.doesNotMatch(first.message,/node|setup|check|npx|git/i);
  assert.equal(addons.list()[0].added,true);
  fs.appendFileSync(path.join(w.base,'remotes/acme/demo.git/bin/demo.mjs'),'\n');git(path.join(w.base,'remotes/acme/demo.git'),'commit','-qam','two');
  const before=readAdded(w.root).demo;
  const second=await addons.add('demo');
  assert.equal(second.state,'added');
  assert.equal(fs.readFileSync(path.join(w.root,'setups.txt'),'utf8'),'x\nx\n');
  assert.notEqual(readAdded(w.root).demo.commit,before.commit);assert.equal(readAdded(w.root).demo.added_at,before.added_at);
});

test('an add-on outside the list waits for one plain yes and then uses the program its package names',async()=>{
  const w=world(),addons=new Addons({root:w.root,base:w.url,catalog:[]});
  const ask=await addons.add('https://github.com/acme/demo');
  assert.deepEqual([ask.state,ask.message],['confirm','This installs code from acme/demo. Add it?']);
  assert.equal(fs.existsSync(path.join(w.root,'.godspeed')),false);
  assert.equal((await addons.add('acme/demo',{confirmed:true})).state,'added');
});

test('a refused fetch asks for GitHub sign-in, never a password, and runs the same fetch again after it',async()=>{
  const w=world();let refusing=true;
  const run=(program,args,options)=>refusing&&args[0]==='clone'?Promise.resolve({code:128,stdout:'',stderr:"fatal: could not read Username for 'https://github.com': terminal prompts disabled"}):runChild(program,args,options);
  let retry;const started=[];
  const signIn={start:(url,again)=>{started.push(url);retry=again;return {state:'signing_in',code:'ABCD-1234',url:'https://github.com/login/device'};}};
  const addons=new Addons({root:w.root,base:w.url,catalog:w.catalog,run,signIn});
  const r=await addons.add('demo');
  assert.equal(r.state,'signing_in');assert.equal(r.signIn.code,'ABCD-1234');assert.deepEqual(started,[w.url+'acme/demo.git']);
  assert.doesNotMatch(JSON.stringify(r),/password|token/i);
  assert.equal(addons.list()[0].added,false);
  refusing=false;await retry();
  assert.equal(addons.list()[0].added,true);
});

test('a refusal with no sign-in to offer, and a setup that stops, each say so plainly and record nothing',async()=>{
  const w=world();
  const refuse=()=>Promise.resolve({code:128,stdout:'',stderr:'remote: Repository not found.'});
  await assert.rejects(new Addons({root:w.root,base:w.url,catalog:w.catalog,run:refuse}).add('demo'),{message:REFUSED});
  fs.writeFileSync(path.join(w.base,'remotes/acme/demo.git/bin/demo.mjs'),'process.exit(3)');git(path.join(w.base,'remotes/acme/demo.git'),'commit','-qam','broken');
  await assert.rejects(new Addons({root:w.root,base:w.url,catalog:w.catalog}).add('demo'),/did not finish: its setup stopped/);
  assert.deepEqual(readAdded(w.root),{});
});

test('an unlisted repository never shares a folder or record with a listed one',async()=>{
  const w=world(),other=path.join(w.base,'remotes','someone','demo.git');
  fs.mkdirSync(path.join(other,'bin'),{recursive:true});
  fs.writeFileSync(path.join(other,'package.json'),JSON.stringify({name:'demo',bin:{demo:'bin/demo.mjs'}}));
  fs.writeFileSync(path.join(other,'bin','demo.mjs'),'process.exit(0)');
  git(other,'init','-q');git(other,'add','-A');git(other,'commit','-qm','other');
  const addons=new Addons({root:w.root,base:w.url,catalog:w.catalog});
  assert.equal((await addons.add('demo')).state,'added');
  assert.equal((await addons.add('someone/demo',{confirmed:true})).state,'added');
  const added=readAdded(w.root);
  assert.deepEqual(Object.keys(added).sort(),['demo','someone--demo']);
  assert.equal(added.demo.repository,'acme/demo');assert.equal(added['someone--demo'].repository,'someone/demo');
});

test('a fetch into an existing folder uses the expected repository, not the folder\'s old origin',async()=>{
  const w=world(),addons=new Addons({root:w.root,base:w.url,catalog:w.catalog});
  await addons.add('demo');
  const copy=path.join(w.root,'.godspeed','addons','demo');
  git(copy,'remote','set-url','origin','file:///nowhere');
  assert.equal((await addons.add('demo')).state,'added');
});

test('git runs in English so a refusal is recognised on any language setting',async()=>{
  const w=world();let seen;
  const run=(program,args,options)=>{seen=options.env.LC_ALL;return Promise.resolve({code:128,stdout:'',stderr:'remote: Repository not found.'});};
  await assert.rejects(new Addons({root:w.root,base:w.url,catalog:w.catalog,run}).add('demo'),{message:REFUSED});
  assert.equal(seen,'C');
});

test('a sign-in already under way is said plainly instead of being dropped',async()=>{
  const w=world();
  const run=()=>Promise.resolve({code:128,stdout:'',stderr:'fatal: could not read Username: terminal prompts disabled'});
  const signIn={busy:true,start:()=>assert.fail('must not start')};
  await assert.rejects(new Addons({root:w.root,base:w.url,catalog:w.catalog,run,signIn}).add('demo'),/Another GitHub sign-in is under way/);
});

test('a failing check records the add-on as not added, with a reason',async()=>{
  const w=world(),remote=path.join(w.base,'remotes/acme/demo.git');
  fs.writeFileSync(path.join(remote,'bin','demo.mjs'),'if(process.argv[2]==="check")process.exit(1);');git(remote,'commit','-qam','bad check');
  const addons=new Addons({root:w.root,base:w.url,catalog:w.catalog});
  const r=await addons.add('demo');
  assert.equal(r.state,'problem');assert.match(r.message,/check found a problem/);
  assert.equal(addons.list()[0].added,false);assert.match(addons.list()[0].message,/problem/);
});

test('an add-on whose commands point outside its folder is refused before anything runs',async()=>{
  const w=world(),addons=new Addons({root:w.root,base:w.url,catalog:[{...w.catalog[0],setup:['../../../outside.mjs','setup'],check:['bin/demo.mjs','check']}]});
  await assert.rejects(addons.add('demo'),/outside its own folder/);
  assert.deepEqual(readAdded(w.root),{});
});

test('the command line asks before installing a repository outside the list',()=>{
  const w=world(),cli=fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url));
  const out=execFileSync(process.execPath,[cli,'addon','add','acme/demo'],{env:{...process.env,GODSPEED_WORKSPACE:w.root},encoding:'utf8'});
  assert.equal(JSON.parse(out).state,'confirm');assert.equal(fs.existsSync(path.join(w.root,'.godspeed')),false);
});
