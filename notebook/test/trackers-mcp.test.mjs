import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';

// The environment and call of assistant-control-records.test.mjs.
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-control-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});return {store,query,domains};};
const call=async(env,name,args,scopes)=>{const r=await mcp({id:1,method:'tools/call',params:{name,arguments:args}},{...env,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
const ok=r=>{assert.equal(r.error,false,r.text);return JSON.parse(r.text);};

// Over MCP (the Telegram bot's way in) the same operations work, and changing
// an existing entry needs its current hash, as every assistant edit does.
test('the bot holds, creates, tracks and replaces through personal_operation',async t=>{
  const env=fixture(t),scopes=['actions','collections'];
  const held=ok(await call(env,'personal_operation',{type:'tracker-hold',name:'Belly',unit:'cm',value:92},scopes));
  assert.match(held.reply,/^Start a new tracker called Belly/);
  const created=ok(await call(env,'personal_operation',{type:'tracker-create',proposal_id:held.proposal_id},scopes));
  assert.match(created.reply,/^Tracked: Belly 92 cm\./);
  const list=ok(await call(env,'personal_operation',{type:'tracker-list'},scopes));
  const belly=list.trackers[0];assert.equal(belly.name,'Belly');assert.deepEqual(list.pending,[]);
  const refused=await call(env,'personal_operation',{type:'track',tracker:belly.id,value:91},scopes);
  assert.equal(refused.error,true);assert.match(refused.text,/hash/);
  const replaced=ok(await call(env,'personal_operation',{type:'track',tracker:belly.id,value:91,expected:{['collection_items/'+belly.today.id]:belly.today.hash}},scopes));
  assert.match(replaced.reply,/is now 91 cm/);
  // A correction and a removal need the entry's hash too (tracker-list's last).
  const now=ok(await call(env,'personal_operation',{type:'tracker-list'},scopes)).trackers[0];
  assert.equal((await call(env,'personal_operation',{type:'tracker-correct',tracker:'belly',remove:true},scopes)).error,true);
  const removed=ok(await call(env,'personal_operation',{type:'tracker-correct',tracker:'belly',remove:true,expected:{['collection_items/'+now.last.id]:now.last.hash}},scopes));
  assert.equal(removed.removed,true);
  // Another name changes the tracker's card, so it needs the tracker's hash.
  const card=ok(await call(env,'personal_operation',{type:'tracker-list'},scopes)).trackers[0];
  assert.equal((await call(env,'personal_operation',{type:'track',tracker:card.id,value:90,new_name:'Waist'},scopes)).error,true);
  const under=ok(await call(env,'personal_operation',{type:'track',tracker:card.id,value:90,new_name:'Waist',expected:{['collections/'+card.id]:card.hash}},scopes));
  assert.match(under.reply,/^Tracked under Belly: 90 cm\.$/);
});

test('a key without the collections scope cannot make or fill a tracker',async t=>{
  const env=fixture(t),scopes=['actions'];
  const held=ok(await call(env,'personal_operation',{type:'tracker-hold',name:'Belly',unit:'cm',value:92},scopes));
  const r=await call(env,'personal_operation',{type:'tracker-create',proposal_id:held.proposal_id},scopes);
  assert.equal(r.error,true);assert.equal(env.store.list('collections').length,0);
});
