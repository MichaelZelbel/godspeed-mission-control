import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {toolScope} from '../core/api-keys.mjs';

// Mission Control's skills, routines and memory benchmark called Menerio's
// tools by name. The notebook answers the same names (server/memory-tools.mjs),
// so switching a caller is changing which server it talks to (6 October 2026).
async function setup(){
  let drafted;
  const provider=async input=>{drafted=input;return {draft:{title:'Fictional climbing trip',happened_at:'2026-10-12',status:'scheduled',participants:['Ani']}};};
  const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-memory-tools-')),port:0,provider});
  const base='http://127.0.0.1:'+service.address.port;
  const raw=async(name,args={})=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;};
  const call=async(name,args)=>{const result=await raw(name,args);assert.equal(result.isError,undefined,result.content[0].text);const text=result.content[0].text;try{return JSON.parse(text);}catch{return text;}};
  const refused=async(name,args)=>{const result=await raw(name,args);assert.equal(result.isError,true,'expected a refusal from '+name);return result.content[0].text;};
  const s=service.store;
  s.save('settings',{id:'installation',owner:'local',timezone:'Europe/Berlin'});
  const ana=s.save('contacts',{name:'Fictional Ana Example',aliases:['Ani'],relationship:'partner',company:'Fictional Climbing Gym'});
  const alex1=s.save('contacts',{name:'Fictional Alex One'}),alex2=s.save('contacts',{name:'Fictional Alex Two'});
  s.save('contacts',{name:'Fictional Hidden Person',ai_visibility:'hidden',relationship:'partner'});
  const note=s.save('notes',{title:'Climbing plans',content:'Ani wants to try the fictional north wall next spring.'});
  const lease=s.save('notes',{title:'Fictional lease',content:'See the attached PDF.'});
  s.save('note_chunks',{note_id:lease.id,chunk_index:1,content:'The fictional tenant pays 950 euros a month, notice period three months.',references:[{type:'notes',id:lease.id,uid:lease.uid,field:'note_id'}]});
  s.save('wiki_pages',{title:'Fictional bouldering',slug:'fictional-bouldering',page_type:'concept',content:'Bouldering is climbing without ropes on short walls.'});
  s.save('agent_instructions',{title:'Language',content:'Answer in German when written to in German.'});
  const books=s.save('collections',{name:'Fictional reading list',slug:'reading-list',field_schema:[{key:'title',label:'Title',type:'text',primary:true},{key:'status',label:'Status',type:'select',indexable:true,options:['to read','done']},{key:'finished',label:'Finished',type:'date',indexable:true}],agent_instructions:'One item per book.'});
  service.index.rebuild?.();
  return {service,call,refused,ana,alex1,alex2,note,lease,books,drafted:()=>drafted};
}

test('people are found by nickname, a shared name is refused with ids, and a hidden person stays hidden',async()=>{
  const {service,call,refused,ana,alex1,alex2}=await setup();
  try{
    const found=await call('search_contacts',{query:'ani'});
    assert.deepEqual(found.contacts.map(c=>c.contact_id),[ana.id]);
    assert.equal((await call('search_contacts',{relationship:'partner'})).contacts.length,1,'the hidden partner is left out');
    const text=await refused('get_contact_context',{name:'Fictional Alex'});
    assert.match(text,new RegExp(alex1.id));assert.match(text,new RegExp(alex2.id));
    const context=await call('get_contact_context',{name:'Ani'});
    assert.equal(context.contact.contact_id,ana.id);
    assert.deepEqual(context.related_notes.map(n=>n.title),['Climbing plans'],'a note naming her by nickname is hers');
    await refused('log_interaction',{contact_name:'Fictional Alex',type:'call'});
    const logged=await call('log_interaction',{contact_name:'Fictional Ana Example',type:'call',summary:'Talked about the wall'});
    assert.equal(service.store.get('contacts',ana.id).last_contact_date,logged.date);
    assert.equal((await call('get_contact_context',{contact_id:ana.id})).recent_interactions[0].summary,'Talked about the wall');
  }finally{await service.close();}
});

test('facts: a quote is required, an older value is closed, one the owner typed himself waits in his Review',async()=>{
  const {service,call,refused,ana}=await setup();
  try{
    assert.match(await refused('add_claim',{subject_type:'self',attribute:'lives-in',value:'Fictional Town'}),/evidence_quote/);
    await call('add_claim',{subject_type:'self',attribute:'lives-in',value:'Fictional Town',evidence_quote:'I live in Fictional Town now.',valid_from:'2026-01-01'});
    const moved=await call('add_claim',{subject_type:'self',attribute:'lives-in',value:'Fictional City',evidence_quote:'We moved to Fictional City.',valid_from:'2026-09-01'});
    assert.equal(moved.closed_earlier_values,1);
    assert.deepEqual((await call('get_claims',{subject_type:'self',attribute:'lives-in'})).claims.map(c=>c.value),['Fictional City']);
    assert.deepEqual((await call('get_claims',{subject_type:'self',attribute:'lives-in',mode:'history'})).claims.map(c=>c.value),['Fictional City','Fictional Town']);
    service.domains.writeFact({contact_id:ana.id,attribute:'favorite_food',label:'Favorite food',value:'Fictional soup',origin:'user_manual'});
    const waiting=await call('add_claim',{subject_type:'contact',subject_name:'Ani',attribute:'favorite_food',value:'Fictional pasta',evidence_quote:'Ani said she now loves fictional pasta.'});
    assert.equal(waiting.outcome,'waiting_for_review');
    assert.deepEqual((await call('get_contact_profile',{name:'Ani'})).sections.flatMap(s=>s.facts.map(f=>f.value)).filter(v=>/Fictional (soup|pasta)/.test(v)),['Fictional soup']);
    assert.ok(service.query.rows('review_queue').some(r=>r.payload?.value==='Fictional pasta'&&r.status==='pending_review'));
  }finally{await service.close();}
});

test('search_brain finds facts, notes (also through their documents) and Lexicon pages in one call',async()=>{
  const {service,call,lease}=await setup();
  try{
    await call('add_claim',{subject_type:'self',attribute:'climbing grade',value:'fictional 6a',evidence_quote:'I climb fictional 6a routes.'});
    const text=await call('search_brain',{query:'climbing'});
    assert.match(text,/\[claim\] you, climbing grade: fictional 6a/);assert.match(text,/Title: Climbing plans/);assert.match(text,/\[lexicon\] Fictional bouldering/);
    const lease950=await call('search_brain',{query:'notice period',include:['note']});
    assert.match(lease950,new RegExp('ID: '+lease.id));assert.match(lease950,/Found in: attached document/);
    const notes=await call('search_notes',{query:'notice period'});
    assert.deepEqual(notes.map(n=>n.id),[lease.id]);
  }finally{await service.close();}
});

test('profile, recent notes, stats, trash and restore',async()=>{
  const {service,call,ana,note}=await setup();
  try{
    await call('add_claim',{subject_type:'self',attribute:'home town',value:'Fictional Town',evidence_quote:'I grew up in Fictional Town.'});
    const profile=await call('get_user_profile',{detail:'full'});
    assert.deepEqual(profile.relationships.structured.map(r=>r.contact_id),[ana.id]);
    assert.deepEqual(profile.agent_instructions.map(i=>i.instruction),['Answer in German when written to in German.']);
    assert.ok(profile.profile.categories.some(c=>c.entries.some(e=>e.value==='Fictional Town')));
    assert.match(await call('list_recent_notes',{person:'Ani'}),/Climbing plans/);
    assert.equal((await call('get_stats')).notes,2);
    await call('trash_note',{note_id:note.id});assert.equal(service.store.get('notes',note.id).is_trashed,true);
    await call('trash_note',{note_id:note.id,restore:true});assert.equal(service.store.get('notes',note.id).is_trashed,false);
  }finally{await service.close();}
});

test('collections: schema, add (unknown fields refused), filter, update and search across all',async()=>{
  const {service,call,refused}=await setup();
  try{
    assert.deepEqual((await call('list_collections')).map(c=>[c.slug,c.agent_instructions]),[['reading-list','One item per book.']]);
    assert.deepEqual((await call('get_collection_schema',{slug:'reading-list'})).field_schema.map(f=>f.key),['title','status','finished']);
    assert.match(await refused('add_collection_item',{collection_slug:'reading-list',data:{author:'Nobody'}}),/Unknown field author/);
    const added=await call('add_collection_item',{collection_slug:'reading-list',data:{title:'Fictional Atlas',status:'to read'}});
    await call('add_collection_item',{collection_slug:'reading-list',data:{title:'Fictional Ocean',status:'done',finished:'2026-09-30'}});
    assert.equal(added.title,'Fictional Atlas');
    assert.deepEqual((await call('list_collection_items',{collection_slug:'reading-list',status:'to read'})).items.map(i=>i.title),['Fictional Atlas']);
    assert.deepEqual((await call('list_collection_items',{collection_slug:'reading-list',search:'fictional -ocean'})).items.map(i=>i.title),['Fictional Atlas']);
    await call('update_collection_item',{item_id:added.item_id,data:{status:'done'}});
    assert.equal(service.store.get('collection_items',added.item_id).data.title,'Fictional Atlas','fields not given stay');
    assert.equal((await call('list_collection_items',{collection_slug:'reading-list',status:'done'})).total,2);
    assert.deepEqual((await call('search_all_collections',{query:'atlas'})).map(i=>i.collection_slug),['reading-list']);
  }finally{await service.close();}
});

test('a timeline entry from a plain description, with its people resolved by nickname',async()=>{
  const {service,call,ana,drafted}=await setup();
  try{
    const made=await call('create_moment_with_ai',{description:'Climbing trip with Ani next Monday',participant_names:['Fictional Stranger']});
    assert.equal(made.happened_at,'2026-10-12');assert.equal(made.status,'future_plan');assert.deepEqual(made.participants,['Fictional Ana Example']);assert.deepEqual(made.not_in_people,['Fictional Stranger']);
    assert.ok(JSON.stringify(drafted().input).includes('Climbing trip with Ani'));
    assert.ok(service.query.rows('moment_participants').some(p=>p.moment_id===made.moment_id&&p.person_id===ana.id));
    assert.deepEqual((await call('search_moments',{query:'climbing trip'})).map(m=>m.moment_id),[made.moment_id]);
  }finally{await service.close();}
});

test('every tool has the key permission a caller expects, and records that had none now do',()=>{
  for(const [name,scope] of [['search_brain','notes'],['get_user_profile','profile'],['search_contacts','contacts'],['log_interaction','contacts'],['add_claim','world'],['get_claims','world'],['add_collection_item','collections'],['get_stats','stats']])assert.equal(toolScope(name,{}),scope,name);
  // Until 6 October 2026 these record types had no permission at all, so every key was refused them.
  for(const [type,scope] of [['goals','actions'],['work_items','actions'],['deadlines','actions'],['habits','actions'],['wiki_pages','notes']])assert.equal(toolScope('list_records',{type}),scope,type);
});

test('Mission Control\'s own files are searched with the notes and read whole; the prompt archive never',async()=>{
  const {service,call}=await setup();
  try{
    const root=service.store.root;
    fs.mkdirSync(path.join(root,'world','claims'),{recursive:true});fs.writeFileSync(path.join(root,'world','claims','michael--fictional-handle.md'),'---\nkind: claim\n---\nMichael\'s Fictional Social handle is @fictional.example since 2026-09-03.\n');
    fs.mkdirSync(path.join(root,'prompts','archive'),{recursive:true});fs.writeFileSync(path.join(root,'prompts','archive','fictional.jsonl'),'{"text":"what is my Fictional Social handle"}\n');
    // Folders Menerio searched as copies are searched too; the benchmark's questions and run logs are not.
    fs.mkdirSync(path.join(root,'archives','references'),{recursive:true});fs.writeFileSync(path.join(root,'archives','references','fictional-partner.md'),'Fictional partner portal user FICT-12345 for the Fictional Social handle account.\n');
    for(const folder of [['routines','memory-bench','kyo'],['routines','briefing','runs','x']]){fs.mkdirSync(path.join(root,...folder),{recursive:true});fs.writeFileSync(path.join(root,...folder,'answers.jsonl'),'{"gold":"the Fictional Social handle is @fictional.example"}\n');}
    service.index.rebuild();
    const text=await call('search_brain',{query:'Fictional Social handle',include:['note']});
    assert.match(text,/ID: world\/claims\/michael--fictional-handle\.md/);assert.doesNotMatch(text,/prompts\//);
    assert.match(text,/archives\/references\/fictional-partner\.md/);assert.doesNotMatch(text,/memory-bench|\/runs\//);
    assert.match((await call('get_note',{note:'world/claims/michael--fictional-handle.md'})).content,/@fictional\.example/);
    assert.equal((await call('search_notes',{query:'Fictional Social handle',source:'native'})).length,0,'native means the owner\'s own notes only');
  }finally{await service.close();}
});
