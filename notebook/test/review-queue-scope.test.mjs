import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-review-scope-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query);return {store,query,domains};};
const review=(store,value,extra={})=>store.save('review_queue',{suggestion_type:'add_profile_entry',status:'pending_review',payload:{label:'Home city',attribute:'home_city',value},...extra});

// The page and the sidebar count only what is waiting for a decision; an
// action on "all" must change exactly those, never earlier decisions.
for(const action of ['rollback','never_again','keep'])test(`${action} on all acts only on waiting, unsnoozed suggestions`,async t=>{
 const env=fixture(t),kept=review(env.store,'Town A');await env.domains.invoke('review-queue-bulk',{action:'keep',ids:[kept.id]});
 const waiting=review(env.store,'Town B'),snoozed=review(env.store,'Town C',{snoozed_until:new Date(Date.now()+86400000).toISOString()});
 const result=await env.domains.invoke('review-queue-bulk',{action,scope:'all'});
 assert.equal(result.processed,1);assert.deepEqual(result.errors,[]);
 assert.equal(env.store.get('review_queue',kept.id).status,'kept');
 assert.equal(env.store.get('review_queue',snoozed.id).status,'pending_review');
 assert.notEqual(env.store.get('review_queue',waiting.id).status,'pending_review');
});
