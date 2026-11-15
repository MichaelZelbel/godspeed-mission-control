import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';

// A promise of the mission control's that was missed, never kept or cannot be read opens the
// morning brief (tools/promises.js); a day with none leaves the brief exactly as it was, and no
// promise ever stops the brief.
const OK='No fresh health observations are recorded. Your day is open.';
const NEVER='A promise has never been kept: a weekly letter. It was first due 2020-01-06.';
function fixture(promises,{voice}={}){
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-promise-brief-'))),query=new QueryService(store);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 if(promises!==null){
  const dir=path.join(store.root,'work','promises');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'README.md'),'# not a promise\n');
  for(const [name,text] of Object.entries(promises))fs.writeFileSync(path.join(dir,name),text);
 }
 if(voice){fs.mkdirSync(path.join(store.root,'profile'),{recursive:true});fs.writeFileSync(path.join(store.root,'profile','voice.md'),'```voice-rules\n'+voice+'\n```\n');}
 return {store,query};
}
const promise=(what,started='2020-01-01')=>'PROMISE: letter\nWHAT YOU GET: '+what+'\nCADENCE: weekly\nDUE: monday 09:00 UTC\nSTARTED: '+started+'\nRUNS IT: a routine\nPROOF: dates-in routines/ran/letter.txt\n';
const provider=async input=>input.kind==='brief-verification'?{passed:true,reason:'Fictional sources checked.'}:OK;
async function brief(store,query,id){const result=await jobExecutor(provider,query)({kind:'morning-brief',id},{store,settings:{}});return store.get('notes',result.record_id).content;}

test('a promise never kept opens the brief, above what the writer wrote',async()=>{
 const {store,query}=fixture({'letter.md':promise('a weekly letter')});
 assert.equal(await brief(store,query,'brief-never'),NEVER+'\n\n'+OK);
});

test('a day with every promise kept or not yet due is the brief without promises',async()=>{
 const without=fixture(null),quiet=fixture({'letter.md':promise('a weekly letter','2099-01-01')});
 assert.equal(await brief(quiet.store,quiet.query,'brief-quiet'),await brief(without.store,without.query,'brief-without'));
});

test('a promise file that cannot be read is said at the top, and the brief is saved',async()=>{
 const {store,query}=fixture({'broken.md':'PROMISE: half a file\n'});
 const content=await brief(store,query,'brief-unreadable');
 assert.match(content.split('\n')[0],/^A promise file cannot be read: broken\.md \(no WHAT YOU GET; /);
 assert.ok(content.endsWith(OK));
});

test('a promise whose own words break the writing rules is told without them',async()=>{
 const {store,query}=fixture({'letter.md':promise('a synergy letter')},{voice:'BANNED-WORD: synergy'});
 assert.equal(await brief(store,query,'brief-voice'),'A promise has never been kept. It was first due 2020-01-06.\n\n'+OK);
});

test('promises that cannot be checked are said, and never stop the brief',async()=>{
 const {store,query}=fixture(null);
 fs.mkdirSync(path.join(store.root,'work'),{recursive:true});fs.writeFileSync(path.join(store.root,'work','promises'),'a file where the folder should be\n');
 assert.equal(await brief(store,query,'brief-cannot'),'Your promises could not be checked today.\n\n'+OK);
});

test('a promise line the writing rules refuse even without its words is left out, and a repair is filed',async()=>{
 const {store,query}=fixture({'letter.md':promise('a weekly letter')},{voice:'BANNED-WORD: promise'});
 assert.equal(await brief(store,query,'brief-left-out'),OK);
 const repair=store.list('work_items').find(w=>w.line_name==='the promise lines');
 assert.equal(repair?.state,'needs_review');assert.match(repair.error,/Configured voice check failed: promise/);
});
