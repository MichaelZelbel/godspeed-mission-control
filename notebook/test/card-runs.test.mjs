import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {cardCommand} from '../core/card-commands.mjs';

// The card commands are given only what they need and leave nothing behind
// (review of 6 October 2026).
const fixture=(t,provider=null)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-domain-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query,{provider});return {root,store,query,domains};};

test('a card command copies no notes it does not need and leaves nothing behind',async t=>{
 const env=fixture(t);for(let i=0;i<6;i++)env.store.save('notes',{title:'Note '+i,content:'Fictional private text '+i,ai_visibility:i%2?'hidden':'visible'});
 const moves=env.store.save('notes',{id:'fictional-moves',title:'Moves',content:'No moves today.'});
 const runs=path.join(env.store.state,'card-runs'),left=()=>fs.existsSync(runs)?fs.readdirSync(runs):[];
 const old=path.join(runs,'1-leftover');fs.mkdirSync(path.join(old,'notes'),{recursive:true});fs.writeFileSync(path.join(old,'notes','a.md'),'Fictional copied note');const hourAgo=new Date(Date.now()-2*3600000);fs.utimesSync(old,hourAgo,hourAgo);
 const listed=cardCommand(env.store,{card:'goals',args:['list']});
 assert.deepEqual(left(),[]);assert.equal(listed.retained_snapshot,undefined);
 const bets=cardCommand(env.store,{card:'goals',args:['bets','--moves','notes/'+moves.id+'.md']});
 assert.doesNotMatch(bets.result,/not there/);assert.deepEqual(left(),[]);
});
