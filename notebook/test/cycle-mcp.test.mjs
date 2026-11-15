import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';
import {trackers} from '../core/trackers.mjs';

// The cycle tracker over MCP, the Telegram bot's way in (D-321 step 4): the same operation, and the
// MCP guard unchanged: every change to an existing record needs the hash the assistant read.
const fixture=t=>{process.env.GODSPEED_NOW='2026-10-12T08:00:00Z';const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-cycle-mcp-'));t.after(()=>{fs.rmSync(root,{recursive:true,force:true});delete process.env.GODSPEED_NOW;});const store=new Store(root),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});return {root,store,query,domains};};
const call=async(env,args,scopes=['actions','collections'])=>{const r=await mcp({id:1,method:'tools/call',params:{name:'personal_operation',arguments:args}},{...env,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
const ok=r=>{assert.equal(r.error,false,r.text);return JSON.parse(r.text);};
const cycle=store=>trackers(store).find(c=>c.tracker.specialist==='cycle');

test('the bot sets up, tracks, switches the heads-up and deletes, each change with its hash',async t=>{
 const env=fixture(t);
 const held=ok(await call(env,{type:'cycle',action:'track'}));
 assert.match(held.reply,/^Start a cycle tracker\?/);
 assert.equal(ok(await call(env,{type:'tracker-create',proposal_id:held.proposal_id})).reply.startsWith('Tracked: period day 1.'),true);
 // A second entry today changes today's row: refused without its hash, done with it.
 assert.equal((await call(env,{type:'cycle',action:'track',flow:'heavy'})).error,true);
 let status=ok(await call(env,{type:'cycle',action:'status'}));
 assert.equal(ok(await call(env,{type:'cycle',action:'track',flow:'heavy',expected:{['collection_items/'+status.today.id]:status.today.hash}})).reply,'Tracked: period day 1, heavy.');
 // The heads-up changes the tracker's card: it needs the tracker's hash.
 assert.equal((await call(env,{type:'cycle',action:'heads-up',enabled:true})).error,true);
 status=ok(await call(env,{type:'cycle',action:'status'}));
 assert.match(ok(await call(env,{type:'cycle',action:'heads-up',enabled:true,expected:{['collections/'+status.tracker.id]:status.tracker.hash}})).reply,/^Done: two days before/);
 assert.equal(cycle(env.store).tracker.cycle.heads_up,true);
 // Delete: the question gives the hashes; a yes without them deletes nothing; with them, everything goes.
 const asked=ok(await call(env,{type:'cycle',action:'delete'}));
 const refused=await call(env,{type:'cycle',action:'delete',confirm:asked.request_id});
 assert.equal(refused.error,true);assert.match(refused.text,/hash/);assert.ok(cycle(env.store),'nothing deleted');
 const done=ok(await call(env,{type:'cycle',action:'delete',confirm:asked.request_id,expected:asked.expected}));
 assert.match(done.reply,/^Deleted: your cycle tracker and its 1 day are gone from your notebook\./);
 assert.equal(cycle(env.store),undefined);
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
 assert.deepEqual(walk(path.join(env.root,'notebook')).filter(f=>/heavy|unspecified|Cycle/.test(fs.readFileSync(f,'utf8'))),[]);
});

test('a key without the collections scope cannot make the cycle tracker',async t=>{
 const env=fixture(t);
 const held=ok(await call(env,{type:'cycle',action:'track'},['actions']));
 assert.equal((await call(env,{type:'tracker-create',proposal_id:held.proposal_id},['actions'])).error,true);
 assert.equal(cycle(env.store),undefined);
});
