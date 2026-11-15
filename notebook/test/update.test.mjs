import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
import {compareVersions,findNewest,installedVersion,updateWay,runUpdate,releaseSources,readStatus,settle,ARCHIVE,WINDOWS_SETUP,WINDOWS_FLAGS} from '../core/update.mjs';
import {VERSION} from '../core/version.mjs';

// godspeed-update and Settings' Update now (#456): which release is newest, whether it is newer,
// and a download refused unless its SHA256 is the one its release publishes.
const API='https://api.github.com/repos/MichaelZelbel/godspeed-mission-control';
const DOWNLOAD='https://github.com/MichaelZelbel/godspeed-mission-control/releases/download';
const RAW='https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control';
const temporary=name=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-update-'+name+'-'));
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const stage=(version,withdrawn=[])=>JSON.stringify({stageFormat:1,version,withdrawn});

// A GitHub that answers from a table; every address asked is kept.
function github(table){
  const asked=[];
  const fetchImpl=async address=>{asked.push(address);const body=table[address];return body===undefined?new Response('',{status:404}):new Response(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
  return {fetchImpl,asked};
}
function release({tag='candidate/2.0.0-beta.30',version='2.0.0-beta.30',archive=Buffer.from('the archive'),sums,extra={}}={}){
  return {
    [API+'/releases/latest']:{tag_name:tag,draft:false,prerelease:false},
    [RAW+'/'+tag+'/stage.json']:stage(version),
    [RAW+'/beta/stage.json']:stage('2.0.0-beta.20'),
    [DOWNLOAD+'/'+tag+'/SHA256SUMS']:sums??sha(archive)+'  '+ARCHIVE+'\n'+sha('setup')+'  '+WINDOWS_SETUP+'\n',
    [DOWNLOAD+'/'+tag+'/'+ARCHIVE]:archive,
    [DOWNLOAD+'/'+tag+'/'+WINDOWS_SETUP]:'setup',
    ...extra,
  };
}
// A Linux or Mac mission control the installer put in place, running version `version`.
function computer(version){
  const root=temporary('root'),commit='a'.repeat(40),runtime=path.join(root,'.godspeed','integrated-runtime');
  fs.mkdirSync(path.join(runtime,'versions',commit,'notebook'),{recursive:true});
  fs.writeFileSync(path.join(runtime,'version'),commit+'\n');
  fs.writeFileSync(path.join(runtime,'versions',commit,'notebook','package.json'),JSON.stringify({version}));
  return root;
}
const spy=(answer=()=>0)=>{const calls=[];const run=async(command,args,options)=>{calls.push({command,args,options});return answer(command,args,options);};return {run,calls};};
const silent={log:()=>{},product:temporary('checkout')};

test('versions are ordered the way semantic versioning orders them',()=>{
  const order=['2.0.0-alpha.1','2.0.0-beta.9','2.0.0-beta.10','2.0.0-beta.20','2.0.0-beta.20.commit.abc1234','2.0.0-rc.1','2.0.0','2.0.1','2.1.0','10.0.0'];
  for(let i=0;i<order.length;i++)for(let j=0;j<order.length;j++)assert.equal(compareVersions(order[i],order[j]),Math.sign(i-j),order[i]+' against '+order[j]);
  assert.equal(compareVersions('2.0.0-beta.20+build.5','2.0.0-beta.20'),0);
  for(const bad of ['','2.0','v2.0.0','2.0.0-','2.0.0-beta..1',null])assert.throws(()=>compareVersions(bad,'2.0.0'),/is not a version number Godspeed can compare/);
});

test('stable is the release GitHub marks Latest, at the version its stage file names',async()=>{
  const {fetchImpl,asked}=github(release());
  assert.deepEqual(await findNewest({fetchImpl,env:{}}),{tag:'candidate/2.0.0-beta.30',version:'2.0.0-beta.30',notes:'https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/candidate/2.0.0-beta.30'});
  assert.ok(!asked.some(address=>address.includes('per_page')),'stable never reads the list of all releases');
});

test('testing is chosen only by name: the highest published candidate, never a draft or another tag',async()=>{
  const list=[
    {tag_name:'candidate/2.0.0-beta.40',draft:true},
    {tag_name:'godspeed-v2-integrated-2026-11-01',draft:false},
    {tag_name:'candidate/2.0.0-beta.9',draft:false,prerelease:true},
    {tag_name:'candidate/2.0.0-beta.31',draft:false},
    {tag_name:'candidate/2.0.0-beta.30',draft:false},
  ];
  const {fetchImpl}=github({...release(),[API+'/releases?per_page=30']:list,[RAW+'/candidate/2.0.0-beta.31/stage.json']:stage('2.0.0-beta.31')});
  assert.equal((await findNewest({channel:'testing',fetchImpl,env:{}})).version,'2.0.0-beta.31');
  assert.equal((await findNewest({fetchImpl,env:{}})).version,'2.0.0-beta.30','stable stays the Latest release');
  await assert.rejects(findNewest({channel:'nightly',fetchImpl,env:{}}),/Choose the channel stable or testing/);
});

test('a release whose stage names another version, or one taken back, is refused',async()=>{
  let {fetchImpl}=github({...release(),[RAW+'/candidate/2.0.0-beta.30/stage.json']:stage('2.0.0-beta.29')});
  await assert.rejects(findNewest({fetchImpl,env:{}}),/The release candidate\/2.0.0-beta.30 says it is 2.0.0-beta.29, so it is not installed/);
  ({fetchImpl}=github({...release(),[RAW+'/beta/stage.json']:stage('2.0.0-beta.20',['2.0.0-beta.30'])}));
  await assert.rejects(findNewest({fetchImpl,env:{}}),/2.0.0-beta.30 was taken back/);
  ({fetchImpl}=github({}));
  await assert.rejects(findNewest({fetchImpl,env:{}}),/GitHub could not be reached to see whether a newer version exists/);
});

test('only a release stood in on this machine replaces GitHub',()=>{
  assert.deepEqual(releaseSources({GODSPEED_SCENARIO_RELEASES_URL:'http://127.0.0.1:8123/'}),{api:'http://127.0.0.1:8123',download:'http://127.0.0.1:8123/download'});
  for(const elsewhere of ['http://example.com:8123','https://127.0.0.1:8123','http://127.0.0.1.example.com:1'])assert.equal(releaseSources({GODSPEED_SCENARIO_RELEASES_URL:elsewhere}).api,API);
});

test('the installed version is the one the installer switched in, not the copy that asks',()=>{
  assert.equal(installedVersion({root:computer('2.0.0-beta.12')}),'2.0.0-beta.12');
  assert.equal(installedVersion({root:temporary('plain')}),VERSION);
});

test('--check and nothing newer say so and change nothing',async()=>{
  for(const installed of ['2.0.0-beta.30','2.0.0-beta.31']){
    const root=computer(installed),{fetchImpl}=github(release()),{run,calls}=spy(),said=[];
    const outcome=await runUpdate({...silent,root,fetchImpl,run,env:{},log:line=>said.push(line)});
    assert.equal(outcome.state,'current');
    assert.deepEqual(said,['You have the newest version, '+installed+'. Nothing was changed.']);
    assert.equal(calls.length,0,'nothing is run');
    assert.deepEqual(fs.readdirSync(path.join(root,'.godspeed')),['integrated-runtime'],'no file is made');
  }
  const root=computer('2.0.0-beta.20'),{fetchImpl,asked}=github(release()),{run,calls}=spy(),said=[];
  const outcome=await runUpdate({...silent,root,check:true,fetchImpl,run,env:{},log:line=>said.push(line)});
  assert.equal(outcome.newer,true);
  assert.deepEqual(said,['Installed: 2.0.0-beta.20','Newest stable: 2.0.0-beta.30','What changed: https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/candidate/2.0.0-beta.30','A newer version is ready. To install it, run: godspeed-update']);
  assert.equal(calls.length,0);
  assert.ok(!asked.some(address=>address.startsWith(DOWNLOAD)),'--check downloads nothing');
  assert.deepEqual(fs.readdirSync(path.join(root,'.godspeed')),['integrated-runtime']);
});

test('a download whose checksum is wrong or not published is refused before anything runs',async()=>{
  const cases={
    'a different hash':release({sums:sha('something else')+'  '+ARCHIVE+'\n'}),
    'no line for the file':release({sums:sha('the archive')+'  '+ARCHIVE+'.old\n'}),
    'no SHA256SUMS':{...release(),[DOWNLOAD+'/candidate/2.0.0-beta.30/SHA256SUMS']:undefined},
  };
  for(const [name,table] of Object.entries(cases)){
    const root=computer('2.0.0-beta.20'),{fetchImpl}=github(table),{run,calls}=spy();
    await assert.rejects(runUpdate({...silent,root,fetchImpl,run,env:{}}),{message:'The download of 2.0.0-beta.30 does not match the checksum its release publishes, so nothing was installed. The version you have keeps running.'},name);
    assert.equal(calls.length,0,name+': nothing ran');
    assert.ok(!fs.existsSync(path.join(root,'.godspeed','update','download',ARCHIVE)),name+': the download is gone');
    assert.equal(readStatus(root).state,'failed',name);
    assert.ok(!fs.existsSync(path.join(root,'.godspeed','update','lock')),name+': the lock is given back');
  }
});

test('a terminal update runs install-godspeed.sh out of the checked archive, at the release\'s tag',async()=>{
  const root=computer('2.0.0-beta.20'),{fetchImpl}=github(release()),{run,calls}=spy(),said=[];
  const env={PATH:'/usr/bin',GODSPEED_WORKSPACE:root,GODSPEED_PORT:'47831',HERMES_HOME:'/elsewhere',GODSPEED_STAGE_RAW:RAW};
  const outcome=await runUpdate({...silent,root,fetchImpl,run,env,platform:'linux',log:line=>said.push(line)});
  assert.equal(outcome.state,'updated');
  const folder=path.join(root,'.godspeed','update','download');
  assert.deepEqual(calls.map(call=>[call.command,call.args]),[
    ['tar',['-xzf',path.join(folder,ARCHIVE),'-C',folder,'godspeed-mission-control/install-godspeed.sh']],
    ['bash',[path.join(folder,'godspeed-mission-control/install-godspeed.sh'),'--godspeed',root]],
  ]);
  assert.deepEqual(calls[1].options.env,{PATH:'/usr/bin',GODSPEED_STAGE_RAW:RAW,GODSPEED_STAGE_REF:'candidate/2.0.0-beta.30'},'the installation\'s own settings come from start.mjs, not from whoever ran the command');
  assert.match(said.join('\n'),/matched the checksum its release publishes/);
  assert.equal(readStatus(root).state,'updated');assert.equal(readStatus(root).to,'2.0.0-beta.30');
  assert.ok(!fs.existsSync(folder),'the download is removed afterwards');
});

test('an installer that fails leaves the update failed, in plain words',async()=>{
  const root=computer('2.0.0-beta.20'),{fetchImpl}=github(release()),{run}=spy(command=>command==='bash'?1:0);
  await assert.rejects(runUpdate({...silent,root,fetchImpl,run,env:{}}),/The update to 2.0.0-beta.30 stopped before it was finished. The version you have keeps running./);
  assert.equal(readStatus(root).state,'failed');
});

test('inside the notebook\'s service the update is prepared and handed to start.mjs',{skip:process.platform==='win32'&&'signals are POSIX'},async()=>{
  const root=computer('2.0.0-beta.20'),{fetchImpl}=github(release()),update=path.join(root,'.godspeed','update');
  const {run,calls}=spy(command=>{if(command==='bash')fs.writeFileSync(path.join(update,'switch.json'),'{}');return 0;});
  // start.mjs stands in: it ends with code 75 when it is asked to take the new version over.
  const start=spawn(process.execPath,['-e',"process.on('SIGUSR2',()=>process.exit(75));console.log('up');setInterval(()=>{},1000);"],{stdio:['ignore','pipe','inherit']});
  await new Promise(resolve=>start.stdout.once('data',resolve));
  const ended=new Promise(resolve=>start.on('exit',resolve));
  fs.mkdirSync(update,{recursive:true});fs.writeFileSync(path.join(update,'start.pid'),String(start.pid));
  const outcome=await runUpdate({...silent,root,fetchImpl,run,env:{GODSPEED_HANDOVER:'1'},platform:'linux'});
  assert.equal(await ended,75,'start.mjs was asked to switch');
  assert.equal(outcome.state,'started');
  assert.equal(calls[1].options.env.GODSPEED_UPDATE_MODE,'prepare');
  assert.equal(readStatus(root).state,'switching');
});

test('Windows runs the checked setup without questions; from Settings it outlives the notebook',async()=>{
  const windows=temporary('windows'),kit=path.join(windows,'payload','kit');fs.mkdirSync(kit,{recursive:true});
  fs.writeFileSync(path.join(windows,'payload','candidate-manifest.json'),JSON.stringify({kitCommit:'b'.repeat(40)}));
  for(const fromSettings of [false,true]){
    const root=temporary('pc'),{fetchImpl}=github(release()),{run,calls}=spy();
    const outcome=await runUpdate({...silent,product:kit,root,fetchImpl,run,env:{},fromSettings,platform:'win32'});
    assert.equal(outcome.state,fromSettings?'started':'updated');
    assert.deepEqual(calls.map(call=>[path.basename(call.command),call.args,!!call.options.detached]),[[WINDOWS_SETUP,WINDOWS_FLAGS,fromSettings]]);
  }
});

test('a Docker server is updated on the server, and a copy no installer made not at all',async()=>{
  const {fetchImpl}=github(release()),{run,calls}=spy();
  await assert.rejects(runUpdate({...silent,root:temporary('docker'),fetchImpl,run,env:{GODSPEED_REVISION:'c'.repeat(40)}}),/run sudo godspeed-update there/);
  await assert.rejects(runUpdate({...silent,root:temporary('checkout'),fetchImpl,run,env:{}}),/No installer put this copy of Godspeed here/);
  assert.equal(calls.length,0);
  const root=computer('2.0.0-beta.20');
  assert.equal(updateWay({root,env:{},product:silent.product}),'terminal');
  assert.equal(updateWay({root,env:{GODSPEED_HANDOVER:'1'},product:silent.product}),'handover');
});

test('settling an update start.mjs took over keeps the new stage files, this version and the one before',async()=>{
  const root=computer('2.0.0-beta.30'),state=path.join(root,'.godspeed','integrated-runtime'),update=path.join(root,'.godspeed','update');
  for(const old of ['b'.repeat(40),'c'.repeat(40)])fs.mkdirSync(path.join(state,'versions',old),{recursive:true});
  fs.writeFileSync(path.join(state,'previous-version'),'b'.repeat(40)+'\n');
  fs.mkdirSync(update,{recursive:true});fs.writeFileSync(path.join(update,'stage.json'),'{"version":"2.0.0-beta.30"}');fs.writeFileSync(path.join(update,'stage-ref'),'candidate/2.0.0-beta.30\n');
  const settled=await settle({root});
  assert.equal(settled.state,'updated');assert.equal(settled.to,'2.0.0-beta.30');
  assert.deepEqual(fs.readdirSync(path.join(state,'versions')).sort(),['a'.repeat(40),'b'.repeat(40)]);
  assert.equal(fs.readFileSync(path.join(root,'.godspeed','stage-ref'),'utf8'),'candidate/2.0.0-beta.30\n');
  assert.ok(!fs.existsSync(path.join(update,'stage.json')));
});
