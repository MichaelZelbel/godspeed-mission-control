import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';

// The Linux and Mac installer's own parts, run in bash without installing anything:
// GODSPEED_INSTALLER_FUNCTIONS_ONLY=1 loads its functions and stops. On Windows it runs
// only when GODSPEED_TEST_BASH names a bash (Git Bash), since `bash` there may be WSL's.
const installer=fileURLToPath(new URL('../scripts/install-native-notebook.sh',import.meta.url)).replaceAll('\\','/');
const bash=process.env.GODSPEED_TEST_BASH||'bash';
const options={skip:process.platform==='win32'&&!process.env.GODSPEED_TEST_BASH&&'set GODSPEED_TEST_BASH to a bash'};
const slash=p=>p.replaceAll('\\','/');
// FAKE_BIN goes in front of PATH inside bash, where PATH is bash's own form.
function sh(script,env={}){
  const prefix='if [ -n "${FAKE_BIN:-}" ]; then PATH="$(cygpath -u "$FAKE_BIN" 2>/dev/null || printf %s "$FAKE_BIN"):$PATH"; fi; ';
  const result=spawnSync(bash,['-c','set -euo pipefail; GODSPEED_INSTALLER_FUNCTIONS_ONLY=1; . "$1"; '+prefix+script,'test',installer],{encoding:'utf8',env:{...process.env,...env}});
  return {status:result.status,out:result.stdout,err:result.stderr};
}
const scratch=name=>slash(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-native-'+name+'-')));

test('the installer is valid bash',options,()=>{
  const result=spawnSync(bash,['-n',installer],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('the unit names the account, the folder and the commands exactly as systemd reads them',options,()=>{
  const env={root:'/srv/my 100% folder',state:'/srv/my 100% folder/.godspeed/integrated-runtime',node:'/opt/god$peed "x"/bin/node',service_user:'anna',service_group:'staff',HOME:'/home/anna',UNIT_PATH:'/opt/node/bin:/usr/bin'};
  const system=sh('PATH=$UNIT_PATH unit_text system',env);
  assert.equal(system.status,0,system.err);
  const lines=system.out.split('\n');
  for(const line of ['User=anna','Group=staff','Environment="HOME=/home/anna"','Environment="PATH=/opt/node/bin:/usr/bin"','WorkingDirectory=/srv/my 100%% folder',
    'ExecStart="/opt/god$$peed \\"x\\"/bin/node" "/srv/my 100%% folder/.godspeed/integrated-runtime/start.mjs"','Restart=on-failure','WantedBy=multi-user.target'])
    assert.ok(lines.includes(line),line+'\n'+system.out);
  const user=sh('PATH=$UNIT_PATH unit_text user',env).out;
  assert.doesNotMatch(user,/^User=/m,'a user service runs as its own account');
  assert.match(user,/^WantedBy=default\.target$/m);
});

test('the Node.js check takes 22.19 and newer within 22 only',options,()=>{
  const dir=scratch('node');
  for(const [version,fits] of [['v22.19.0',true],['v22.21.1',true],['v22.18.0',false],['v18.19.1',false],['v23.1.0',false],['v24.0.0',false]]){
    fs.writeFileSync(path.join(dir,'node'),'#!/bin/sh\necho '+version+'\n',{mode:0o755});
    assert.equal(sh('node_fits "$NODE"',{NODE:dir+'/node'}).status===0,fits,version);
  }
});

// A stand-in nodejs.org: curl copies from a folder, uname says Linux on x64.
function fakeDist({tamper=false}={}){
  const dir=scratch('dist'),bin=dir+'/bin',dist=dir+'/dist',name='node-v22.19.0-linux-x64';
  fs.mkdirSync(bin);fs.mkdirSync(dist+'/'+name+'/bin',{recursive:true});
  fs.writeFileSync(dist+'/'+name+'/bin/node','#!/bin/sh\necho v22.19.0\n',{mode:0o755});
  fs.writeFileSync(bin+'/uname','#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac\n',{mode:0o755});
  fs.writeFileSync(bin+'/curl',['#!/bin/sh','[ -z "$FAKE_OFFLINE" ] || exit 7','out=; url=; prev=',
    'for a; do [ "$prev" != -o ] || out=$a; case "$a" in https://*) url=$a ;; esac; prev=$a; done',
    'echo "$url" >> "$FAKE_CALLS"','cp "$FAKE_DIST/${url##*/}" "$out"',''].join('\n'),{mode:0o755});
  const made=spawnSync(bash,['-c','cd "$1" && tar -czf "'+name+'.tar.gz" "'+name+'" && sum=$(sha256sum "'+name+'.tar.gz" | cut -d" " -f1) && printf "%s  %s\\n" "'+(tamper?'0'.repeat(64):'$sum')+'" "'+name+'.tar.gz" > SHASUMS256.txt','x',dist],{encoding:'utf8'});
  assert.equal(made.status,0,made.stderr);
  return {bin,dist,calls:dir+'/calls'};
}

test('the notebook\'s own Node.js is downloaded once, checked against the published checksum',options,()=>{
  const f=fakeDist(),state=scratch('state'),env={state,FAKE_BIN:f.bin,FAKE_DIST:f.dist,FAKE_CALLS:f.calls};
  const first=sh('install_node',env);
  assert.equal(first.status,0,first.err);
  assert.equal(first.out,state+'/runtime/node-v22.19.0-linux-x64/bin/node');
  assert.equal(fs.readFileSync(f.calls,'utf8').trim().split('\n').length,2,'the checksum list and the archive');
  const again=sh('install_node',{...env,FAKE_OFFLINE:'1'});
  assert.equal(again.status,0,'an installed one is used without the network: '+again.err);
  assert.equal(again.out,first.out);
});

test('a Node.js download that does not match its checksum is never used',options,()=>{
  const f=fakeDist({tamper:true}),state=scratch('state');
  const result=sh('install_node',{state,FAKE_BIN:f.bin,FAKE_DIST:f.dist,FAKE_CALLS:f.calls});
  assert.notEqual(result.status,0);
  assert.match(result.err,/did not match its published checksum/);
  assert.equal(fs.existsSync(state+'/runtime/node-v22.19.0-linux-x64'),false);
});

function repository(){
  const dir=scratch('repo'),git=(...args)=>{const r=spawnSync('git',['-C',dir,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','Test');git('config','core.autocrlf','false');
  fs.mkdirSync(dir+'/installers');fs.mkdirSync(dir+'/notebook/bin',{recursive:true});
  fs.writeFileSync(dir+'/installers/GodspeedSetup.exe',Buffer.alloc(300000,7));fs.writeFileSync(dir+'/notebook/bin/godspeed.mjs','// v1\n');
  git('add','-A');git('commit','-qm','one');const first=git('rev-parse','HEAD');
  fs.writeFileSync(dir+'/notebook/bin/godspeed.mjs','// v2\n');git('commit','-qam','two');
  // What GitHub allows: a commit fetched by its name, contents left out until needed.
  git('config','uploadpack.allowAnySHA1InWant','true');git('config','uploadpack.allowFilter','true');
  return {url:'file://'+(dir.startsWith('/')?'':'/')+dir,first,head:git('rev-parse','HEAD')};
}

test('the named commit is fetched shallow, without the installers, into a folder of its own',options,()=>{
  const repo=repository(),state=scratch('state');
  const result=sh('fetch_version',{state,repository:repo.url,revision:repo.first});
  assert.equal(result.status,0,result.err);
  assert.equal(result.out,state+'/versions/'+repo.first);
  const text=file=>fs.readFileSync(file,'utf8').replaceAll('\r','');   // a Windows Git may check out CRLF
  assert.equal(text(result.out+'/notebook/bin/godspeed.mjs'),'// v1\n','the named commit, not the newest');
  assert.equal(fs.existsSync(result.out+'/installers'),false);
  assert.equal(spawnSync('git',['-C',result.out,'rev-list','--count','HEAD'],{encoding:'utf8'}).stdout.trim(),'1','one commit, no history');
  const again=sh('fetch_version',{state,repository:'file:///nowhere',revision:repo.first});
  assert.equal(again.out,result.out,'a version already here is not fetched again: '+again.err);
  const next=sh('fetch_version',{state,repository:repo.url,revision:repo.head});
  assert.equal(next.out,state+'/versions/'+repo.head);
  assert.equal(text(result.out+'/notebook/bin/godspeed.mjs'),'// v1\n','the version that was running is left as it was');
});

test('a commit that cannot be fetched leaves nothing behind',options,()=>{
  const repo=repository(),state=scratch('state');
  const result=sh('fetch_version',{state,repository:repo.url,revision:'0123456789abcdef0123456789abcdef01234567'});
  assert.notEqual(result.status,0);
  assert.deepEqual(fs.readdirSync(state+'/versions'),[]);
});

test('without a pinned version the installer stops before it changes anything',options,()=>{
  const root=scratch('root');fs.writeFileSync(root+'/AGENTS.md','x');fs.mkdirSync(root+'/rules');
  const result=spawnSync(bash,[installer,root],{encoding:'utf8',env:{...process.env,GODSPEED_PRODUCT_REF:'',GODSPEED_ALLOW_MOVING_REF:''}});
  assert.equal(result.status,1);
  assert.match(result.stderr,/Run the published installer/);
});

test('a re-run keeps the machine name and settings the last installation ran with',options,()=>{
  const state=scratch('rerun'),node=slash(process.execPath);
  // start.mjs exactly as the installer before 6 October 2026 wrote it.
  const env={GODSPEED_WORKSPACE:'/root/godspeed',GODSPEED_ORIGINAL_RUNTIME:'on',GODSPEED_PORT:'47900',GODSPEED_BIND:'127.0.0.1',HERMES_HOME:state+'/hermes',GODSPEED_DEVICE:'production',GODSPEED_MEDIA_ROOT:'/srv/media "x"'};
  fs.writeFileSync(path.join(state,'start.mjs'),`import {spawn} from 'node:child_process';const p=spawn("/usr/bin/node",["${state}/source/notebook/scripts/supervise.mjs"],{stdio:'inherit',env:{...process.env,...${JSON.stringify(env)}}});`);
  const read=sh('for n in GODSPEED_DEVICE GODSPEED_PORT GODSPEED_MEDIA_ROOT HERMES_HOME GODSPEED_MISSING; do printf "%s=[%s]\n" "$n" "$(previous_setting "$n")"; done',{state,node});
  assert.equal(read.status,0,read.err);
  assert.equal(read.out,`GODSPEED_DEVICE=[production]\nGODSPEED_PORT=[47900]\nGODSPEED_MEDIA_ROOT=[/srv/media "x"]\nHERMES_HOME=[${state}/hermes]\nGODSPEED_MISSING=[]\n`);
  assert.equal(sh('previous_setting GODSPEED_DEVICE',{state:scratch('fresh'),node}).out,'','a first installation has nothing to keep');
});
