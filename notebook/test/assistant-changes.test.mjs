import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

// What the assistant changes is checked whole and saved whole, and only in the
// fields and records it is for (review of 6 October 2026).
const fixture=(t,provider=null)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-domain-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query,{provider});return {root,store,query,domains};};

test('conversation operations are checked together and saved together, so a retry is never stuck',async t=>{
 const message='Add a goal called Fictional fitness and remind me to renew the fictional permit by Friday';let calls=0,due='2026-10-09';
 const env=fixture(t,async()=>{calls++;return {reply:'Done.',operations:[{type:'goal-add',title:'Fictional fitness',measure:'runs',source_quote:message},{type:'obligation-add',title:'Renew fictional permit',due_at:due,source_quote:message}]};});
 await assert.rejects(env.domains.invoke('conversation-chat',{message,conversation_id:'c1',request_id:'r1'}),/timezone/);
 assert.equal(calls,2,'the model was asked once to correct it');assert.deepEqual(env.query.rows('goals').map(g=>g.title),[]);assert.deepEqual(env.store.list('deadlines').map(d=>d.title),[]);
 due='2026-10-09T17:00:00+02:00';
 const result=await env.domains.invoke('conversation-chat',{message,conversation_id:'c1',request_id:'r1'});
 assert.equal(result.operation_results.length,2);assert.deepEqual(env.query.rows('goals').map(g=>g.title),['Fictional fitness']);assert.deepEqual(env.store.list('deadlines').map(d=>d.title),['Renew fictional permit']);
 // A model that corrects itself on the second try gets both saved.
 let tries=0;const repaired=fixture(t,async()=>{tries++;return {reply:'Done.',operations:[{type:'goal-add',title:'Fictional fitness',measure:'runs',source_quote:message},{type:'obligation-add',title:'Renew fictional permit',due_at:tries===1?'2026-10-09':'2026-10-09T17:00:00Z',source_quote:message}]};});
 await repaired.domains.invoke('conversation-chat',{message,conversation_id:'c2',request_id:'r2'});
 assert.equal(tries,2);assert.equal(repaired.query.rows('goals').length,1);assert.equal(repaired.store.list('deadlines').length,1);
});

test('collection chat saves all of its changes or none',async t=>{
 const env=fixture(t,async({kind})=>kind!=='collection-chat'?{terms:[]}:{reply:'Added three books.',items_created:[{data:{name:'Book A'}},{data:{name:'Book B'}},{data:{name:'Book C',pages:'many'}}]});
 const col=env.store.save('collections',{name:'Books',field_schema:[{key:'name',label:'Name',type:'text',primary:true},{key:'pages',label:'Pages',type:'number'}]});
 await assert.rejects(env.domains.invoke('collection-chat',{collection_id:col.id,message:'Add Book A, Book B and Book C'}),/number/);
 assert.deepEqual(env.query.rows('collection_items').map(i=>i.title),[]);
 env.domains.provider=async({kind})=>kind!=='collection-chat'?{terms:[]}:{reply:'Added two books.',items_created:[{data:{name:'Book A'}},{data:{name:'Book B',pages:120}}]};
 const result=await env.domains.invoke('collection-chat',{collection_id:col.id,message:'Add Book A and Book B'});
 assert.deepEqual(env.query.rows('collection_items').map(i=>i.title).sort(),['Book A','Book B']);assert.equal(result.tool_results.length,2);
});

test('media analysis saves only its own fields on its own row',async t=>{
 const env=fixture(t,async()=>({id:'other-analysis',note_id:'other-note',storage_path:'elsewhere.png',analysis_status:'failed',description:'d',extracted_text:'t',topics:['x'],pages:[]}));
 const media=path.join(env.root,'media');fs.mkdirSync(media,{recursive:true});env.domains.mediaRoot=media;
 const bytes=Buffer.from('fake png bytes');fs.writeFileSync(path.join(media,'img.png'),bytes);
 fs.writeFileSync(path.join(media,hash('uploads/img.png')+'.mapping.json'),JSON.stringify({file:'img.png',sha256:hash(bytes),contentType:'image/png'}));
 env.store.save('media_analysis',{id:'other-analysis',note_id:'n2',storage_path:'uploads/other.png',description:'unrelated analysis',analysis_status:'complete'});const other=env.store.get('media_analysis','other-analysis');
 const note=env.store.save('notes',{title:'Photo note',content:'x'});
 await env.domains.invoke('analyze-media',{note_id:note.id,storage_path:'uploads/img.png',media_type:'image'});
 const after=env.store.get('media_analysis','other-analysis');assert.equal(after.description,'unrelated analysis');assert.equal(after.storage_path,'uploads/other.png');assert.equal(after._hash,other._hash);
 const own=env.query.rows('media_analysis').find(r=>r.storage_path==='uploads/img.png');assert.equal(own.analysis_status,'complete');assert.equal(own.note_id,note.id);assert.equal(own.description,'d');assert.deepEqual(own.topics,['x']);
});
