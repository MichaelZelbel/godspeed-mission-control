import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {pathToFileURL} from 'node:url';
import {createService} from '../server/main.mjs';
import {startUpdate,readStatus,updateOverview,writeStatus} from '../core/update.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// Settings, About's update block (#456): GET /api/update says what is installed, what is newest and
// how this installation is updated; POST /api/update is the Update now button. On a Docker server the
// notebook only says which line to run on the server: nothing in the container starts a program there.
const temporary=name=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-settings-update-'+name+'-'));
function computer(version){
  const root=temporary('root'),commit='a'.repeat(40),runtime=path.join(root,'.godspeed','integrated-runtime');
  fs.mkdirSync(path.join(runtime,'versions',commit,'notebook'),{recursive:true});
  fs.writeFileSync(path.join(runtime,'version'),commit);
  fs.writeFileSync(path.join(runtime,'versions',commit,'notebook','package.json'),JSON.stringify({version}));
  return root;
}
// A release stood in on this machine: GitHub's Latest, and the stage files at its tag and at beta.
async function standIn(t,version='2.0.0-beta.30'){
  const server=http.createServer((req,res)=>{
    if(req.url==='/releases/latest'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({tag_name:'stand-in',draft:false,prerelease:false}));}
    res.statusCode=404;res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const raw=temporary('raw');
  for(const [ref,v] of [['stand-in',version],['beta','2.0.0-beta.20']]){fs.mkdirSync(path.join(raw,ref));fs.writeFileSync(path.join(raw,ref,'stage.json'),JSON.stringify({version:v,withdrawn:[]}));}
  return {GODSPEED_SCENARIO_RELEASES_URL:'http://127.0.0.1:'+server.address().port,GODSPEED_STAGE_RAW:pathToFileURL(raw).href};
}
const withEnv=(t,values)=>{Object.assign(process.env,values);t.after(()=>{for(const key of Object.keys(values))delete process.env[key];});};

test('on a Docker server Settings shows the newest version and the line to run on the server, and the button refuses',async t=>{
  withEnv(t,{...await standIn(t),GODSPEED_REVISION:'c'.repeat(40)});
  const root=temporary('docker'),service=await createService({root,port:0,device:'vps'});t.after(()=>service.close());
  const base='http://127.0.0.1:'+service.address.port;
  const shown=await (await fetch(base+'/api/update')).json();
  assert.equal(shown.way,'server');assert.equal(shown.command,'sudo godspeed-update');
  assert.equal(shown.newest.version,'2.0.0-beta.30');assert.equal(shown.newer,true);assert.equal(shown.error,null);
  const refused=await fetch(base+'/api/update',{method:'POST'});
  assert.equal(refused.status,409);
  assert.match((await refused.json()).error,/sudo godspeed-update/);
  assert.ok(!fs.existsSync(path.join(root,'.godspeed','update')),'nothing was started or written');
  // Updating automatically (#458) is not offered there, and Settings says why in one line.
  assert.equal(shown.automatic.offered,false);assert.match(shown.automatic.reason,/Docker server/);
  const automatic=await fetch(base+'/api/update/automatic',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({choice:'automatic'})});
  assert.equal(automatic.status,409);assert.match((await automatic.json()).error,/Docker server/);
  assert.equal((await (await fetch(base+'/api/update/automatic')).json()).choice,'myself');
});

test('an installation that never chose reads Update myself',async t=>{
  withEnv(t,{GODSPEED_SCENARIO_RELEASES_URL:'http://127.0.0.1:9'});
  const root=computer('2.0.0-beta.20'),service=await createService({root,port:0});t.after(()=>service.close());
  const shown=await (await fetch('http://127.0.0.1:'+service.address.port+'/api/update')).json();
  assert.equal(shown.automatic.choice,'myself');assert.equal(shown.automatic.time,'04:00');assert.equal(shown.automatic.paused,null);
});

test('a GitHub that cannot be reached is said in a plain sentence',async t=>{
  withEnv(t,{GODSPEED_SCENARIO_RELEASES_URL:'http://127.0.0.1:9'});
  const root=computer('2.0.0-beta.20');
  const shown=await updateOverview({root,refresh:true});
  assert.equal(shown.newest,null);assert.equal(shown.newer,false);
  assert.equal(shown.error,'GitHub could not be reached to see whether a newer version exists.');
  assert.equal(shown.way,'terminal');assert.equal(shown.command,'godspeed-update');
});

test('Update now starts the same command apart from the notebook, and only when a newer version exists',async t=>{
  const env={...await standIn(t),GODSPEED_HANDOVER:'1'},started=[];
  const spawnImpl=(command,args,options)=>{started.push({command,args,options});return {unref(){},on(){}};};
  const current=computer('2.0.0-beta.30');
  assert.deepEqual(await startUpdate({root:current,env,spawnImpl}),{code:200,started:false,message:'You have the newest version, 2.0.0-beta.30. Nothing was changed.'});
  assert.equal(started.length,0);assert.equal(readStatus(current),null);
  const root=computer('2.0.0-beta.20'),answer=await startUpdate({root,env,spawnImpl});
  assert.equal(answer.code,202);
  assert.deepEqual(started.map(s=>[s.command,s.args.slice(1),s.options.detached,s.options.env.GODSPEED_WORKSPACE]),[[process.execPath,['update','--from-settings'],true,root]]);
  assert.match(started[0].args[0],/notebook[\\/]bin[\\/]godspeed\.mjs$/);
  assert.equal(readStatus(root).state,'checking');
  // A second press before the command it started has taken its lock starts no second one.
  assert.deepEqual(await startUpdate({root,env,spawnImpl}),{code:409,error:'An update is already running.'});
  assert.equal(started.length,1);
  assert.equal((await startUpdate({root,env:{...env,GODSPEED_HANDOVER:''},spawnImpl})).code,409,'a notebook its start.mjs cannot hand over is updated from a terminal');
});

test('an update nothing carries on any more is shown as how it ended',async()=>{
  const root=computer('2.0.0-beta.30'),later=new Date(Date.now()+60*60*1000);
  writeStatus(root,{state:'switching',from:'2.0.0-beta.20',to:'2.0.0-beta.30',message:'Restarting.'});
  assert.equal((await updateOverview({root,env:{GODSPEED_SCENARIO_RELEASES_URL:'http://127.0.0.1:9'}})).status.state,'updated','the new version runs');
  const stuck=computer('2.0.0-beta.20');
  writeStatus(stuck,{state:'downloading',from:'2.0.0-beta.20',to:'2.0.0-beta.30',message:'Downloading.'});
  assert.equal((await updateOverview({root:stuck,env:{GODSPEED_SCENARIO_RELEASES_URL:'http://127.0.0.1:9'}})).status.state,'downloading','still within its time');
  const ended=(await updateOverview({root:stuck,env:{GODSPEED_SCENARIO_RELEASES_URL:'http://127.0.0.1:9'},now:()=>later})).status;
  assert.equal(ended.state,'failed');assert.equal(ended.message,'The update to 2.0.0-beta.30 did not finish. The version you have is still running.');
});
