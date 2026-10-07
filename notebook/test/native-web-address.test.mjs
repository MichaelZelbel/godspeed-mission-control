import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync,spawn} from 'node:child_process';
import {createService} from '../server/main.mjs';

// The Linux installer's web address for a server ("The web address, on a server" in
// install-native-notebook.sh), its parts run in bash without installing anything, as in
// native-installer.test.mjs. On Windows it runs only when GODSPEED_TEST_BASH names a bash.
const installer=fileURLToPath(new URL('../scripts/install-native-notebook.sh',import.meta.url)).replaceAll('\\','/');
const bash=process.env.GODSPEED_TEST_BASH||'bash';
const options={skip:process.platform==='win32'&&!process.env.GODSPEED_TEST_BASH&&'set GODSPEED_TEST_BASH to a bash'};
const slash=p=>p.replaceAll('\\','/');
function sh(script,env={}){
  const prefix='if [ -n "${FAKE_BIN:-}" ]; then PATH="$(cygpath -u "$FAKE_BIN" 2>/dev/null || printf %s "$FAKE_BIN"):$PATH"; fi; ';
  const result=spawnSync(bash,['-c','set -euo pipefail; GODSPEED_INSTALLER_FUNCTIONS_ONLY=1; . "$1"; '+prefix+script,'test',installer],{encoding:'utf8',env:{...process.env,...env}});
  return {status:result.status,out:result.stdout,err:result.stderr};
}
const scratch=name=>slash(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-web-'+name+'-')));
const fake=(dir,name,lines)=>fs.writeFileSync(dir+'/'+name,['#!/bin/sh',...lines,''].join('\n'),{mode:0o755});
const text=file=>fs.readFileSync(file,'utf8');

test('the site hands every visit to the web door, and the installation\'s own Caddy has no admin endpoint',options,()=>{
  const result=sh('own_caddyfile srv1.example.com 47833');
  assert.equal(result.status,0,result.err);
  assert.equal(result.out,'{\n\tadmin off\n}\n\n# The Godspeed Mission Control notebook\'s web address. Its installer writes this file.\nsrv1.example.com {\n\treverse_proxy 127.0.0.1:47833\n}\n');
});

test('the web address runs Caddy as the notebook\'s account, which may open ports 80 and 443, with its certificates kept in the installation',options,()=>{
  const state='/srv/my 100% folder/.godspeed/integrated-runtime';
  const result=sh('https_unit_text "$state/runtime/caddy-2.11.4/caddy"',{state,service_user:'anna',service_group:'staff',HOME:'/home/anna'});
  assert.equal(result.status,0,result.err);
  const lines=result.out.split('\n');
  for(const line of ['User=anna','Group=staff','Environment="XDG_DATA_HOME=/srv/my 100%% folder/.godspeed/integrated-runtime/https"',
    'ExecStart="/srv/my 100%% folder/.godspeed/integrated-runtime/runtime/caddy-2.11.4/caddy" run --config "/srv/my 100%% folder/.godspeed/integrated-runtime/https/Caddyfile" --adapter caddyfile',
    'AmbientCapabilities=CAP_NET_BIND_SERVICE','Restart=on-failure','WantedBy=multi-user.target'])
    assert.ok(lines.includes(line),line+'\n'+result.out);
});

test('on the server\'s own Caddy, a name it already serves keeps its site and the notebook gets a port beside it',options,()=>{
  const dir=scratch('site'),site=(host,env={})=>sh('CADDYFILE=$DIR/Caddyfile; caddy_site '+host,{DIR:dir,...env}).out;
  fs.writeFileSync(dir+'/Caddyfile','srv1.example.com {\n\thandle {\n\t\treverse_proxy 127.0.0.1:3100\n\t}\n}\n');
  assert.equal(site('srv1.example.com'),'srv1.example.com:48443');
  assert.equal(site('srv1.example.com',{GODSPEED_HTTPS_PORT:'8443'}),'srv1.example.com:8443');
  assert.equal(site('notebook.example.com'),'notebook.example.com');
  fs.writeFileSync(dir+'/Caddyfile','# srv1.example.com was served here once\n:80 {\n\troot * /usr/share/caddy\n\tfile_server\n}\n\n# The Godspeed Mission Control notebook\'s web address (its installer keeps this line).\nimport /etc/caddy/godspeed-notebook.caddy\n');
  assert.equal(site('srv1.example.com'),'srv1.example.com','a comment, or the notebook\'s own line, is not a site');
});

test('who answers on ports 80 and 443 decides how the address is made',options,()=>{
  const dir=scratch('front'),bin=dir+'/bin';fs.mkdirSync(bin);
  fake(bin,'systemctl',['case "$*" in *"is-active --quiet caddy"*) [ -n "$FAKE_CADDY" ] ;; *) exit 1 ;; esac']);
  fake(bin,'ss',['[ -z "$FAKE_SS" ] || echo "$FAKE_SS"']);
  fs.writeFileSync(dir+'/Caddyfile','srv1.example.com {\n}\n');
  const front=env=>sh('HTTPS_SERVICE=godspeed-https-test-$$.service; CADDYFILE=$DIR/Caddyfile; web_front',{FAKE_BIN:bin,DIR:dir,FAKE_CADDY:'',FAKE_SS:'',...env}).out.trim();
  assert.equal(front({}),'own','nobody answers: the installation brings its own Caddy');
  assert.equal(front({FAKE_CADDY:'1',FAKE_SS:'LISTEN 0 4096 *:443 *:*'}),'caddy','the server\'s Caddy: the notebook\'s site is added to it');
  assert.equal(front({FAKE_SS:'LISTEN 0 511 0.0.0.0:80 0.0.0.0:*'}),'taken','another program holds the ports');
});

test('the notebook\'s site is added to the server\'s Caddy once, and a reload Caddy refuses puts both files back',options,()=>{
  const dir=scratch('caddy'),bin=dir+'/bin';fs.mkdirSync(bin);
  fake(bin,'systemctl',['echo "$*" >> "$FAKE_CALLS"','[ "$*" != "reload caddy" ] || exit "${FAKE_RELOAD:-0}"']);
  const own='srv1.example.com {\n\treverse_proxy 127.0.0.1:3100\n}\n';fs.writeFileSync(dir+'/Caddyfile',own);
  const env={FAKE_BIN:bin,DIR:dir,FAKE_CALLS:dir+'/calls',GODSPEED_WEB_PORT:'47833'};
  const add=(site,more={})=>sh('as_root() { "$@"; }; CADDYFILE=$DIR/Caddyfile; SITE_FILE=$DIR/godspeed-notebook.caddy; add_to_caddy '+site,{...env,...more});
  const imported=`import ${dir}/godspeed-notebook.caddy`;

  // Refused the very first time: no site file is left, and the Caddyfile is as it was.
  let result=add('srv1.example.com:48443',{FAKE_RELOAD:'1'});
  assert.notEqual(result.status,0);
  assert.equal(text(dir+'/Caddyfile'),own);
  assert.equal(fs.existsSync(dir+'/godspeed-notebook.caddy'),false);

  result=add('srv1.example.com:48443');
  assert.equal(result.status,0,result.err);
  assert.equal(text(dir+'/godspeed-notebook.caddy'),'# The Godspeed Mission Control notebook\'s web address. Its installer writes this file.\nsrv1.example.com:48443 {\n\treverse_proxy 127.0.0.1:47833\n}\n');
  assert.ok(text(dir+'/Caddyfile').startsWith(own),'the server\'s own sites are left as they were');
  assert.equal(text(dir+'/Caddyfile').split('\n').filter(line=>line===imported).length,1);
  assert.equal(add('srv1.example.com:48443').status,0);
  assert.equal(text(dir+'/Caddyfile').split('\n').filter(line=>line===imported).length,1,'a second installation adds no second line');

  // Refused later: the site that worked before is back.
  const before={caddyfile:text(dir+'/Caddyfile'),site:text(dir+'/godspeed-notebook.caddy')};
  result=add('srv1.example.com:49443',{FAKE_RELOAD:'1'});
  assert.notEqual(result.status,0);
  assert.deepEqual({caddyfile:text(dir+'/Caddyfile'),site:text(dir+'/godspeed-notebook.caddy')},before);
});

// A stand-in for Caddy's release page: curl copies from a folder, uname says Linux on x64.
function fakeCaddy({tamper=false}={}){
  const dir=scratch('dist'),bin=dir+'/bin',dist=dir+'/dist',name='caddy_2.11.4_linux_amd64.tar.gz';
  fs.mkdirSync(bin);fs.mkdirSync(dist+'/pack',{recursive:true});
  fake(dist+'/pack','caddy',['[ "$1" = version ] && echo "v2.11.4 h1:fake=" ']);
  fake(bin,'uname',['case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac']);
  fake(bin,'curl',['[ -z "$FAKE_OFFLINE" ] || exit 7','out=; url=; prev=','for a; do [ "$prev" != -o ] || out=$a; case "$a" in https://*) url=$a ;; esac; prev=$a; done','echo "$url" >> "$FAKE_CALLS"','cp "$FAKE_DIST/${url##*/}" "$out"']);
  const made=spawnSync(bash,['-c','cd "$1" && tar -czf "'+name+'" -C pack caddy && sum=$(sha512sum "'+name+'" | cut -d" " -f1) && printf "%s  %s\\n" "'+(tamper?'0'.repeat(128):'$sum')+'" "'+name+'" > caddy_2.11.4_checksums.txt','x',dist],{encoding:'utf8'});
  assert.equal(made.status,0,made.stderr);
  return {bin,dist,calls:dir+'/calls'};
}

test('Caddy is downloaded once, checked against the checksum list it publishes',options,()=>{
  const f=fakeCaddy(),state=scratch('state'),env={state,FAKE_BIN:f.bin,FAKE_DIST:f.dist,FAKE_CALLS:f.calls};
  const first=sh('install_caddy',env);
  assert.equal(first.status,0,first.err);
  assert.equal(first.out,state+'/runtime/caddy-2.11.4/caddy');
  assert.deepEqual(text(f.calls).trim().split('\n'),['https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_checksums.txt','https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_linux_amd64.tar.gz']);
  const again=sh('install_caddy',{...env,FAKE_OFFLINE:'1'});
  assert.equal(again.status,0,'an installed one is used without the network: '+again.err);
  assert.equal(again.out,first.out);
});

test('a Caddy download that does not match its checksum is never used',options,()=>{
  const f=fakeCaddy({tamper:true}),state=scratch('state');
  const result=sh('install_caddy',{state,FAKE_BIN:f.bin,FAKE_DIST:f.dist,FAKE_CALLS:f.calls});
  assert.notEqual(result.status,0);
  assert.match(result.err,/did not match its published checksum/);
  assert.equal(fs.existsSync(state+'/runtime/caddy-2.11.4'),false);
});

test('the installer hands over a private setup link until the account exists, and nothing after',options,async t=>{
  for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key)&&key!=='GODSPEED_TEST_BASH')delete process.env[key];
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-web-setup-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,port:0,webPort:0});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  const link=()=>new Promise(resolve=>{const child=spawn(bash,['-c','GODSPEED_INSTALLER_FUNCTIONS_ONLY=1; . "$1"; setup_path','test',installer],{env:{...process.env,node:slash(process.execPath),GODSPEED_PORT:String(service.address.port)}});let out='';child.stdout.on('data',c=>out+=c);child.on('close',status=>resolve({status,out}));});
  const first=await link();
  assert.equal(first.status,0);
  assert.match(first.out,/^\/setup#invite=[a-f0-9]{64}$/);
  const web='http://127.0.0.1:'+service.webAddress.port;
  const made=await fetch(web+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner-test',password:'correct horse battery staple',invite:first.out.split('=')[1]})});
  assert.equal(made.status,200);
  const after=await link();
  assert.equal(after.status,0);
  assert.equal(after.out,'','once the account exists the address itself is handed over');
});
