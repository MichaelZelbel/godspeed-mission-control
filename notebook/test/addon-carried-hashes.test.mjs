import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';

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
// for, one per carried file with no hash, one per hash with no carried file behind it. An add-on
// carried in this repository has no pin and records no hashes, so it is not asked.
export function hashProblems(list,root){
 const problems=[];
 for(const pin of list){
  if(pin.carriedHere)continue;
  const hashes=pin.hashes||{};
  for(const file of pin.files){
   const name=`${pin.name}/${file}`;
   if(!fs.existsSync(path.join(root,name)))problems.push(`${name} is carried but is not in the copy.`);
   else if(!(file in hashes))problems.push(`${name} is carried but has no hash recorded for it.`);
   else if(hashes[file]!==sha(path.join(root,name)))problems.push(`${name} has been changed since its hash was recorded.`);
  }
  for(const file of Object.keys(hashes))if(!pin.files.includes(file))problems.push(`${pin.name}/${file} has a hash recorded but is not among the files the add-on carries.`);
 }
 return problems;
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

test('an add-on carried in this repository is not asked for hashes',()=>{
 const f=fixture();
 assert.equal(hashReport([f.carried],f.root),'');
});
