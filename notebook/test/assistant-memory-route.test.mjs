import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {visibleRows} from '../core/visibility.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// The starter's operating manual (starter-godspeed/AGENTS.md, "My notebook") tells an
// assistant to keep people, facts and events in the notebook with these tool calls, so
// what the reader files in the chat is what People, My Profile, World and Timeline show
// (Teach It Once, Chapters 4, 6, 10 and 14). Until 8 October 2026 it sent them to
// profile/people.md and world/, which no screen of the notebook shows. This runs the
// calls the manual names, as an assistant makes them, and reads the result back the way
// the screens do.
async function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-memory-route-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,port:0});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});delete process.env.GODSPEED_ASSISTANT_CONFIG;});
  service.store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
  const base='http://127.0.0.1:'+service.address.port;
  const raw=async(name,args={})=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;};
  const call=async(name,args)=>{const result=await raw(name,args);assert.equal(result.isError,undefined,name+': '+result.content[0].text);const text=result.content[0].text;try{return JSON.parse(text);}catch{return text;}};
  return {service,call,query:service.query,root};
}
const one=value=>Array.isArray(value)?value[0]:value;

test('"my sister Jo moved to Lisbon in March": one page for Jo, the fact on it with its day and source, nothing in the files',async t=>{
  const {call,query,root}=await setup(t);
  assert.equal((await call('search_contacts',{query:'Jo'})).count,0,'searched first: nobody yet');
  const jo=one(await call('save_record',{type:'contacts',value:{name:'Jo',relationship:'sister',notes:'Prefers a call to email.'}}));
  const fact=await call('add_claim',{subject_type:'contact',subject_id:jo.id,attribute:'lives-in',value:'Lisbon',evidence_quote:'my sister Jo moved to Lisbon in March',valid_from:'2026-03-01'});
  assert.equal(fact.outcome,'inserted');
  // Her page: the person, how she is related, and the fact with its day and its words.
  const found=await call('search_contacts',{query:'Jo'});
  assert.deepEqual(found.contacts.map(c=>[c.name,c.relationship]),[['Jo','sister']]);
  const page=await call('get_contact_profile',{contact_id:jo.id});
  const lives=page.sections.flatMap(s=>s.facts).find(f=>f.attribute==='lives-in');
  assert.equal(lives.value,'Lisbon');assert.equal(lives.valid_from,'2026-03-01');assert.match(lives.evidence_quote,/moved to Lisbon in March/);
  // What the People and World screens read (query.mjs: contacts, profile_facts, world_claims).
  assert.ok(query.rows('contacts').some(c=>c.id===jo.id&&c.name==='Jo'));
  assert.ok(query.rows('world_claims').some(c=>c.subject_id===jo.id&&c.value==='Lisbon'&&c.valid_from==='2026-03-01'));
  // Asked again, nobody is made twice: the search finds her.
  assert.equal((await call('search_contacts',{query:'jo'})).contacts.length,1);
  // Nothing went to a plain file the notebook does not show.
  assert.equal(fs.existsSync(path.join(root,'world','claims'))&&fs.readdirSync(path.join(root,'world','claims')).length,false);
  assert.equal(fs.existsSync(path.join(root,'profile','people.md'))&&/Jo/.test(fs.readFileSync(path.join(root,'profile','people.md'),'utf8')),false);
});

test('a fact about the owner goes on My Profile, and a dated new value ends the old one, which stays as history',async t=>{
  const {call,query}=await setup(t);
  await call('add_claim',{subject_type:'self',attribute:'lives-in',value:'Krefeld',evidence_quote:'I live in Krefeld, it says in my briefing',valid_from:'2020-01-01'});
  const moved=await call('add_claim',{subject_type:'self',attribute:'current-city',value:'Bristol',evidence_quote:'I moved to Bristol in June',valid_from:'2026-06-01'});
  assert.equal(moved.closed_earlier_values,1,'the old city ends on the day of the new one');
  const profile=await call('get_user_profile',{detail:'full'});
  const values=profile.profile.categories.flatMap(c=>c.entries).map(e=>e.label+': '+e.value);
  assert.ok(values.some(v=>/Bristol/.test(v)));assert.ok(!values.some(v=>/Krefeld/.test(v)),'only the current value is on the page');
  const history=await call('get_claims',{subject_type:'self',attribute:'lives-in',mode:'history'});
  assert.deepEqual(history.claims.map(c=>[c.value,c.valid_from,c.valid_to]),[['Bristol','2026-06-01',null],['Krefeld','2020-01-01','2026-06-01']]);
  // My Profile reads the owner's facts as profile_facts.
  assert.ok(query.rows('profile_facts').some(f=>f.subject_type==='self'&&f.value==='Bristol'&&f.is_current));
});

test('the assistant\'s own conclusion waits in Review and is no fact until it is kept',async t=>{
  const {service,call,query}=await setup(t);
  const nadia=one(await call('save_record',{type:'contacts',value:{name:'Nadia',relationship:'client'}}));
  await call('add_claim',{subject_type:'contact',subject_id:nadia.id,attribute:'budget-next-year',value:'doubled',evidence_quote:'Nadia said today the budget for next year\'s book has doubled.'});
  const suggestion=one(await call('save_record',{type:'review_queue',value:{title:'Nadia may offer a second book',suggestion_type:'add_claim',description:'She hinted there could be a second illustrated title.',payload:{subject_type:'contact',contact_id:nadia.id,label:'Possible second book',value:'may offer a second illustrated title'}}}));
  assert.equal(suggestion.status,'pending_review');
  assert.ok(!query.rows('claims').some(c=>/second/.test(c.value)),'not a fact while it waits');
  await service.domains.invoke('review-queue-bulk',{action:'keep',ids:[suggestion.id]});
  assert.ok(query.rows('claims').some(c=>c.subject_id===nadia.id&&/second/.test(c.value)),'kept, it is on her page');
});

test('an event goes on the timeline with the person in it, and a talk is logged on their page',async t=>{
  const {call,query}=await setup(t);
  const mum=one(await call('save_record',{type:'contacts',value:{name:'Mum',relationship:'mother'}}));
  const moment=await call('create_moment_with_ai',{description:'Mum had her knee operation today.',title_hint:'Mum\'s knee operation',happened_at:'2026-10-08',participant_names:['Mum']});
  assert.deepEqual(moment.participants,['Mum']);
  assert.ok(query.rows('world_events').some(e=>e.id===moment.moment_id&&e.happened_at==='2026-10-08'),'the Timeline shows it');
  const talk=await call('log_interaction',{contact_id:mum.id,type:'call',summary:'Talked about the operation.'});
  assert.equal(talk.contact_id,mum.id);
  assert.ok(query.rows('contact_interactions').some(i=>i.contact_id===mum.id));
});

test('a new name is the same person, so what was linked to her still leads to her page',async t=>{
  const {call,query}=await setup(t);
  const anna=one(await call('save_record',{type:'contacts',value:{name:'Anna Schmidt',relationship:'neighbour'}}));
  const note=one(await call('save_record',{type:'notes',value:{title:'Book club',content:'Anna recommended a novel.'}}));
  await call('save_record',{type:'person_documents',value:{contact_id:anna.id,note_id:note.id}});
  const [current]=await call('list_records',{type:'contacts',filters:[['eq','id',anna.id]]});
  await call('structural_change',{type:'contacts',id:anna.id,action:'display-name',expected_hash:current._hash,options:{name:'Anna Weber'}});
  const context=await call('get_contact_context',{name:'Anna Weber'});
  assert.equal(context.contact.contact_id,anna.id);
  assert.deepEqual(context.related_notes.map(n=>n.note_id),[note.id]);
  assert.equal(query.rows('contacts').filter(c=>/Anna/.test(c.name)).length,1,'one person, not two');
});

test('asked for the link to the notebook, the assistant gets the address this machine opens it at',async t=>{
  const {service,call}=await setup(t);
  const answer=await call('get_notebook_link',{});
  if(!fs.existsSync('/.dockerenv')&&!fs.existsSync('/run/godspeed-vps-hostname'))assert.equal(answer.link,'http://127.0.0.1:'+service.address.port+'/dashboard');
  assert.equal(typeof answer.opens,'string');
});

test('removed when the owner asks, the person leaves People and what the assistant is given',async t=>{
  const {call,query}=await setup(t);
  const old=one(await call('save_record',{type:'contacts',value:{name:'Old Colleague'}}));
  const [current]=await call('list_records',{type:'contacts',filters:[['eq','id',old.id]]});
  await call('structural_change',{type:'contacts',id:old.id,action:'remove',expected_hash:current._hash});
  assert.ok(!query.rows('contacts').some(c=>c.id===old.id));
  assert.ok(!visibleRows(query,'contacts').some(c=>c.id===old.id));
  assert.equal((await call('search_contacts',{query:'Old Colleague'})).count,0);
});
