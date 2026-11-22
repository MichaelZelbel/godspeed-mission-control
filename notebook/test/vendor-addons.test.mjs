import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// THE VENDORING SCRIPT ITSELF, THE WAY A MAINTAINER MEETS IT (#938). The copies under
// third-party/addons/ are made and checked by notebook/scripts/vendor-addons.py, and its
// failures used to end in a Python traceback: --help was read as a folder name, a missing
// clone ended in a CalledProcessError, and names were read from git's line output, which
// quotes what it pleases. Nothing here touches the real copies: the script is copied into a
// throwaway product tree (it finds that tree from its own path) and run there against a
// throwaway checkout and a throwaway copy, built as git repositories like the real ones.
const script=new URL('../scripts/vendor-addons.py',import.meta.url);
const python=['python3','python'].find(p=>spawnSync(p,['-c','print(1)'],{encoding:'utf8'}).stdout?.trim()==='1');

function git(cwd,...args){
  const run=spawnSync('git',args,{cwd,encoding:'utf8'});
  if(run.status!==0)throw new Error(`git ${args.join(' ')} in ${cwd} failed: ${run.stderr}`);
  return run.stdout;
}

// A product tree with the script in it (so the tree it reads and writes is the throwaway one),
// its own git repository like the real product, an empty third-party/addons, and a checkout
// folder whose dev/ holds an add-on clone with a commit of its own.
function fixture(t,files=['README.md','lib/tick.mjs']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-vendor-addons-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const product=path.join(root,'product'),checkouts=path.join(root,'checkouts');
  fs.mkdirSync(path.join(product,'notebook/scripts'),{recursive:true});
  fs.mkdirSync(path.join(product,'third-party/addons'),{recursive:true});
  fs.copyFileSync(fileURLToPath(script),path.join(product,'notebook/scripts/vendor-addons.py'));
  git(product,'init');git(product,'config','user.email','fixture@example.com');git(product,'config','user.name','fixture');
  const addon=path.join(checkouts,'dev/add-on');fs.mkdirSync(addon,{recursive:true});
  git(addon,'init');git(addon,'config','user.email','fixture@example.com');git(addon,'config','user.name','fixture');
  for(const file of files){
    const dest=path.join(addon,file);
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,`content of ${file}`);
  }
  git(addon,'add','.');git(addon,'commit','--quiet','--message','pin');
  const run=(...args)=>{
    const result=spawnSync(python,[path.join(product,'notebook/scripts/vendor-addons.py'),...args],{encoding:'utf8'});
    return {status:result.status,stdout:result.stdout||'',stderr:result.stderr||''};
  };
  const pins=()=>JSON.parse(fs.readFileSync(path.join(product,'third-party/addons/sources.json'),'utf8'));
  const copy=path.join(product,'third-party/addons/add-on');
  return {root,product,checkouts,run,pins,copy};
}

test('--help prints usage and exits 0',t=>{
  const f=fixture(t);
  for(const flag of ['--help','-h']){
    const result=f.run(flag);
    assert.equal(result.status,0,`--help (${flag}) must exit 0: ${result.stderr}`);
    assert.match(result.stdout,/usage:/);
    assert.match(result.stdout,/vendor-addons\.py/);
  }
});

test('a missing clone is said in one plain line naming the add-on, and nothing is copied',t=>{
  const f=fixture(t);
  const result=f.run(f.checkouts,'no-such-add-on');
  assert.notEqual(result.status,0,'a missing clone must exit non-zero');
  const lines=(result.stderr+result.stdout).trim().split('\n').filter(line=>/no-such-add-on/.test(line));
  assert.equal(lines.length,1,'the missing clone is named once');
  assert.match(lines[0],/no checkout/);
  assert.equal(fs.existsSync(path.join(f.product,'third-party/addons/sources.json')),false,'no pins were written for a run that found a clone missing');
});

test('--check says a missing clone in one plain line naming the add-on',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.product,'third-party/addons/sources.json'),JSON.stringify([{name:'gone-add-on',commit:'0'.repeat(40),license:'MIT',files:[],hashes:{},activation:'activation'}],null,2)+'\n');
  const result=f.run('--check',f.checkouts);
  assert.equal(result.status,1,'a missing clone must exit non-zero');
  const lines=(result.stderr+result.stdout).trim().split('\n').filter(line=>/gone-add-on/.test(line));
  assert.equal(lines.length,1,'the missing clone is named once');
  assert.match(lines[0],/no checkout/);
});

test('a file named with a space and one with non-ASCII characters are carried and checked by their real names',t=>{
  const f=fixture(t,['README.md','lib/has space.md','lib/café.md']);
  const result=f.run(f.checkouts,'add-on');
  assert.equal(result.status,0,result.stderr+result.stdout);
  const pin=f.pins().find(entry=>entry.name==='add-on');
  assert.deepEqual(pin.files,['README.md','lib/café.md','lib/has space.md'],'the pin holds the real names, not the ones git quotes');
  assert.equal(fs.readFileSync(path.join(f.copy,'lib/café.md'),'utf8'),'content of lib/café.md','the copy holds the file under its real name');
  const check=f.run('--check',f.checkouts);
  assert.equal(check.status,0,`--check must agree with what was just vendored: ${check.stdout}${check.stderr}`);
});

test('a file a re-pin dropped is not reported while its deletion is still unstaged',t=>{
  const f=fixture(t,['README.md','lib/tick.mjs']);
  assert.equal(f.run(f.checkouts,'add-on').status,0);
  // The real copies are tracked in the product's repository: stage the copy, the way a commit
  // of a vendoring run would, then drop a file from the add-on and re-pin from the new commit.
  git(f.product,'add','-A','third-party/addons');
  const addon=path.join(f.checkouts,'dev/add-on');
  fs.unlinkSync(path.join(addon,'lib/tick.mjs'));
  git(addon,'add','-A');git(addon,'commit','--quiet','--message','drop tick.mjs');
  const repin=f.run(f.checkouts,'add-on');
  assert.equal(repin.status,0,repin.stderr+repin.stdout);
  assert.equal(fs.existsSync(path.join(f.copy,'lib/tick.mjs')),false,'the copy no longer holds the dropped file');
  const check=f.run('--check',f.checkouts);
  assert.equal(check.status,0,`--check must not report a file whose deletion is only unstaged: ${check.stdout}${check.stderr}`);
});

test('a hand-added file whose name is not valid UTF-8 is reported by its escaped name',t=>{
  if(process.platform==='win32')return;
  const f=fixture(t);
  assert.equal(f.run(f.checkouts,'add-on').status,0);
  fs.writeFileSync(Buffer.from(path.join(f.copy,'lib','latin1-éname.md'),'latin1'),'added here by hand');
  const check=f.run('--check',f.checkouts);
  assert.equal(check.status,1,'a file the add-on does not carry must exit non-zero');
  assert.match(check.stdout,/lib\/latin1-\\xe9name\.md \(copied, not in the commit\)/);
});
