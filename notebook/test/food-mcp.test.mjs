import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';
import {trackers,entries} from '../core/trackers.mjs';
import {withTable} from './food-fixture.mjs';

// The food tracker over MCP, the Telegram bot's way in (D-321 step 5): the same operation, and the MCP
// guard unchanged. A meal and an answer only add records, so they need no hash; a correction, a preset,
// the target and the settings change an existing record and need the hash the assistant read.
async function fixture(t){
 process.env.GODSPEED_NOW='2026-10-12T10:00:00Z';const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-food-mcp-'));
 t.after(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.GODSPEED_NOW;});
 const store=new Store(root),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});await withTable(root);
 return {root,store,query,domains};
}
const call=async(env,args,scopes=['actions','collections'])=>{const r=await mcp({id:1,method:'tools/call',params:{name:'personal_operation',arguments:args}},{...env,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
const ok=r=>{assert.equal(r.error,false,r.text);return JSON.parse(r.text);};
const food=store=>trackers(store).find(c=>c.tracker.specialist==='food');

test('the bot holds, creates, tracks and answers without hashes; corrections, presets and the target need theirs',async t=>{
 const env=await fixture(t);
 const search=ok(await call(env,{type:'food',action:'search',queries:['tofu','rice']}));
 assert.equal(search.results[0].foods[0].id,'H861000');
 const held=ok(await call(env,{type:'food',action:'track',items:[{food:'H861000',item:'tofu',grams:200,assumed:true},{food:'C352000',item:'rice',count:0.5,unit:'pack'}]}));
 assert.match(held.reply,/^Start a food tracker\? .* How big was the pack of rice\?$/);
 assert.match(ok(await call(env,{type:'tracker-create',proposal_id:held.proposal_id,answers:[{grams:250}]})).reply,/^Tracked: tofu 200 g \(assumed\), rice 125 g: 669 kcal, 41 g protein\./);
 assert.match(ok(await call(env,{type:'food',action:'track',meal:'lunch',items:[{food:'E111100',item:'eggs',count:2,unit:'egg',grams:120,assumed:true}]})).reply,/^Tracked: eggs 120 g \(assumed\): 162 kcal/);
 const asked=ok(await call(env,{type:'food',action:'track',meal:'breakfast',items:[{food:'C512300',item:'muesli',count:1,unit:'bowl'}]}));
 assert.match(ok(await call(env,{type:'food',action:'answer',question:asked.question_id,grams:80})).reply,/^Tracked: muesli 80 g/);
 // A correction changes a row: refused without its hash, done with it.
 assert.equal((await call(env,{type:'food',action:'correct',item:'eggs',count:3})).error,true);
 let status=ok(await call(env,{type:'food',action:'status'}));
 const eggs=status.today.rows.find(r=>r.item==='eggs');
 assert.match(ok(await call(env,{type:'food',action:'correct',item:'eggs',count:3,expected:{['collection_items/'+eggs.id]:eggs.hash}})).reply,/^Changed: eggs on 12 October, now 180 g/);
 // A preset and the target change the tracker's card: they need the tracker's hash.
 assert.equal((await call(env,{type:'food',action:'remember',name:'usual breakfast'})).error,true);
 status=ok(await call(env,{type:'food',action:'status'}));
 const saved=ok(await call(env,{type:'food',action:'remember',name:'usual breakfast',expected:{['collections/'+status.tracker.id]:status.tracker.hash}}));
 assert.match(saved.reply,/^Saved as your usual breakfast: muesli 80 g\./);
 const target=ok(await call(env,{type:'food',action:'target',sex:'female',age:34,height_cm:168,weight_kg:70,activity:'light',goal:'lose',expected:{['collections/'+status.tracker.id]:saved.tracker_hash}}));
 assert.match(target.reply,/^Your daily target: 1,451 kcal/);
 assert.equal(food(env.store).tracker.food.target.kcal,1451);
 assert.equal(entries(env.store,food(env.store)).length,4);
});

test('a key without the collections scope cannot make the food tracker',async t=>{
 const env=await fixture(t);
 const held=ok(await call(env,{type:'food',action:'track',items:[{food:'H861000',item:'tofu',grams:200}]},['actions']));
 assert.equal((await call(env,{type:'tracker-create',proposal_id:held.proposal_id},['actions'])).error,true);
 assert.equal(food(env.store),undefined);
});
