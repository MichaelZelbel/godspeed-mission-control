import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync,spawn} from 'node:child_process';import http from 'node:http';import net from 'node:net';
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
// The notebook's site, with the two places add-ons put files of their own (docs/full-version/
// addon-model.md, "A web address for an add-on"): paths on the notebook's own address, handled
// before its pages, and sites of their own.
const site=(address,port,folder='/etc/caddy/godspeed-addons')=>'# The Godspeed Mission Control notebook\'s web address. Its installer writes this file.\n'
  +address+' {\n\t# Paths add-ons add to this address, before the notebook\'s own pages: one file each, written by the add-on.\n\timport '+folder+'/paths/*.caddy\n'
  +'\treverse_proxy 127.0.0.1:'+port+'\n}\n\n'
  +'# Add-ons\' own web addresses: one file each, written by the add-on (docs/full-version/addon-model.md).\nimport '+folder+'/*.caddy\n';

test('the site hands every visit to the web door, and the installation\'s own Caddy has no admin endpoint',options,()=>{
  const result=sh('own_caddyfile srv1.example.com 47833');
  assert.equal(result.status,0,result.err);
  assert.equal(result.out,'{\n\tadmin off\n}\n\n'+site('srv1.example.com','47833'));
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
  const add=(site,more={})=>sh('as_root() { "$@"; }; CADDYFILE=$DIR/Caddyfile; SITE_FILE=$DIR/godspeed-notebook.caddy; ADDON_SITES=$DIR/godspeed-addons; add_to_caddy '+site,{...env,...more});
  const imported=`import ${dir}/godspeed-notebook.caddy`;

  // Refused the very first time: no site file is left, the Caddyfile is as it was, and there is
  // no folder for add-ons, which would tell an add-on that this Caddy reads it.
  let result=add('srv1.example.com:48443',{FAKE_RELOAD:'1'});
  assert.notEqual(result.status,0);
  assert.equal(text(dir+'/Caddyfile'),own);
  assert.equal(fs.existsSync(dir+'/godspeed-notebook.caddy'),false);
  assert.equal(fs.existsSync(dir+'/godspeed-addons'),false);

  result=add('srv1.example.com:48443');
  assert.equal(result.status,0,result.err);
  assert.ok(fs.statSync(dir+'/godspeed-addons/paths').isDirectory(),'the folder for add-ons is made once Caddy took the site');
  assert.equal(text(dir+'/godspeed-notebook.caddy'),site('srv1.example.com:48443','47833',dir+'/godspeed-addons'));
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

// What an add-on puts in its folder is its own: the installer makes the folder and never writes in it,
// also when it runs again, and also when Caddy refuses a reload.
const addonFiles={'clerk.caddy':'srv1.example.com:48444 {\n\treverse_proxy 127.0.0.1:8000\n}\n','paths/pictures.caddy':'handle_path /pictures/* {\n\troot * /var/lib/an-add-on/pictures\n\tfile_server\n}\n'};
const putAddonFiles=folder=>{for(const [name,body] of Object.entries(addonFiles)){fs.mkdirSync(path.dirname(folder+'/'+name),{recursive:true});fs.writeFileSync(folder+'/'+name,body);}};
const listed=folder=>fs.readdirSync(folder,{recursive:true}).map(name=>slash(String(name))).sort();
const assertAddonFiles=folder=>{
  assert.deepEqual(listed(folder),['clerk.caddy','paths','paths/pictures.caddy'],'nothing else is written in the folder');
  for(const [name,body] of Object.entries(addonFiles))assert.equal(text(folder+'/'+name),body,name+' is as the add-on wrote it');
};

test('on the server\'s Caddy, the files an add-on put in its folder are left as they are',options,()=>{
  const dir=scratch('addons'),bin=dir+'/bin';fs.mkdirSync(bin);
  fake(bin,'systemctl',['[ "$*" != "reload caddy" ] || exit "${FAKE_RELOAD:-0}"']);
  fs.writeFileSync(dir+'/Caddyfile','srv1.example.com {\n\treverse_proxy 127.0.0.1:3100\n}\n');
  putAddonFiles(dir+'/godspeed-addons');
  const add=(more={})=>sh('as_root() { "$@"; }; CADDYFILE=$DIR/Caddyfile; SITE_FILE=$DIR/godspeed-notebook.caddy; ADDON_SITES=$DIR/godspeed-addons; add_to_caddy srv1.example.com:48443',{FAKE_BIN:bin,DIR:dir,GODSPEED_WEB_PORT:'47833',...more});
  for(const more of [{},{},{FAKE_RELOAD:'1'}]){add(more);assertAddonFiles(dir+'/godspeed-addons');}
  if(process.platform!=='win32')for(const folder of ['','/paths'])assert.equal(fs.statSync(dir+'/godspeed-addons'+folder).mode&0o777,0o755,'readable for the installation\'s own Caddy, which runs as the notebook\'s account');
});

test('Godspeed\'s own Caddy reads the folder too, made once Caddy started with it, and leaves the add-on\'s files as they are',options,()=>{
  const dir=scratch('own-addons'),bin=dir+'/bin';fs.mkdirSync(bin);
  fake(bin,'systemctl',['[ "$1" != restart ] || exit "${FAKE_RESTART:-0}"']);
  const start=(more={})=>sh('as_root() { if [ "$1" = tee ]; then cat > "$DIR/unit"; else "$@"; fi; }; install_caddy() { printf /opt/caddy; }; HTTPS_SERVICE=godspeed-https-test.service; ADDON_SITES=$DIR/godspeed-addons; start_own_caddy srv1.example.com',
    {FAKE_BIN:bin,DIR:dir,state:dir+'/state',service_user:'anna',service_group:'staff',HOME:dir,GODSPEED_WEB_PORT:'47833',...more});
  let result=start({FAKE_RESTART:'1'});
  assert.notEqual(result.status,0);
  assert.equal(fs.existsSync(dir+'/godspeed-addons'),false,'a Caddy that did not start reads no folder, so none is made');
  result=start();
  assert.equal(result.status,0,result.err);
  assert.equal(text(dir+'/state/https/Caddyfile'),'{\n\tadmin off\n}\n\n'+site('srv1.example.com','47833',dir+'/godspeed-addons'));
  assert.ok(fs.statSync(dir+'/godspeed-addons/paths').isDirectory());
  putAddonFiles(dir+'/godspeed-addons');
  for(const more of [{},{FAKE_RESTART:'1'}]){start(more);assertAddonFiles(dir+'/godspeed-addons');}
});

// Caddy itself takes what the installer writes, on both kinds of server, with the folder empty and
// with an add-on's path and site in it. GODSPEED_TEST_CADDY names a Caddy program (the integrated
// workflow downloads the installer's own, checked against its checksum, with install_caddy).
const caddy=process.env.GODSPEED_TEST_CADDY;
const withCaddy={skip:options.skip||(!caddy&&'set GODSPEED_TEST_CADDY to a Caddy program')};
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});s.on('error',reject);});
const caddyEnv=dir=>({...process.env,HOME:dir,USERPROFILE:dir,APPDATA:dir,XDG_DATA_HOME:dir+'/data',XDG_CONFIG_HOME:dir+'/config'});
const validate=(config,dir)=>spawnSync(caddy,['validate','--config',config,'--adapter','caddyfile'],{encoding:'utf8',env:caddyEnv(dir)});
async function runCaddy(t,config,dir,probe){
  let log='';const child=spawn(caddy,['run','--config',config,'--adapter','caddyfile'],{env:caddyEnv(dir),stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
  t.after(async()=>{if(child.exitCode===null){const gone=new Promise(r=>child.once('exit',r));child.kill();await gone;}});
  for(const until=Date.now()+20000;Date.now()<until&&child.exitCode===null;){try{await fetch(probe);return;}catch{await new Promise(r=>setTimeout(r,200));}}
  assert.fail('Caddy did not start: '+log.slice(-1500));
}
const body=async(url,cookie)=>{const r=await fetch(url,{redirect:'manual',headers:cookie?{Cookie:cookie}:{}});return r.status+' '+(r.headers.get('location')||await r.text());};

test('Caddy takes the notebook\'s site with the add-ons\' folder empty, and serves an add-on\'s path and site from it',withCaddy,async t=>{
  const dir=scratch('real-caddy'),folder=dir+'/godspeed-addons';
  const [notebook,web,addonSite,serverSite]=await Promise.all([freePort(),freePort(),freePort(),freePort()]);
  // The notebook's web door, as far as Caddy sees it: /api/session answers 200 for a signed-in visit
  // and 401 otherwise (web-auth.test.mjs tests the real one).
  const upstream=http.createServer((req,res)=>{
    if(req.url==='/api/session'){res.statusCode=/godspeed_session=signed-in/.test(req.headers.cookie||'')?200:401;return res.end();}
    res.end('the notebook at '+req.url);
  });
  await new Promise(r=>upstream.listen(notebook,'127.0.0.1',r));t.after(()=>upstream.close());
  // Only this machine answers: the test binds every site to 127.0.0.1.
  const local=config=>config.replace('{\n\tadmin off\n}','{\n\tadmin off\n\tdefault_bind 127.0.0.1\n}');
  const own=sh('ADDON_SITES=$DIR/godspeed-addons; own_caddyfile "http://127.0.0.1:$WEB" "$UP"',{DIR:dir,WEB:String(web),UP:String(notebook)});
  assert.equal(own.status,0,own.err);
  fs.writeFileSync(dir+'/own.caddy',local(own.out));
  const notebookSite=sh('ADDON_SITES=$DIR/godspeed-addons; site_text "http://127.0.0.1:$WEB" "$UP"',{DIR:dir,WEB:String(web),UP:String(notebook)});
  assert.equal(notebookSite.status,0,notebookSite.err);
  fs.writeFileSync(dir+'/godspeed-notebook.caddy',notebookSite.out);
  fs.writeFileSync(dir+'/server.caddy',`{\n\tadmin off\n\tdefault_bind 127.0.0.1\n}\n\nhttp://127.0.0.1:${serverSite} {\n\trespond "the server's own site"\n}\n\nimport ${dir}/godspeed-notebook.caddy\n`);

  // The first time Caddy reads the site there is no folder yet (the installer makes it afterwards).
  for(const config of ['own.caddy','server.caddy']){const r=validate(dir+'/'+config,dir);assert.equal(r.status,0,config+' with no folder: '+r.stdout+r.stderr);}
  fs.mkdirSync(folder+'/paths',{recursive:true});
  for(const config of ['own.caddy','server.caddy']){const r=validate(dir+'/'+config,dir);assert.equal(r.status,0,config+' with the folder empty: '+r.stdout+r.stderr);}
  // A path as addon-model.md shows it: only for whoever is signed in to the notebook.
  fs.writeFileSync(folder+'/paths/pictures.caddy',`redir /pictures /pictures/ 308\nhandle_path /pictures/* {\n\tforward_auth 127.0.0.1:${notebook} {\n\t\turi /api/session\n\t\t@signin status 401\n\t\thandle_response @signin {\n\t\t\tredir * / 302\n\t\t}\n\t}\n\trespond "a picture at {path}"\n}\n`);
  fs.writeFileSync(folder+'/paths/open.caddy','handle /open-to-all/* {\n\trespond "open"\n}\n');
  fs.writeFileSync(folder+'/an-add-on.caddy',`http://127.0.0.1:${addonSite} {\n\trespond "the add-on's own site"\n}\n`);

  for(const config of ['own.caddy','server.caddy']){
    await t.test(config,async t=>{
      const at=`http://127.0.0.1:${web}`;
      await runCaddy(t,dir+'/'+config,dir,at+'/');
      assert.equal(await body(at+'/dashboard'),'200 the notebook at /dashboard');
      assert.equal(await body(at+'/pictures/a.jpg','godspeed_session=signed-in'),'200 a picture at /a.jpg','the add-on\'s path comes before the notebook\'s pages');
      assert.equal(await body(at+'/pictures/a.jpg'),'302 /','without a sign-in, to the notebook\'s sign-in');
      assert.equal(await body(at+'/pictures'),'308 /pictures/');
      assert.equal(await body(at+'/open-to-all/x'),'200 open');
      assert.equal(await body(at+'/picturesque'),'200 the notebook at /picturesque');
      assert.equal(await body(`http://127.0.0.1:${addonSite}/`),'200 the add-on\'s own site');
      if(config==='server.caddy')assert.equal(await body(`http://127.0.0.1:${serverSite}/`),'200 the server\'s own site');
    });
  }

  // An add-on file Caddy cannot read: the check an add-on runs before Caddy takes its file says so.
  fs.writeFileSync(folder+'/paths/broken.caddy','handle_path /broken/* {\n\trespond "never"\n');
  for(const config of ['own.caddy','server.caddy'])assert.notEqual(validate(dir+'/'+config,dir).status,0,config);
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
