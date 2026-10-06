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
  assert.equal((input.note||input.source).id,note.id);return {metadata:{summary:'Inferred summary',type:'observation'},tags:['synthetic'],suggestions:[{type:'add_claim',payload:{label:'Color',value:'Blue'},evidence_quote:invalid?'Invented evidence':'Alex said "blue is my favorite".'}]};
 }});
 const proposal=await domains.invoke('classify-profile-fact',{label:'Reading time',value:'Evening'});assert.equal(proposal.label,'Reading time');assert.equal(proposal.value,'Evening');assert.equal(query.rows('claims').length,0);
 await domains.invoke('process-note',{note_id:note.id});assert.equal(store.get('notes',note.id).metadata.summary,'Owner summary');assert.equal(store.get('notes',note.id).metadata.type,'observation');assert.equal(query.rows('review_queue').length,1);
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
test('user-state backups exclude device credentials even when recovery asks for device settings',()=>{
 const {store}=setup(),media=path.join(store.state,'media');fs.mkdirSync(media);store.save('notes',{content:'Synthetic recovery fixture'});atomic(path.join(store.state,'provider.json'),JSON.stringify({key:'synthetic-credential'}));const destination=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-')),'backup');backup(store,media,destination);
 const normal=setup().store;restore(normal,path.join(normal.state,'media'),destination);assert.ok(!fs.existsSync(path.join(normal.state,'provider.json')));
 assert.ok(!fs.existsSync(path.join(destination,'device-config')));
 const device=setup().store;restore(device,path.join(device.state,'media'),destination,{deviceConfig:true});assert.ok(!fs.existsSync(path.join(device.state,'provider.json')));assert.equal(device.list('notes')[0].content,'Synthetic recovery fixture');
 assert.equal(toolScope('save_record',{type:'settings'}),null);assert.equal(toolScope('save_record',{type:'api_keys'}),null);
});
test('a backup counts its captured records rather than later scheduled writes',()=>{
 const {store}=setup(),media=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-snapshot-media-'));
 store.save('notes',{title:'Snapshot source',content:'Before the snapshot'});
 const destination=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-snapshot-')),'backup'),copy=fs.cpSync;
 // Since 6 October 2026 media is copied after the snapshot, without the writer
 // lock: a save then goes through, and is not in this backup.
 fs.cpSync=(source,target,options)=>{const result=copy(source,target,options);if(source===media)store.save('notes',{title:'Concurrent result',content:'Saved after the snapshot'});return result;};
 try{backup(store,media,destination);}finally{fs.cpSync=copy;}
 store.save('notes',{title:'Later scheduled result',content:'After the captured records'});
 const manifest=JSON.parse(fs.readFileSync(path.join(destination,'backup.json'))),snapshot=new Store(destination);
 assert.equal(manifest.records,snapshot.records.size);assert.ok(store.records.size>snapshot.records.size);
 const restored=setup().store;restore(restored,path.join(restored.state,'media'),destination);
 assert.equal(restored.list('notes').length,1);assert.equal(restored.list('notes')[0].content,'Before the snapshot');
});
