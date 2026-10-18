import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';import http from 'node:http';import {createHash} from 'node:crypto';

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

// systemd is Linux's alone, and a Mac's /bin/bash 3.2 quotes the unit's values differently.
test('the unit names the account, the folder and the commands exactly as systemd reads them',{skip:options.skip||(process.platform==='darwin'&&'systemd units are Linux only')},()=>{
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
  const made=spawnSync(bash,['-c','cd "$1" && tar -czf "'+name+'.tar.gz" "'+name+'" && sum=$({ sha256sum "'+name+'.tar.gz" 2>/dev/null || shasum -a 256 "'+name+'.tar.gz"; } | cut -d" " -f1) && printf "%s  %s\\n" "'+(tamper?'0'.repeat(64):'$sum')+'" "'+name+'.tar.gz" > SHASUMS256.txt','x',dist],{encoding:'utf8'});
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

// The copies made before updates (core/upgrade-copies.mjs): until 15 October 2026 every update
// added one and none was removed. The installer's own step, with this checkout as the new version.
const product=slash(fileURLToPath(new URL('../..',import.meta.url))).replace(/\/$/,'');
function updateCopies(){
  const state=scratch('copies'),backups=state+'/backups';
  const copy=name=>{fs.mkdirSync(backups+'/'+name,{recursive:true});fs.writeFileSync(backups+'/'+name+'/backup.json','{"format":1,"files":[]}');return name;};
  const older=[1,2,3,4,5].map(day=>copy(`2026100${day}-120000-${String(day).repeat(40)}`));
  fs.mkdirSync(backups+'/my own folder');
  const made=copy('20261015-120000-'+'a'.repeat(40));
  return {state,backups,older,made};
}

test('after an update that worked, the newest three copies made before updates stay and older ones go',options,()=>{
  const {state,backups,older,made}=updateCopies();
  const result=sh('prune_update_copies',{state,version:product,node:slash(process.execPath),backup_dir:backups+'/'+made});
  assert.equal(result.status,0,result.err);
  assert.equal(result.err,'','nothing to report when it worked');
  assert.deepEqual(fs.readdirSync(backups).sort(),[older[3],older[4],made,'my own folder'].sort());
});

test('an installation that made no copy before it (a first one) removes none',options,()=>{
  const {state,backups}=updateCopies(),before=fs.readdirSync(backups).sort();
  const result=sh('prune_update_copies',{state,version:product,node:slash(process.execPath),backup_dir:''});
  assert.equal(result.status,0,result.err);
  assert.deepEqual(fs.readdirSync(backups).sort(),before);
});

test('a copy that cannot be removed is said once and never fails the update that worked',options,()=>{
  const {state,backups,made}=updateCopies(),before=fs.readdirSync(backups).sort();
  // A new version without the step (an older one named by mistake): the command fails.
  const result=sh('prune_update_copies',{state,version:scratch('no-product'),node:slash(process.execPath),backup_dir:backups+'/'+made});
  assert.equal(result.status,0,result.err);
  assert.match(result.err,/could not all be removed/);
  assert.deepEqual(fs.readdirSync(backups).sort(),before,'and nothing went');
});

// A Mac (18 October 2026): until then the notebook there ran only while its Terminal window was
// open and never after a restart. Now it is a LaunchAgent of the installing account, started at
// every login and again after an error. launchd itself is a stand-in here; the Mac runner walks
// the real one (notebook/test/native-install-mac.sh).
test('on a Mac the notebook is a LaunchAgent that starts at login and again after an error',options,()=>{
  const env={root:'/Users/anna/godspeed v2',state:'/Users/anna/godspeed v2/.godspeed/integrated-runtime',node:'/Users/anna/node & <22>/bin/node',HOME:'/Users/anna',PLIST_PATH:'/opt/node/bin:/usr/bin'};
  const plist=sh('PATH=$PLIST_PATH plist_text',env);
  assert.equal(plist.status,0,plist.err);
  for(const line of ['<key>Label</key><string>com.godspeedmissioncontrol.notebook</string>',
    '<array><string>/Users/anna/node &amp; &lt;22&gt;/bin/node</string><string>/Users/anna/godspeed v2/.godspeed/integrated-runtime/start.mjs</string></array>',
    '<key>WorkingDirectory</key><string>/Users/anna/godspeed v2</string>',
    '<dict><key>HOME</key><string>/Users/anna</string><key>PATH</key><string>/opt/node/bin:/usr/bin</string></dict>',
    '<key>RunAtLoad</key><true/>','<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>',
    '<key>StandardOutPath</key><string>/Users/anna/Library/Logs/Godspeed Mission Control/notebook.log</string>'])
    assert.ok(plist.out.split('\n').map(l=>l.trim()).includes(line),line+'\n'+plist.out);
  assert.match(plist.out,/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!DOCTYPE plist/);
  assert.match(plist.out,/<\/plist>\n$/);
});

// A launchctl that writes down what it was asked and refuses the domains FAKE_REFUSE names.
function fakeLaunchctl(){
  const dir=scratch('launchctl');
  fs.writeFileSync(dir+'/launchctl',['#!/bin/sh','echo "$*" >> "$FAKE_CALLS"',
    'case " $FAKE_REFUSE " in *" $1:${2%%/*} "*) exit 5 ;; esac',
    'case "$1" in print) [ -f "$FAKE_LOADED" ] || exit 113 ;; bootstrap|load) : > "$FAKE_LOADED" ;; bootout) rm -f "$FAKE_LOADED" ;; esac',''].join('\n'),{mode:0o755});
  return {launchctl:dir+'/launchctl',calls:dir+'/calls',loaded:dir+'/loaded'};
}

test('the LaunchAgent goes into the desktop session, or the account\'s background one when nobody is logged in at the screen',options,()=>{
  const l=fakeLaunchctl(),agents=scratch('agents'),env={GODSPEED_LAUNCHCTL:l.launchctl,GODSPEED_LAUNCH_AGENTS:agents,FAKE_CALLS:l.calls,FAKE_LOADED:l.loaded};
  const desk=sh('launch_start && launch_loaded && echo loaded',env);
  assert.equal(desk.status,0,desk.err);assert.equal(desk.out.trim(),'loaded');
  const uid=spawnSync(bash,['-c','id -u'],{encoding:'utf8'}).stdout.trim();
  assert.equal(fs.readFileSync(l.calls,'utf8').split('\n')[0],`bootstrap gui/${uid} ${agents}/com.godspeedmissioncontrol.notebook.plist`);
  const stop=sh('launch_stop && ! launch_loaded && echo stopped',env);
  assert.equal(stop.out.trim(),'stopped',stop.err);
  fs.rmSync(l.calls);
  const ssh=sh('launch_start && echo started',{...env,FAKE_REFUSE:'bootstrap:gui'});
  assert.equal(ssh.out.trim(),'started',ssh.err);
  assert.deepEqual(fs.readFileSync(l.calls,'utf8').trim().split('\n').map(c=>c.split(' ').slice(0,2).join(' ')),[`bootstrap gui/${uid}`,`bootstrap user/${uid}`]);
});

test('a notebook started by hand from Terminal is stopped before the new one starts, and nothing else is',options,()=>{
  const state=scratch('by-hand'),other=scratch('other');
  fs.writeFileSync(state+'/start.mjs','setInterval(()=>{},1000);\n');fs.writeFileSync(other+'/start.mjs','setInterval(()=>{},1000);\n');
  // Started from a shell that ends at once, as a Terminal window would leave them: the system reaps them.
  const start=file=>Number(spawnSync(bash,['-c','"$0" "$1" >/dev/null 2>&1 & echo $!',process.execPath,file],{encoding:'utf8'}).stdout.trim());
  const mine={pid:start(state+'/start.mjs')},theirs={pid:start(other+'/start.mjs')};
  const kill=pid=>{try{process.kill(pid,'SIGKILL');}catch{}};
  try{
    const result=sh('stop_started_by_hand',{state});
    assert.equal(result.status,0,result.err);
    const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
    for(let i=0;i<50&&alive(mine.pid);i++)spawnSync(process.execPath,['-e','setTimeout(()=>{},100)']);
    assert.equal(alive(mine.pid),false,'the notebook of this folder stopped');
    assert.equal(alive(theirs.pid),true,'another folder\'s notebook was left alone');
  }finally{kill(mine.pid);kill(theirs.pid);}
});

// install-godspeed.sh on a Mac (18 October 2026): Homebrew is checked before anything is
// downloaded, and a Mac without it is told in plain words what to do. A Mac with Node.js and
// Apple's command line tools needs no Homebrew and goes on (here to a curl that fails at once).
test('a Mac without Homebrew is told how to get it before anything is downloaded',options,()=>{
  const entry=slash(fileURLToPath(new URL('../../install-godspeed.sh',import.meta.url)));
  const bin=scratch('mac-bin'),calls=bin+'/calls';
  fs.writeFileSync(bin+'/uname','#!/bin/sh\necho Darwin\n',{mode:0o755});
  fs.writeFileSync(bin+'/curl','#!/bin/sh\necho curl >> "$FAKE_CALLS"\nexit 22\n',{mode:0o755});
  fs.writeFileSync(bin+'/xcode-select','#!/bin/sh\n[ -n "$FAKE_CLT" ]\n',{mode:0o755});
  for(const tool of ['cat','bash','dirname'])fs.symlinkSync(spawnSync('bash',['-c','command -v '+tool],{encoding:'utf8'}).stdout.trim(),bin+'/'+tool);
  // GODSPEED_BREW_PLACES: where this test's Mac keeps Homebrew, nowhere (a runner has a real one).
  const run=env=>spawnSync(bin+'/bash',[entry],{encoding:'utf8',env:{HOME:scratch('mac-home'),PATH:bin,FAKE_CALLS:calls,GODSPEED_BREW_PLACES:bin+'/no-brew',...env}});
  const none=run({});
  assert.equal(none.status,1);
  assert.match(none.stderr,/This Mac needs Homebrew first\./);
  assert.match(none.stderr,/https:\/\/brew\.sh/);
  assert.equal(fs.existsSync(calls),false,'nothing was downloaded');
  fs.symlinkSync(process.execPath,bin+'/node');
  const ready=run({FAKE_CLT:'1'});
  assert.doesNotMatch(ready.stderr,/Homebrew/,'Node.js and the command line tools are enough');
  assert.equal(fs.existsSync(calls),true,'and the install went on');
});

// WSL 2 runs every Linux distro in one network, so 127.0.0.1:47831 in a fresh distro can be another
// distro's notebook (18 October 2026): the install counts only an answer that names its own folder.
test('the installer counts only its own notebook as answering, and says when another one holds the port',options,async t=>{
  const workspace=scratch('own-notebook'),own=createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0,24);
  let instance='0123456789abcdef01234567';
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,format:1,version:'test',instance}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  // sleep is a no-op here, so the sixty tries take no time.
  const answers=()=>new Promise(resolve=>{const child=spawn(bash,['-c','GODSPEED_INSTALLER_FUNCTIONS_ONLY=1; . "$1"; sleep(){ :; }; answers','test',installer],{env:{...process.env,node:slash(process.execPath),GODSPEED_PORT:String(server.address().port),GODSPEED_WORKSPACE:workspace}});let err='';child.stderr.on('data',c=>err+=c);child.on('close',status=>resolve({status,err}));});
  const foreign=await answers();
  assert.notEqual(foreign.status,0,'the notebook of another installation is not this one answering');
  assert.match(foreign.err,/Another Godspeed Mission Control notebook, not this installation's, answers on port \d+/);
  assert.match(foreign.err,/GODSPEED_PORT=/);
  instance=own;
  const mine=await answers();
  assert.equal(mine.status,0,mine.err);
  assert.equal(mine.err,'');
});
