import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {visibleRows} from '../core/visibility.mjs';
import {jobExecutor} from '../core/runtime.mjs';
import {mcp} from '../server/mcp.mjs';

// What may reach a model or an assistant (review of 6 October 2026): private sections,
// hidden goals, health readings and deadlines, private groups, and a changed
// fact that keeps its section and settings; the owner still finds their own hidden notes.
const fixture=(t,provider=null)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-domain-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query,{provider});return {root,store,query,domains};};
const current=(query,attribute)=>query.rows('profile_facts').filter(f=>f.is_current&&f.attribute===attribute).map(f=>f.value).sort();
const scopes=['notes','profile','world','actions','contacts','collections','media','stats'];
const call=async(env,name,args)=>{const r=await mcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},{...env,scopes});return r.result.content[0].text;};

test('a fact in a private section reaches no model and no assistant read',async t=>{
 let sent;const env=fixture(t,async input=>{sent=input;return {metadata:{},tags:[],suggestions:[]};});
 env.store.save('profile_categories',{slug:'health',name:'Health',visibility_scope:'private',contact_id:null});
 env.domains.writeFact({label:'Diagnosis',value:'Fictional private condition',category_slug:'health'});
 env.domains.writeFact({label:'Home city',value:'Fictional town'});
 for(const type of ['claims','fact_slots','profile_facts','world_claims']){const text=JSON.stringify(visibleRows(env.query,type));assert.ok(!text.includes('Fictional private condition')&&!text.includes('diagnosis'),type);assert.ok(type==='fact_slots'||text.includes('Fictional town'),type);}
 const note=env.store.save('notes',{title:'Day',content:'Went for a walk in the park today and had coffee.'});
 await env.domains.invoke('process-note',{note_id:note.id});
 assert.deepEqual(sent.confirmed_facts.map(f=>f.value),['Fictional town']);
 for(const type of ['claims','profile_facts','world_claims','fact_slots']){const text=await call(env,'list_records',{type});assert.ok(!text.includes('Fictional private condition')&&!text.includes('Diagnosis'),'list_records '+type);}
 for(const [name,args] of [['get_user_profile',{detail:'full'}],['get_claims',{}]]){const text=await call(env,name,args);assert.ok(!text.includes('Fictional private condition'),name);assert.ok(text.includes('Fictional town'),name);}
});

test('routines are given no hidden goal, sensitive health reading or hidden deadline',async t=>{
 let context;const env=fixture(t),provider=async input=>{context=input.context;return 'A fictional result';};
 env.store.save('goals',{title:'Fictional private goal',status:'adopted',ai_visibility:'hidden'});
 env.store.save('goals',{title:'Fictional open goal',status:'adopted'});
 env.store.save('health_observations',{metric:'weight',value:80,observed_at:new Date().toISOString(),is_sensitive:true});
 env.store.save('deadlines',{title:'Fictional hidden deadline',status:'open',ai_visibility:'hidden',due_at:'2030-01-01T00:00:00Z'});
 await jobExecutor(provider,env.query)({id:'fictional',kind:'fictional-routine'},{settings:{},store:env.store});
 assert.deepEqual(context.goals.map(g=>g.title),['Fictional open goal']);assert.deepEqual(context.health,[]);assert.ok(!JSON.stringify(context).includes('Fictional hidden deadline'));
});

test('changing a fact keeps its section, pin and assistant setting',async t=>{
 const env=fixture(t);
 env.domains.writeFact({label:'Diagnosis',value:'Old fictional condition',category_slug:'health',is_pinned:true});
 const slot=env.store.list('fact_slots')[0];env.store.save('fact_slots',{id:slot.id,show_to_agent:false},slot._hash);
 env.domains.writeFact({label:'Diagnosis',attribute:'diagnosis',value:'New fictional condition',category_slug:'health'});
 let after=env.store.get('fact_slots',slot.id);assert.equal(after.show_to_agent,false);assert.equal(after.is_pinned,true);assert.equal(after.category_slug,'health');
 // A change from the chat names no section: the fact stays in its own.
 env.domains.writeFact({attribute:'diagnosis',value:'Third fictional condition',source_type:'conversation'});
 after=env.store.get('fact_slots',slot.id);assert.equal(after.category_slug,'health');assert.equal(after.label,'Diagnosis');assert.equal(after.show_to_agent,false);assert.equal(after.is_pinned,true);
 assert.deepEqual(current(env.query,'diagnosis'),['Third fictional condition']);
 // What the owner sets explicitly still applies.
 env.domains.writeFact({label:'Diagnosis',attribute:'diagnosis',value:'Fourth fictional condition',is_pinned:false});assert.equal(env.store.get('fact_slots',slot.id).is_pinned,false);
});

test('the owner finds their own hidden notes; the assistant does not',async t=>{
 const env=fixture(t);
 const hidden=env.store.save('notes',{title:'Therapy',content:'Fictional private session about the rain sensor',ai_visibility:'hidden'});
 env.store.save('notes',{title:'Garden',content:'rain sensor install'});
 assert.deepEqual((await env.domains.invoke('search-notes-semantic',{query:'rain sensor',caller:'app',limit:20})).notes.map(n=>n.title).sort(),['Garden','Therapy']);
 assert.deepEqual((await env.domains.invoke('search-notes-semantic',{query:'rain sensor',limit:20})).notes.map(n=>n.title),['Garden']);
 env.domains.index={searchHybrid:async()=>({rows:[{type:'notes',id:hidden.id,score:1}],mode:'words'})};
 assert.deepEqual((await env.domains.invoke('search-notes-semantic',{query:'rain sensor',caller:'app'})).results.map(n=>n.title),['Therapy']);
 assert.deepEqual((await env.domains.invoke('search-notes-semantic',{query:'rain sensor'})).results,[]);
});

test('a private or sensitive group reaches no model',async t=>{
 const env=fixture(t,async()=>({briefing_markdown:'A fictional briefing'}));
 const group=(name,sensitivity)=>env.query.execute({table:'contact_groups',operation:'insert',values:{name,sensitivity}}).data[0];
 const secret=group('Fictional support circle','private'),touchy=group('Fictional family matters','sensitive'),open=group('Fictional book club','normal');
 const ben=env.store.save('contacts',{name:'Fictional Ben'});
 for(const g of [secret,touchy,open])env.query.execute({table:'contact_group_memberships',operation:'insert',values:{group_id:g.id,contact_id:ben.id}});
 assert.deepEqual(visibleRows(env.query,'contact_groups').map(g=>g.name),['Fictional book club']);
 assert.deepEqual(visibleRows(env.query,'contact_group_memberships').map(m=>m.group_id),[open.id]);
 for(const g of [secret,touchy])await assert.rejects(env.domains.invoke('generate-group-briefing',{group_id:g.id}),/hidden/);
 assert.equal((await env.domains.invoke('generate-group-briefing',{group_id:open.id})).briefing_markdown,'A fictional briefing');
});
