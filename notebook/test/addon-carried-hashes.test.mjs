import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';

// A CARRIED ADD-ON THAT DRIFTED FROM ITS PIN, FOUND WITHOUT THE ADD-ON'S REPOSITORY (#862). The
// copies under third-party/addons/ are vendored at the commit sources.json pins, and the vendoring
// script records the hash of every carried file when it pins. Nothing here opens the network or an
// add-on checkout: the hashes are recomputed from the copies alone, so the gate can ask the
// question on any pull request. A change to a carried file is made in the add-on's own repository
// and brought here by re-pinning, and the message says so.
const product=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const addonsRoot=path.join(product,'third-party/addons');
const pins=()=>JSON.parse(fs.readFileSync(path.join(product,'third-party/addons/sources.json'),'utf8'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export const WAY='Make the change in the add-on\'s own repository and bring it here by re-pinning: run python notebook/scripts/vendor-addons.py <checkout folder> <add-on>. The copies in third-party/addons are never edited by hand.';

// Every pinned add-on: one problem per carried file that no longer has the content its hash stands
// for, one per carried file with no hash, one per hash with no carried file behind it, and one per
// file sitting in the copy that the add-on does not carry. An add-on carried in this repository has
// no pin and records no hashes, so it is not asked.
export function hashProblems(list,root){
 const problems=[];
 for(const pin of list){
  if(pin.carriedHere)continue;
  const carried=new Set(pin.files);
  const hashes=pin.hashes||{};
  for(const file of pin.files){
   const name=`${pin.name}/${file}`;
   if(!fs.existsSync(path.join(root,name)))problems.push(`${name} is carried but is not in the copy.`);
   else if(!(file in hashes))problems.push(`${name} is carried but has no hash recorded for it.`);
   else if(hashes[file]!==sha(path.join(root,name)))problems.push(`${name} has been changed since its hash was recorded.`);
  }
  for(const file of Object.keys(hashes))if(!pin.files.includes(file))problems.push(`${pin.name}/${file} has a hash recorded but is not among the files the add-on carries.`);
  for(const file of copyFiles(root,pin.name))if(!carried.has(file))problems.push(`${pin.name}/${file} is present in the copy but is not among the files the add-on carries.`);
 }
 return problems;
}

// The files a copy holds on disk, as paths relative to the copy. Where a repository answers —
// this repository for the real copies, one a fixture builds for the git case below — git is asked
// the query vendor-addons.py --check asks, with `-z` so paths are never C-quoted and a hand-added
// file whose name git quotes is still enumerated. A name that is not valid UTF-8 cannot be read
// back as text, so it is named by its escaped bytes: such a name can only have been written by
// hand, since the vendoring script never carries one, and it is named in the report instead of
// being silently dropped. The child's locale is pinned to `C` so the not-a-repository fallback is
// detected in git's untranslated message, whatever catalog the machine has. There, files the
// repository ignores (node_modules, __pycache__) do not count as part of a copy, a file committed
// here is found before it is staged, and a file a re-pin dropped is not reported while its
// deletion is still unstaged; a folder with no repository is walked instead. The walk is mapped
// to the separators pin.files is written in.
function gitListed(root,name,flags){
 const listed=spawnSync('git',['ls-files','-z',...flags,'--',name],{cwd:root,env:{...process.env,LC_ALL:'C'}});
 if(listed.error)throw listed.error;
 if(listed.status!==0){if(!/not a git repository/i.test(listed.stderr.toString()))throw new Error(listed.stderr.toString());return null;}
 return listed.stdout;
}
// The names one git answer holds, NUL-separated: read strictly where the name is valid UTF-8, and
// named by its escaped bytes where it is not (a byte that starts no valid UTF-8 sequence is shown
// as \xNN, the rest of the name as it is).
function gitNames(out){
 const names=[];
 for(let start=0;start<out.length;){
  let end=out.indexOf(0,start);if(end<0)end=out.length;
  if(end>start)names.push(escapedName(out.subarray(start,end)));
  start=end+1;
 }
 return names;
}
function escapedName(bytes){
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{}
 let name='',i=0;
 while(i<bytes.length){
  const byte=bytes[i];
  if(byte<0x80){name+=String.fromCharCode(byte);i++;continue;}
  let piece=null,used=0;
  for(let n=2;n<=4&&i+n<=bytes.length;n++){
   try{piece=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(i,i+n));used=n;break;}catch{}
  }
  if(piece){name+=piece;i+=used;}else{name+='\\x'+byte.toString(16).padStart(2,'0');i++;}
 }
 return name;
}
function copyFiles(root,name){
 const cached=gitListed(root,name,['--cached']),others=gitListed(root,name,['--others','--exclude-standard']);
 if(cached===null||others===null)return fs.readdirSync(path.join(root,name),{recursive:true}).filter(file=>fs.statSync(path.join(root,name,file)).isFile()).map(file=>file.replaceAll('\\','/'));
 // A file the index still holds after a re-pin dropped it is not on disk any more, and is not
 // counted: the copy matches, and the deletion only has to be staged. A file listed as untracked
 // is on disk by definition. A name that is not valid UTF-8 (which a copy is never given by the
 // vendoring script, so only a hand-added untracked one can be) cannot be checked on disk as
 // text; it is kept, so a hand-added one is still named.
 const relative=names=>names.map(file=>file.slice(name.length+1));
 return [...relative(gitNames(cached)).filter(file=>fs.existsSync(path.join(root,name,file))||/\\x/.test(file)),...relative(gitNames(others))];
}

export const hashReport=(list,root)=>{const problems=hashProblems(list,root);return problems.length?problems.join('\n')+'\n\n'+WAY:'';};

test('every carried file of every pinned add-on has the hash of its copy',()=>{
 assert.equal(hashReport(pins(),addonsRoot),'');
});

// Each kind of failure the gate is meant to catch is shown by a case of its own, built in a
// throwaway folder, so the real copies are never touched and main never fails here for real.
const fixture=()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-addon-hashes-'));
 const files=['README.md','lib/tick.mjs','lib/gone.mjs'];
 for(const file of files){const dest=path.join(root,'pinned-add-on',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,`content of ${file}`);}
 const pin={name:'pinned-add-on',commit:'0'.repeat(40),license:'MIT',files,hashes:Object.fromEntries(files.map(file=>[file,sha(path.join(root,'pinned-add-on',file))])),activation:'activation'};
 const carried={name:'carried-add-on',carriedHere:true,license:'MIT',files:['README.md'],activation:'activation'};
 return {root,pin,carried,pins:[pin,carried]};
};

test('a carried file that was changed is named with the add-on and the way out',()=>{
 const f=fixture();
 fs.writeFileSync(path.join(f.root,'pinned-add-on/lib/tick.mjs'),'edited here by hand');
 const report=hashReport(f.pins,f.root);
 assert.match(report,/pinned-add-on\/lib\/tick\.mjs has been changed since its hash was recorded\./);
 assert.match(report,/own repository/);assert.match(report,/re-pin/);
});

test('a carried file with no recorded hash is named with the add-on and the way out',()=>{
 const f=fixture();
 f.pin.files.push('lib/new.mjs');fs.writeFileSync(path.join(f.root,'pinned-add-on/lib/new.mjs'),'new file');
 const report=hashReport(f.pins,f.root);
 assert.match(report,/pinned-add-on\/lib\/new\.mjs is carried but has no hash recorded for it\./);
 assert.match(report,/own repository/);assert.match(report,/re-pin/);
});

test('a hash with no carried file behind it is named with the add-on and the way out',()=>{
 const f=fixture();
 fs.unlinkSync(path.join(f.root,'pinned-add-on/lib/gone.mjs'));
 f.pin.files=f.pin.files.filter(file=>file!=='lib/tick.mjs');
 const report=hashReport(f.pins,f.root);
 assert.match(report,/pinned-add-on\/lib\/gone\.mjs is carried but is not in the copy\./);
 assert.match(report,/pinned-add-on\/lib\/tick\.mjs has a hash recorded but is not among the files the add-on carries\./);
 assert.match(report,/own repository/);assert.match(report,/re-pin/);
});

test('a file added to the copy that the add-on does not carry is named with the add-on and the way out',()=>{
 const f=fixture();
 fs.writeFileSync(path.join(f.root,'pinned-add-on/lib/extra.mjs'),'added here by hand');
 const report=hashReport(f.pins,f.root);
 assert.match(report,/pinned-add-on\/lib\/extra\.mjs is present in the copy but is not among the files the add-on carries\./);
 assert.match(report,/own repository/);assert.match(report,/re-pin/);
});

// The added-file kind above is caught by the walk; in this repository it is the git answer that
// catches it, so the git query itself is pinned down here: a committed extra and an untracked one
// are named, an ignored file is not counted, and a file the index still holds after a re-pin
// dropped it is not reported while its deletion is unstaged. Git quotes exactly the names Windows
// reserves, so the quoted-name member is written and expected only where that name can exist.
test('the git answer the real gate relies on names committed and added extras and not ignored or dropped files',()=>{
 const f=fixture();
 const quoted=process.platform==='win32'?[]:['say "hi".md'];
 fs.writeFileSync(path.join(f.root,'.gitignore'),'skipped.mjs\n');
 fs.writeFileSync(path.join(f.root,'pinned-add-on/lib/committed.mjs'),'committed but not carried');
 const git=(...args)=>{const run=spawnSync('git',args,{cwd:f.root});if(run.status!==0)throw new Error(run.stderr.toString());};
 git('init');git('config','user.email','fixture@example.com');git('config','user.name','fixture');git('add','.');git('commit','--quiet','--message','pin');
 fs.unlinkSync(path.join(f.root,'pinned-add-on/lib/gone.mjs'));
 f.pin.files=f.pin.files.filter(file=>file!=='lib/gone.mjs');
 delete f.pin.hashes['lib/gone.mjs'];
 fs.writeFileSync(path.join(f.root,'pinned-add-on/lib/untracked.mjs'),'added here by hand');
 fs.writeFileSync(path.join(f.root,'pinned-add-on/lib/café notes.md'),'added here by hand');
 for(const file of quoted)fs.writeFileSync(path.join(f.root,'pinned-add-on/lib',file),'added here by hand');
 fs.writeFileSync(path.join(f.root,'pinned-add-on/lib/skipped.mjs'),'build output');
 assert.deepEqual(hashProblems(f.pins,f.root).sort(),[
  'pinned-add-on/lib/café notes.md is present in the copy but is not among the files the add-on carries.',
  'pinned-add-on/lib/committed.mjs is present in the copy but is not among the files the add-on carries.',
  ...quoted.map(file=>`pinned-add-on/lib/${file} is present in the copy but is not among the files the add-on carries.`),
  'pinned-add-on/lib/untracked.mjs is present in the copy but is not among the files the add-on carries.'
 ]);
 assert.match(hashReport(f.pins,f.root),/own repository/);
});

// The last member of the same class: a hand-added name that is not even valid UTF-8. Git reads the
// copy by raw bytes, so the enumeration has to name such a file by its escaped bytes, not drop it
// and not end in a throw that names only the copy. Such a name cannot be created on Windows, whose
// file names are always valid UTF-8, so the case asks its question only where one can exist.
test('a file added to the copy whose name is not valid UTF-8 is named by its escaped name',()=>{
 if(process.platform==='win32')return;
 const f=fixture();
 const git=(...args)=>{const run=spawnSync('git',args,{cwd:f.root});if(run.status!==0)throw new Error(run.stderr.toString());};
 git('init');
 fs.writeFileSync(Buffer.from(path.join(f.root,'pinned-add-on/lib/latin1-éname.md'),'latin1'),'added here by hand');
 assert.deepEqual(hashProblems(f.pins,f.root),['pinned-add-on/lib/latin1-\\xe9name.md is present in the copy but is not among the files the add-on carries.']);
 assert.match(hashReport(f.pins,f.root),/own repository/);assert.match(hashReport(f.pins,f.root),/re-pin/);
});

test('an add-on carried in this repository is not asked for hashes',()=>{
 const f=fixture();
 assert.equal(hashReport([f.carried],f.root),'');
});
