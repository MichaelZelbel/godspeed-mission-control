import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {Store,atomic,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {ApiKeys,toolScope} from '../core/api-keys.mjs';
import {backup,restore} from '../core/archives.mjs';
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-closure-'))),query=new QueryService(store);return {store,query};};
test('activity survives restart and derives create, edit and removal from durable history',()=>{
 const {store,query}=setup(),note=store.save('notes',{title:'Activity fixture',content:'Original'});store.save('notes',{id:note.id,content:'Changed'});store.structural('notes',note.id,'remove');
 const activity=new QueryService(new Store(store.root)).rows('activity_events').filter(r=>r.item_id===note.id);assert.deepEqual(activity.map(r=>r.action).sort(),['create','delete','update']);assert.equal(new Set(activity.map(r=>r.id)).size,3);
});
test('model reviews tolerate a legacy gap string and inference validates before changing the source',async()=>{
 const {store,query}=setup(),note=store.save('notes',{title:'Synthetic preferences',content:'Alex said "blue is my favorite".',metadata:{summary:'Owner summary'}});
 store.save('weekly_reviews',{review_data:{gaps:'No additional sources were supplied.'}});assert.deepEqual(query.rows('weekly_reviews')[0].review_data.gaps,['No additional sources were supplied.']);
 let invalid=false;
 const domains=new Domains(query,{provider:async input=>{
  if(input.kind==='classify-profile-fact')return {label:'Changed',value:'Changed',category_slug:'preferences'};
  assert.equal(input.source.id,note.id);return {metadata:{summary:'Inferred summary',type:'personal'},tags:['synthetic'],suggestions:[{type:'add_claim',payload:{label:'Color',value:'Blue'},evidence_quote:invalid?'Invented evidence':'Alex said "blue is my favorite".'}]};
 }});
 const proposal=await domains.invoke('classify-profile-fact',{label:'Reading time',value:'Evening'});assert.equal(proposal.label,'Reading time');assert.equal(proposal.value,'Evening');assert.equal(query.rows('claims').length,0);
 await domains.invoke('process-note',{note_id:note.id});assert.equal(store.get('notes',note.id).metadata.summary,'Owner summary');assert.equal(store.get('notes',note.id).metadata.type,'personal');assert.equal(query.rows('review_queue').length,1);
 const before=store.get('notes',note.id)._hash;invalid=true;await assert.rejects(domains.invoke('process-note',{note_id:note.id}),/absent/);assert.equal(store.get('notes',note.id)._hash,before);
});
test('groups retain their domain type, route slug and membership references through restart and briefing',async()=>{
 const {store,query}=setup(),group=query.execute({table:'contact_groups',operation:'insert',values:{name:'Synthetic reading circle',type:'community',stages:[{id:'active',label:'Active'}]}}).data[0],person=store.save('contacts',{name:'Synthetic reader'});
 query.execute({table:'contact_group_memberships',operation:'insert',values:{group_id:group.id,contact_id:person.id,status:'active'}});
 const restarted=new QueryService(new Store(store.root));assert.equal(restarted.execute({table:'contact_groups',filters:[['eq','slug',group.slug],['eq','is_trashed',false]]}).data[0].type,'community');
 const domains=new Domains(restarted,{provider:async input=>{assert.equal(input.members[0].contact_id,person.id);return {briefing_markdown:'The synthetic reader is active.'};}});
 const briefing=await domains.invoke('generate-group-briefing',{group_id:group.id});assert.ok(briefing.generated_at);assert.equal(restarted.rows('group_briefings')[0].briefing_markdown,'The synthetic reader is active.');assert.equal(restarted.store.problems.length,0);
});
test('corrupt disposable index recovers from durable Unicode notes and retains corrupt bytes',()=>{
 const {store}=setup();store.save('notes',{title:'Index recovery',content:'Grüße 日本語'});atomic(path.join(store.state,'search.sqlite'),'corrupt fixture');const index=new SearchIndex(store);assert.ok(index.recovered);assert.equal(index.search('日本語').length,1);assert.ok(fs.readdirSync(store.state).some(n=>n.startsWith('search.sqlite.corrupt-')));index.close();
});
test('optional account readers verify numeric balances and exact outward approvals cannot be replayed',async()=>{
 const {store,query}=setup();let posts=0;const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='POST'){posts++;res.end(JSON.stringify({id:'synthetic-receipt'}));}else res.end(JSON.stringify({credits:{remaining:4}}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const domains=new Domains(query),url='http://127.0.0.1:'+server.address().port;
 try{
  await domains.invoke('configure-connector',{name:'spend-guard',url,value_path:'credits.remaining',threshold:10,token:'synthetic'});const balance=await domains.invoke('run-connector',{name:'spend-guard'});assert.equal(balance.balance,4);assert.ok(balance.needs_attention);
  await domains.invoke('configure-connector',{name:'browser-post',url});const payload={text:'Synthetic test only'};await assert.rejects(domains.invoke('run-connector',{name:'browser-post',payload}),/approval/);assert.equal(posts,0);
  const approval=store.save('approvals',{title:'Synthetic delivery',status:'approved',intent_sha256:hash({name:'browser-post',payload}),expires_at:new Date(Date.now()+60000).toISOString()});assert.ok((await domains.invoke('run-connector',{name:'browser-post',payload,approval_id:approval.id})).verified);await assert.rejects(domains.invoke('run-connector',{name:'browser-post',payload,approval_id:approval.id}),/approval/);assert.equal(posts,1);
 }finally{await new Promise(r=>server.close(r));}
});
test('secret-bearing device backups are checked and restored only by explicit device recovery',()=>{
 const {store}=setup(),media=path.join(store.state,'media');fs.mkdirSync(media);store.save('notes',{content:'Synthetic recovery fixture'});atomic(path.join(store.state,'provider.json'),JSON.stringify({key:'synthetic-credential'}));const destination=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-')),'backup');backup(store,media,destination);
 const normal=setup().store;restore(normal,path.join(normal.state,'media'),destination);assert.ok(!fs.existsSync(path.join(normal.state,'provider.json')));
 const device=setup().store;restore(device,path.join(device.state,'media'),destination,{deviceConfig:true});assert.equal(JSON.parse(fs.readFileSync(path.join(device.state,'provider.json'))).key,'synthetic-credential');
 assert.equal(toolScope('save_record',{type:'settings'}),null);assert.equal(toolScope('save_record',{type:'api_keys'}),null);
});
