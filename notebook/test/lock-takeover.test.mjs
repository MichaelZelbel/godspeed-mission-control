import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';

// Reviewed on 6 October 2026: two programs that both found a dead writer's
// lock each removed "its" lock, the second removing the first's fresh one, so
// both wrote at once; the loser crashed with a raw ENOENT or EPERM. A lock
// whose number now belongs to another program, or an empty one left by a
// crash, blocked every save for good.
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-lock-takeover-'));
const storeUrl=new URL('../core/records/store.mjs',import.meta.url).href;
const deadPid=()=>Number(spawnSync(process.execPath,['-e','console.log(process.pid)'],{encoding:'utf8'}).stdout.trim());
// A program that enters the writer lock once, notes when it held it, and
// retries a busy workspace, holding it for `hold` milliseconds. `pause` makes
// it stop for a while each time it has read the lock file, as a descheduled
// process does.
function writer(root,start,pause=0,hold=40){
  const script=path.join(root,'writer.mjs');
  if(!fs.existsSync(script))fs.writeFileSync(script,`import fs from 'node:fs';import path from 'node:path';
const {Store}=await import(${JSON.stringify(storeUrl)});
const [root,start,pause,hold]=process.argv.slice(2),log=path.join(root,'holders.log'),sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const s=Object.create(Store.prototype);s.root=root;s.state=path.join(root,'.godspeed');
if(Number(pause)){const read=fs.readFileSync;fs.readFileSync=function(file,...rest){const value=read.call(this,file,...rest);if(String(file).endsWith('workspace.lock'))sleep(Number(pause));return value;};}
while(Date.now()<Number(start))sleep(2);
for(let i=0;i<400;i++){
  try{s.withLock(()=>{fs.appendFileSync(log,'in '+process.pid+'\\n');sleep(Number(hold));fs.appendFileSync(log,'out '+process.pid+'\\n');});break;}
  catch(e){if(e.code!=='WRITER_BUSY'){fs.appendFileSync(log,'err '+e.code+' '+e.message+'\\n');break;}sleep(5);}
}`);
  return new Promise(resolve=>{const child=spawn(process.execPath,[script,root,String(start),String(pause),String(hold)],{stdio:'ignore',windowsHide:true});child.on('exit',resolve);});
}
function holders(root){
  let depth=0,most=0,entered=0;const errors=[];
  for(const line of fs.readFileSync(path.join(root,'holders.log'),'utf8').split('\n')){if(line.startsWith('in ')){entered++;most=Math.max(most,++depth);}if(line.startsWith('out '))depth--;if(line.startsWith('err'))errors.push(line);}
  return {most,entered,errors};
}
const deadLock=root=>{fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});fs.writeFileSync(path.join(root,'.godspeed','workspace.lock'),JSON.stringify({pid:deadPid(),at:new Date().toISOString()}));};

test('two programs that find the same dead writer take its lock one after the other',async()=>{
  const root=temp();deadLock(root);
  // The second reads the dead lock, then stops long enough for the first to take it over.
  const start=Date.now()+1500;await Promise.all([writer(root,start,0,900),writer(root,start-100,600)]);
  const seen=holders(root);
  assert.deepEqual(seen.errors,[],'a race while taking over reads as busy, never as an error');
  assert.equal(seen.entered,2);assert.equal(seen.most,1,'two programs held the lock at once');
});

test('six programs racing for one dead lock never write at the same time',async()=>{
  for(let round=0;round<4;round++){
    const root=temp();deadLock(root);
    const start=Date.now()+1500;await Promise.all(Array.from({length:6},()=>writer(root,start)));
    const seen=holders(root);
    assert.deepEqual(seen.errors,[]);assert.equal(seen.entered,6);assert.equal(seen.most,1,'round '+round+': two programs held the lock at once');
  }
});

test('a lock written before this computer started is stale, whoever has its number now',async()=>{
  const store=new Store(temp()),other=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{windowsHide:true});
  try{
    await new Promise(resolve=>other.once('spawn',resolve));
    fs.writeFileSync(path.join(store.state,'workspace.lock'),JSON.stringify({pid:other.pid,at:'2001-01-01T00:00:00.000Z'}));
    const started=Date.now(),saved=await store.saveAsync('notes',{title:'Typed after a restart'},undefined,{timeoutMs:5000});
    assert.ok(Date.now()-started<3000);assert.equal(store.get('notes',saved.id).title,'Typed after a restart');
  }finally{other.kill();}
});

test('this program\'s own number on a lock it does not hold is a restarted container\'s or a lost release',()=>{
  const store=new Store(temp()),lock=path.join(store.state,'workspace.lock');
  const beforeStart=new Date(Date.now()-process.uptime()*1000-5000).toISOString();
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token:'from-the-container-before',at:beforeStart}));
  assert.equal(store.withLock(()=>'written'),'written');assert.equal(fs.existsSync(lock),false);
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid,thread:0,token:'a-release-that-failed',at:new Date().toISOString()}));
  assert.equal(store.withLock(()=>'written'),'written');
  // A lock this program's number wrote since it started, without a token, is another part of this program: busy.
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
  assert.throws(()=>store.withLock(()=>1),{code:'WRITER_BUSY'});fs.unlinkSync(lock);
});

test('an empty lock left for longer than ten seconds is a writer that died, and the workspace opens',async()=>{
  const root=temp();new Store(root);const lock=path.join(root,'.godspeed','workspace.lock');
  fs.writeFileSync(lock,'');const old=new Date(Date.now()-60000);fs.utimesSync(lock,old,old);
  const store=new Store(root);store.save('notes',{title:'Opens again'});
  fs.writeFileSync(lock,'');fs.utimesSync(lock,old,old);
  assert.equal(await store.withLockAsync(()=>'written',{timeoutMs:2000}),'written');
});

test('a lock is only ever removed by the writer that took it',()=>{
  const store=new Store(temp()),lock=path.join(store.state,'workspace.lock');
  store.withLock(()=>{fs.unlinkSync(lock);fs.writeFileSync(lock,JSON.stringify({pid:process.pid,thread:99,token:'someone-else',at:new Date().toISOString()}));});
  assert.equal(JSON.parse(fs.readFileSync(lock,'utf8')).token,'someone-else','releasing left the other writer\'s lock alone');
  fs.unlinkSync(lock);
});
