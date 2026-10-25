import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';

// The Mac and Linux line reads its stage (25 October 2026): install-godspeed.sh names no version
// of its own any more. It reads the one it installs from the stage file of the stage it is told
// to install, with stage/stage.sh of the same ref, and refuses a version that was taken back.
// Nothing here reaches the network: GODSPEED_STAGE_RAW points at a folder of stage files, and a
// stand-in curl serves it and the two downloads the installer makes, writing down every address
// it was asked for. On Windows it runs only when GODSPEED_TEST_BASH names a bash (Git Bash),
// since `bash` there may be WSL's.
const repo=fileURLToPath(new URL('../..',import.meta.url)).replace(/[\\/]$/,'');
const installer=path.join(repo,'install-godspeed.sh').replaceAll('\\','/');
const forwarder=path.join(repo,'installers','install-godspeed.sh').replaceAll('\\','/');
const realReader=path.join(repo,'stage','stage.sh');
const bash=process.env.GODSPEED_TEST_BASH||'bash';
const options={skip:process.platform==='win32'&&!process.env.GODSPEED_TEST_BASH&&'set GODSPEED_TEST_BASH to a bash'};
const slash=p=>p.replaceAll('\\','/');
const scratch=name=>slash(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-stage-'+name+'-')));
const text=file=>fs.readFileSync(file,'utf8');

// A stage file in the one layout stage/stage.sh reads, out of this checkout's own stage.json with
// the fields a case cares about put in. JSON.stringify keeps the file's order of fields.
const template=JSON.parse(text(path.join(repo,'stage.json')));
const commit=c=>c.repeat(40).slice(0,40);
function stageText(changes={}){
  return JSON.stringify({...template,...changes},null,2)+'\n';
}
// What a stage names: the product commit, the Unix kit-bootstrap commit and the version.
function stage({product='a1',engine='b2',version=template.version,withdrawn=[]}={}){
  return stageText({version,productCommit:commit(product),
    kitBootstrap:{...template.kitBootstrap,unixEngineCommit:commit(engine)},withdrawn});
}

// A folder of stage files, one folder a ref, read through GODSPEED_STAGE_RAW as file://...
//   {beta:{stage:'...'}, candidate:{stage:'...', installer:'#!/bin/sh\n...'}}
// `stage` left out leaves the ref without a stage.json; `reader` left out copies the real one.
function stages(refs){
  const dir=scratch('stages');
  for(const [ref,what] of Object.entries(refs)){
    const at=dir+'/'+ref;
    fs.mkdirSync(at+'/stage',{recursive:true});
    fs.copyFileSync(realReader,at+'/stage/stage.sh');
    if(what.stage!==undefined)fs.writeFileSync(at+'/stage.json',what.stage);
    if(what.installer!==undefined)fs.writeFileSync(at+'/install-godspeed.sh',what.installer);
  }
  return {dir,raw:pathToFileURL(dir).href};
}

// The stand-in downloads: a curl that writes every address down and serves file:// off the disk,
// the kit-bootstrap engine and the notebook hook. Anything else it is asked for fails, so a
// download the installer should not have made cannot quietly work.
function fakeBin(){
  const dir=scratch('bin'),calls=dir+'/calls',said=dir+'/said';
  const engine=dir+'/engine.sh',hook=dir+'/hook.sh';
  fs.writeFileSync(engine,['#!/bin/sh',
    '# The shared installer, as far as this test reads it: what it was run with, and the folder.',
    'printf \'%s\\n\' "$0 $*" > "$FAKE_SAID/engine-args"',
    '{ echo "GODSPEED_PRODUCT_REF=$GODSPEED_PRODUCT_REF"; echo "GODSPEED_STARTER_REF=$GODSPEED_STARTER_REF"; echo "KB_BRANCH=$KB_BRANCH"; echo "GODSPEED_INTEGRATED_BESIDE=${GODSPEED_INTEGRATED_BESIDE:-}"; } > "$FAKE_SAID/engine-env"',
    'root=; prev=; for a in "$@"; do [ "$prev" != --godspeed ] || root=$a; prev=$a; done',
    'mkdir -p "$root"',''].join('\n'));
  fs.writeFileSync(hook,['#!/bin/sh',
    '# The notebook hook: what it was run with, and the record of the commit it would run.',
    'printf \'%s\\n\' "$*" > "$FAKE_SAID/hook-args"',
    'mkdir -p "$1/.godspeed/integrated-runtime"',
    'printf \'%s\\n\' "$GODSPEED_PRODUCT_REF" > "$1/.godspeed/integrated-runtime/version"',''].join('\n'));
  fs.writeFileSync(dir+'/curl',['#!/bin/sh',
    'out=; url=; prev=',
    'for a; do [ "$prev" != -o ] || out=$a; case "$a" in file://*|https://*) url=$a ;; esac; prev=$a; done',
    'printf \'%s\\n\' "$url" >> "$FAKE_CALLS"',
    'serve() { if [ -n "$out" ]; then cp "$1" "$out"; else cat "$1"; fi; }',
    'case "$url" in',
    '  file://*)',
    '    p=${url#file://}',
    '    case $p in /[A-Za-z]:/*) p=${p#/} ;; esac',   // file:///C:/x on Windows
    '    [ -f "$p" ] || exit 7',
    '    serve "$p" ;;',
    '  */kit-bootstrap/*/setup-godspeed.sh) serve "$FAKE_ENGINE" ;;',
    '  */notebook/scripts/install-native-notebook.sh) serve "$FAKE_HOOK" ;;',
    '  *) exit 7 ;;',
    'esac',''].join('\n'),{mode:0o755});
  fs.mkdirSync(said);
  return {dir,calls,said,engine,hook};
}

// Running one of the two installers with that stand-in bin in front of PATH and a home of its
// own, so nothing of the machine's own is read or written.
function run(script,{args=[],env={},bin,home}={}){
  const prefix='PATH="$(cygpath -u "$FAKE_BIN" 2>/dev/null || printf %s "$FAKE_BIN"):$PATH"; ';
  const result=spawnSync(bash,['-c',prefix+'exec bash "$0" "$@"',script,...args],{encoding:'utf8',
    env:{...process.env,GODSPEED_STAGE_REF:'',GODSPEED_STAGE_RAW:'',GODSPEED_V2_INSTALL_DIR:'',
      HOME:home||scratch('home'),FAKE_BIN:bin.dir,FAKE_CALLS:bin.calls,FAKE_SAID:bin.said,
      FAKE_ENGINE:bin.engine,FAKE_HOOK:bin.hook,...env}});
  return {status:result.status,out:result.stdout,err:result.stderr};
}
const asked=bin=>fs.existsSync(bin.calls)?text(bin.calls).trim().split('\n').filter(Boolean):[];
const settings=bin=>Object.fromEntries(text(bin.said+'/engine-env').trim().split('\n').map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));

// One installation out of one stage folder, into a folder that is not there yet.
function install({refs,ref,args=[],env={}}){
  const bin=fakeBin(),where=stages(refs),root=scratch('install')+'/godspeed';
  const result=run(installer,{args,bin,env:{GODSPEED_STAGE_RAW:where.raw,
    ...(ref===undefined?{}:{GODSPEED_STAGE_REF:ref}),GODSPEED_V2_INSTALL_DIR:root,...env}});
  return {...result,bin,where,root,asked:asked(bin)};
}

test('the commits the installer installs are the ones its stage file names, and beta is the stage it reads without being told',options,()=>{
  const beta=stage({product:'a1',engine:'b2'});
  const run1=install({refs:{beta:{stage:beta}}});
  assert.equal(run1.status,0,run1.err);
  // The product commit is the product, the starter and the commit of the notebook hook.
  assert.deepEqual(settings(run1.bin),{GODSPEED_PRODUCT_REF:commit('a1'),GODSPEED_STARTER_REF:commit('a1'),
    KB_BRANCH:commit('b2'),GODSPEED_INTEGRATED_BESIDE:''});
  assert.deepEqual(run1.asked,[run1.where.raw+'/beta/stage/stage.sh',run1.where.raw+'/beta/stage.json',
    'https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/'+commit('b2')+'/setup-godspeed.sh',
    'https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/'+commit('a1')+'/notebook/scripts/install-native-notebook.sh']);
  // The shared installer is still run the way it was, with the starter repository and the folder.
  assert.equal(text(run1.bin.said+'/engine-args').trim(),
    'setup-godspeed --starter-repo https://github.com/MichaelZelbel/godspeed-mission-control.git --godspeed '+run1.root);
  assert.equal(text(run1.bin.said+'/hook-args').trim(),run1.root);
  assert.equal(text(run1.root+'/.godspeed/integrated-runtime/version').trim(),commit('a1'));
});

test('the Godspeed folder keeps the stage file it was installed from and the ref it was read from',options,()=>{
  const beta=stage({product:'c3',engine:'d4'});
  const run1=install({refs:{beta:{stage:beta}}});
  assert.equal(run1.status,0,run1.err);
  assert.equal(text(run1.root+'/.godspeed/stage.json'),beta,'the stage file, as it was read');
  assert.equal(text(run1.root+'/.godspeed/stage-ref'),'beta\n','and the ref it was read from');
  // Beside the notebook's own record of the commit it runs.
  assert.ok(fs.existsSync(run1.root+'/.godspeed/integrated-runtime/version'));
});

test('GODSPEED_STAGE_REF picks which stage file is read, and the public one is read as well',options,()=>{
  const refs={beta:{stage:stage({product:'a1',engine:'b2'})},'release/beta-7':{stage:stage({product:'e5',engine:'f6'})}};
  const run1=install({refs,ref:'release/beta-7'});
  assert.equal(run1.status,0,run1.err);
  assert.equal(settings(run1.bin).GODSPEED_PRODUCT_REF,commit('e5'),'the stage it was told to install');
  assert.equal(settings(run1.bin).KB_BRANCH,commit('f6'));
  assert.equal(text(run1.root+'/.godspeed/stage.json'),refs['release/beta-7'].stage);
  assert.equal(text(run1.root+'/.godspeed/stage-ref'),'release/beta-7\n');
  assert.deepEqual(run1.asked.filter(u=>u.endsWith('stage.json')),
    [run1.where.raw+'/release/beta-7/stage.json',run1.where.raw+'/beta/stage.json'],
    'the stage asked for and the public one');
  assert.ok(run1.asked[0].endsWith('/release/beta-7/stage/stage.sh'),'the reader comes from the same ref');
});

// A refusal downloads nothing past the stage files and leaves no Godspeed folder behind.
function refused(result,sentence){
  assert.notEqual(result.status,0,'it went on: '+result.out);
  assert.match(result.err,sentence);
  assert.equal(result.err.trim().split('\n').length,1,'one plain sentence, not several: '+result.err);
  for(const url of result.asked)
    assert.ok(url.endsWith('/stage.json')||url.endsWith('/stage/stage.sh'),'it downloaded '+url);
  assert.equal(fs.existsSync(result.root),false,'it made the Godspeed folder');
}

test('a version the stage it was told to install has taken back is refused, and nothing is downloaded or changed',options,()=>{
  const taken=template.version;
  const refs={beta:{stage:stage({withdrawn:[]})},candidate:{stage:stage({product:'e5',withdrawn:[taken]})}};
  const result=install({refs,ref:'candidate'});
  refused(result,/was taken back; running the line without GODSPEED_STAGE_REF installs the version that is current now\./);
  assert.match(result.err,new RegExp('Godspeed Mission Control '+taken.replaceAll('.','\\.')+' was taken back'));
});

test('a version only the public stage has taken back is refused too',options,()=>{
  const taken=template.version;
  const refs={beta:{stage:stage({withdrawn:[taken]})},candidate:{stage:stage({product:'e5',withdrawn:[]})}};
  const result=install({refs,ref:'candidate'});
  refused(result,/was taken back; running the line without GODSPEED_STAGE_REF installs the version that is current now\./);
  // And the public stage alone is enough when it is the stage asked for.
  const onlyBeta=install({refs:{beta:refs.beta}});
  refused(onlyBeta,/was taken back/);
});

test('a stage file that is not there stops the installer, with no fallback version',options,()=>{
  const result=install({refs:{beta:{}}});
  refused(result,/the version list of Godspeed Mission Control at .*\/beta\/stage\.json could not be read\./);
  // A ref that does not exist at all: not even the reader is there.
  const nowhere=install({refs:{beta:{stage:stage()}},ref:'no-such-branch'});
  refused(nowhere,/the reader of the version list of Godspeed Mission Control could not be read from .*\/no-such-branch\/stage\/stage\.sh\./);
});

test('a stage file that cannot be read as a stage file stops the installer',options,()=>{
  const bad=text(path.join(repo,'stage','stage-cases','bad-not-json.json'));
  const result=install({refs:{beta:{stage:bad}}});
  refused(result,/could not be read: .* is not JSON in the layout a stage file is written in/);
  // The public stage's own file is refused the same way.
  const other=install({refs:{beta:{stage:bad},candidate:{stage:stage()}},ref:'candidate'});
  refused(other,/at .*\/beta\/stage\.json could not be read:/);
});

test('a ref that is not the name of a branch or tag is refused before anything is read',options,()=>{
  for(const ref of ['../../etc','.hidden','-x','a b','beta/','/beta','a//b','beta;rm']){
    const result=install({refs:{beta:{stage:stage()}},ref});
    refused(result,/is not the name of a branch or tag of Godspeed Mission Control\./);
    assert.deepEqual(result.asked,[],ref+' was read anyway');
  }
});

test('installers/install-godspeed.sh runs the root installer of the stage it is given, with the arguments it was given',options,()=>{
  const said=scratch('forwarded');
  const standIn=['#!/bin/sh','printf \'%s\\n\' "$*" > "$FORWARDED/args"',
    '{ echo "ref=$GODSPEED_STAGE_REF"; echo "raw=$GODSPEED_STAGE_RAW"; } > "$FORWARDED/stage"',''].join('\n');
  const bin=fakeBin(),where=stages({beta:{stage:stage(),installer:standIn},candidate:{stage:stage(),installer:standIn}});
  const result=run(forwarder,{args:['--beside','--godspeed','/srv/my godspeed','--sources',''],bin,
    env:{GODSPEED_STAGE_RAW:where.raw,GODSPEED_STAGE_REF:'candidate',FORWARDED:said}});
  assert.equal(result.status,0,result.err);
  assert.equal(text(said+'/args'),'--beside --godspeed /srv/my godspeed --sources \n');
  assert.equal(text(said+'/stage'),'ref=candidate\nraw='+where.raw+'\n','the stage is passed on');
  assert.deepEqual(asked(bin),[where.raw+'/candidate/install-godspeed.sh']);
  // Without a ref it forwards to the public stage, and a ref that is no branch or tag is refused.
  const plain=run(forwarder,{args:[],bin:fakeBin(),env:{GODSPEED_STAGE_RAW:where.raw,FORWARDED:said}});
  assert.equal(plain.status,0,plain.err);
  assert.equal(text(said+'/stage'),'ref=beta\nraw='+where.raw+'\n');
  const refusedRef=run(forwarder,{args:[],bin:fakeBin(),env:{GODSPEED_STAGE_RAW:where.raw,GODSPEED_STAGE_REF:'../x',FORWARDED:said}});
  assert.notEqual(refusedRef.status,0);
  assert.match(refusedRef.err,/is not the name of a branch or tag of Godspeed Mission Control\./);
});

test('neither installer names a commit, a release tag or a version any more',()=>{
  for(const file of [installer,forwarder]){
    const source=text(file);
    assert.doesNotMatch(source,/\b[0-9a-f]{40}\b/,file+' still names a commit');
    assert.doesNotMatch(source,/godspeed-v[0-9][0-9A-Za-z.]*-[0-9A-Za-z]/,file+' still names a release tag');
    assert.doesNotMatch(source,/\bv?[0-9]+\.[0-9]+\.[0-9]+/,file+' still names a version');
  }
  assert.notEqual(text(installer),text(forwarder),'installers/install-godspeed.sh is still a copy of the installer');
  assert.ok(fs.existsSync(forwarder),'running Godspeed servers link to installers/install-godspeed.sh');
});
