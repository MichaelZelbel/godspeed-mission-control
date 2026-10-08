import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {fieldList,mergeFields,DEFAULT_FIELDS} from '../core/fields.mjs';
import {closeFacts,supersededValues,endedRelationships,setValidTo,FactClosing} from '../core/fact-closing.mjs';
import {frontMatter} from '../core/world-facts.mjs';
import {visibleRows} from '../core/visibility.mjs';

// One fixed name per kind of fact, for every notebook, not only the one whose
// mission control has world/fields.json (D-298, 8 October 2026). The data here
// is as messy as Michael's was: "where he lives" under location, current-city
// and "Current City"; undated imported values; the same fact in the notebook
// and in a world file; an "ex" newer than two undated "partner" entries; a
// value with a comma in it; imported facts no assistant may change.

const tmp=(t,prefix)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const worldFile=(root,folder,name,fields,body='fixture',nl='\n')=>{const p=path.join(root,'world',folder,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,['---',...Object.entries(fields).map(([k,v])=>k+': '+(Array.isArray(v)?'['+v.join(', ')+']':v)),'---','',body,''].join(nl));return p;};
const meta=p=>frontMatter(fs.readFileSync(p,'utf8')).fields;
const offline=(t,device='local')=>{const root=tmp(t,'godspeed-fields-');const store=new Store(root,{device}),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',owner:'local',timezone:'UTC'});return {root,store,query,domains};};
const currentOf=(query,subject,kind)=>{const fields=fieldList(query.store.root),day=new Date().toISOString().slice(0,10);return query.rows('claims').filter(c=>c.subject_type===subject.type&&(c.subject_id||null)===(subject.id||null)&&fields.canonical(c.attribute)===kind&&!c.removed_at&&(!c.valid_to||c.valid_to>day)).map(c=>c.value).sort();};
async function service(t){
  // Closed before its folder is removed: Windows keeps an open search index locked.
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-fields-service-'));
  const svc=await createService({root,port:0,provider:async()=>({})});t.after(async()=>{await svc.close();fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+svc.address.port;
  const raw=async(name,args={})=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return (await r.json()).result;};
  const call=async(name,args)=>{const result=await raw(name,args);assert.equal(result.isError,undefined,result.content[0].text);const text=result.content[0].text;try{return JSON.parse(text);}catch{return text;}};
  svc.store.save('settings',{id:'installation',owner:'local',timezone:'Europe/Berlin'});
  return {root,svc,call,raw,store:svc.store,query:svc.query};
}
const claimsOf=text=>text.split('\n\n').filter(b=>b.startsWith('[claim]'));

test('the notebook ships the list: a fresh install without world/fields.json knows the kinds and their names',t=>{
  const root=tmp(t,'godspeed-fields-list-'),fields=fieldList(root);
  assert.equal(fs.existsSync(path.join(root,'world','fields.json')),false);
  for(const name of ['location','current-city','Current City','current_city','CITY','Wohnort'])assert.equal(fields.canonical(name),'lives-in',name);
  assert.equal(fields.one('location'),true);assert.equal(fields.one('hobby'),false);assert.equal(fields.one('E-Mail'),false);
  assert.equal(fields.one('favourite-tea'),undefined,'a kind the list does not name is left as it is');
  assert.equal(fields.canonical('Favourite Tea'),'favourite-tea');
  assert.equal(fields.canonical('occupation'),'occupation','what someone does is not their job title');
  assert.ok(fields.promptLines().includes('lives-in (one at a time): the town or city someone lives in now'));
  assert.ok(fields.promptLines().includes('hobbies: a hobby'));
  assert.deepEqual(fields.asked('Where do I live?'),['lives-in']);
  assert.deepEqual(fields.asked('When is her birthday?'),['date-of-birth']);
  assert.deepEqual(fields.asked('What is my current weight?'),['current-weight'],'"current" names too many kinds to name one');
  assert.deepEqual(fields.asked('What did we talk about yesterday?'),[]);
});

test('a workspace list is read over the shipped one: its entries win and the aliases merge',t=>{
  const root=tmp(t,'godspeed-fields-merge-');
  fs.mkdirSync(path.join(root,'world'),{recursive:true});
  fs.writeFileSync(path.join(root,'world','fields.json'),'﻿'+JSON.stringify({fields:[
    {name:'lives-in',one:true,says:'where they live',aliases:['Hometown']},
    {name:'hobbies',one:true,aliases:['pastime']},
    {name:'home-town',one:true,says:'where someone grew up',aliases:['city']},
    {name:'favourite-tea',one:false,aliases:['tea']}]}));
  const fields=fieldList(root);
  assert.equal(fields.canonical('hometown'),'lives-in','the workspace\'s alias');
  assert.equal(fields.canonical('current-city'),'lives-in','the shipped aliases stay');
  assert.equal(fields.canonical('city'),'home-town','an alias the workspace gives another kind leaves lives-in');
  assert.equal(fields.one('hobby'),true,'the workspace decides one or many');
  assert.equal(fields.canonical('pastime'),'hobbies');assert.equal(fields.canonical('hobby'),'hobbies');
  assert.equal(fields.canonical('tea'),'favourite-tea');assert.equal(fields.one('tea'),false);
  assert.ok(fields.promptLines().includes('lives-in (one at a time): where they live'));
  assert.equal(fields.canonical('email-address'),'email','a shipped kind the workspace does not name is kept');
  // A workspace entry named by a shipped kind's alias takes that kind over, with its names.
  const merged=mergeFields(DEFAULT_FIELDS,[{name:'weight',aliases:['current-weight']}]);
  const weight=merged.find(k=>k.name==='weight');
  assert.equal(weight.one,true,'one or many comes from the kind it took over when the workspace does not say');
  assert.ok(weight.aliases.includes('body-weight')&&weight.aliases.includes('gewicht'));
  assert.equal(merged.some(k=>k.name==='current-weight'),false);
});

// The acceptance case of 8 October 2026.
test('a fresh notebook: "location" then "current-city" for the same person is one current value, and "where do I live" finds it',async t=>{
  const {call,store,query,root}=await service(t);
  assert.equal(fs.existsSync(path.join(root,'world','fields.json')),false,'no list in the workspace');
  const first=await call('add_claim',{subject_type:'self',attribute:'location',value:'Fictional Old Town',evidence_quote:'I live in Fictional Old Town.',valid_from:'2026-03-01'});
  assert.equal(first.attribute,'lives-in');
  const moved=await call('add_claim',{subject_type:'self',attribute:'Current City',value:'Fictional New Town',evidence_quote:'We moved to Fictional New Town.',valid_from:'2026-09-01'});
  assert.equal(moved.attribute,'lives-in');assert.equal(moved.closed_earlier_values,1);
  assert.deepEqual(currentOf(query,{type:'self'},'lives-in'),['Fictional New Town'],'one current value in what is stored');
  assert.deepEqual(query.rows('claims').filter(c=>c.subject_type==='self').map(c=>c.attribute),['lives-in','lives-in'],'both filed under the fixed name');
  const asked=await call('search_brain',{query:'Where do I live?'});
  const found=claimsOf(asked);
  assert.match(found[0]||'',/Fictional New Town/,asked);
  assert.doesNotMatch(found.join('\n'),/Fictional Old Town/,'the old value is history');
  const german=claimsOf(await call('search_brain',{query:'Wo ist mein Wohnort?',include:['claim']}));
  assert.match(german[0]||'',/Fictional New Town/);
  assert.deepEqual((await call('get_claims',{subject_type:'self',attribute:'location'})).claims.map(c=>c.value),['Fictional New Town'],'asked by an old name');
  // The same for a person, by a nickname.
  const ana=store.save('contacts',{name:'Fictional Ana Example',aliases:['Ani']});
  await call('add_claim',{subject_type:'contact',subject_name:'Ani',attribute:'location',value:'Fictional Harbour',evidence_quote:'Ani lives in Fictional Harbour.',valid_from:'2026-02-01'});
  await call('add_claim',{subject_type:'contact',subject_name:'Ani',attribute:'current-city',value:'Fictional Hills',evidence_quote:'Ani moved to Fictional Hills.',valid_from:'2026-08-01'});
  assert.deepEqual(currentOf(query,{type:'contact',id:ana.id},'lives-in'),['Fictional Hills']);
  assert.match(claimsOf(await call('search_brain',{query:'Where does Ani live?'}))[0]||'',/Fictional Ana Example, .*Fictional Hills/);
});

test('imported values under old names: the newest is read at once, what an assistant may change ends at once, the rest ends at the daily closing',async t=>{
  const {call,store,query,root}=await service(t);
  // As the Menerio import left them: undated, mixed-case names, no setting row (so no
  // assistant may change them), one with a setting row an assistant may.
  const hidden=store.save('claims',{subject_type:'self',subject_id:null,attribute:'Current city',value:'Fictional Import Town',valid_from:null,valid_to:null,origin:'ai_note',confidence:'likely',cardinality:'many'});
  const shown=store.save('claims',{subject_type:'self',subject_id:null,attribute:'home-city',value:'Fictional Shown Town',valid_from:'2025-05-05',valid_to:null,origin:'ai_note'});
  store.save('fact_slots',{subject_type:'self',subject_id:null,attribute:'home-city',label:'Home city',show_to_agent:true,cardinality:'many'});
  // And the same kind in a Mission Control world file, from the other store.
  worldFile(root,'entities','owner.md',{slug:'owner',name:'Fictional Owner',self:'true'});
  const file=worldFile(root,'claims','owner--location--undated.md',{subject:'owner',attribute:'location',value:'Fictional File Town',origin:'menerio'},'Kept from the old import.','\r\n');
  const added=await call('add_claim',{subject_type:'self',attribute:'lives-in',value:'Fictional New Town',evidence_quote:'I live in Fictional New Town now.',valid_from:'2026-10-01'});
  assert.equal(added.outcome,'inserted','an imported value the assistant may not change does not stop the new one');
  assert.equal(added.closed_earlier_values,1,'the one it may change ends at once');
  assert.equal(store.get('claims',shown.id).valid_to,'2026-10-01');
  assert.equal(store.get('claims',hidden.id).valid_to??null,null,'the one it may not see stays as it is');
  assert.deepEqual((await call('get_claims',{subject_type:'self',attribute:'location'})).claims.map(c=>c.value),['Fictional New Town'],'and is read as ended already');
  const result=await closeFacts({store,query});
  assert.equal(store.get('claims',hidden.id).valid_to,'2026-10-01','the daily closing ends it');
  assert.equal(store.get('claims',hidden.id).closure_evidence.source_type,'claim');
  assert.equal(meta(file).valid_to,'2026-10-01','and the world file');
  const text=fs.readFileSync(file,'utf8');
  assert.match(text,/\r\nvalid_to: 2026-10-01\r\n/,'written in the file\'s own line endings');
  assert.match(text,/Kept from the old import\./,'its text stays');
  assert.deepEqual(result.files,['world/claims/owner--location--undated.md']);
  assert.deepEqual(currentOf(query,{type:'self'},'lives-in'),['Fictional New Town']);
  const again=await closeFacts({store,query});
  assert.equal(again.values.length+again.relationships.length,0,'a second run finds nothing');
});

// On 8 October 2026, 102 of Michael's notebook facts sat under a fixed name (hobbies,
// job-title, topic-of-interest) with no "show to assistants" setting, as the import left
// them. add_claim used to file "job title" as job_title beside them; filed as job-title,
// a hidden value under the same name must neither refuse the write nor be revealed by it.
test('an assistant\'s write is not refused or answered by a fact hidden from it under the same fixed name',async t=>{
  const {call,store,query}=await service(t);
  const hobby=store.save('claims',{subject_type:'self',subject_id:null,attribute:'hobbies',value:'fictional knitting',valid_from:null,origin:'ai_note'});
  const job=store.save('claims',{subject_type:'self',subject_id:null,attribute:'job-title',value:'Fictional Consultant',valid_from:'2025-01-01',origin:'ai_note'});
  const more=await call('add_claim',{subject_type:'self',attribute:'hobby',value:'fictional climbing',evidence_quote:'I started fictional climbing.'});
  assert.equal(more.outcome,'inserted');
  assert.deepEqual(currentOf(query,{type:'self'},'hobbies'),['fictional climbing','fictional knitting'],'a second hobby beside the hidden one');
  const changed=await call('add_claim',{subject_type:'self',attribute:'Job Title',value:'Fictional Architect',evidence_quote:'I am a Fictional Architect now.',valid_from:'2026-09-09'});
  assert.equal(changed.outcome,'inserted');assert.equal(changed.closed_earlier_values,0);
  assert.equal(store.get('claims',job.id).valid_to??null,null,'the hidden one is not changed by the assistant');
  assert.deepEqual((await call('get_claims',{subject_type:'self',attribute:'job'})).claims.map(c=>c.value),['Fictional Architect'],'but read as ended at once');
  await closeFacts({store,query});
  assert.equal(store.get('claims',job.id).valid_to,'2026-09-09','and ended by the daily closing');
  assert.equal(store.get('claims',hobby.id).valid_to??null,null,'a hobby never');
  // Writing exactly the hidden value: a new fact, not "already recorded" with the hidden one's id.
  const name=store.save('claims',{subject_type:'self',subject_id:null,attribute:'full-name',value:'Fictional Hidden Fullname',origin:'ai_note'});
  const probe=await call('add_claim',{subject_type:'self',attribute:'Full Name',value:'Fictional Hidden Fullname',evidence_quote:'My name is Fictional Hidden Fullname.'});
  assert.equal(probe.outcome,'inserted');assert.notEqual(probe.claim_id,name.id);
  // A setting the owner made (keep it from assistants) stays as he made it.
  store.save('fact_slots',{subject_type:'self',subject_id:null,attribute:'nationality',label:'Nationality',show_to_agent:false});
  const kept=store.save('claims',{subject_type:'self',subject_id:null,attribute:'nationality',value:'Fictionalian',valid_from:'2020-01-01',origin:'user_manual'});
  assert.equal((await call('add_claim',{subject_type:'self',attribute:'citizenship',value:'Otherlandish',evidence_quote:'I took Otherlandish citizenship.',valid_from:'2026-09-01'})).outcome,'waiting_for_review','typed by him: his Review decides');
  assert.equal(store.get('claims',kept.id).valid_to??null,null);
  assert.equal(query.rows('fact_slots').find(s=>s.attribute==='nationality').show_to_agent,false);
});

test('many at a time stays many, whatever the old setting said; one the owner typed waits in his Review; a rejected value stays rejected under every name',async t=>{
  const {call,store,query}=await service(t);
  // An older notebook had made hobbies single-valued.
  store.save('fact_slots',{subject_type:'self',subject_id:null,attribute:'hobbies',label:'Hobbies',show_to_agent:true,cardinality:'one'});
  await call('add_claim',{subject_type:'self',attribute:'hobby',value:'fictional chess',evidence_quote:'I play fictional chess.',valid_from:'2026-01-01'});
  const second=await call('add_claim',{subject_type:'self',attribute:'Hobbies',value:'fictional go',evidence_quote:'I took up fictional go.',valid_from:'2026-09-01'});
  assert.equal(second.closed_earlier_values,0);
  assert.deepEqual(currentOf(query,{type:'self'},'hobbies'),['fictional chess','fictional go']);
  await call('add_claim',{subject_type:'self',attribute:'email-address',value:'one@fictional.example',evidence_quote:'Write to one@fictional.example.'});
  await call('add_claim',{subject_type:'self',attribute:'E-Mail',value:'two@fictional.example',evidence_quote:'Or to two@fictional.example.'});
  assert.deepEqual(currentOf(query,{type:'self'},'email'),['one@fictional.example','two@fictional.example']);
  // He typed his town himself, under an old name.
  store.save('claims',{subject_type:'self',subject_id:null,attribute:'city',value:'Fictional Typed Town',valid_from:'2026-01-01',origin:'user_manual'});
  const waiting=await call('add_claim',{subject_type:'self',attribute:'lives-in',value:'Fictional Guessed Town',evidence_quote:'Maybe Fictional Guessed Town one day.'});
  assert.equal(waiting.outcome,'waiting_for_review');
  assert.deepEqual(currentOf(query,{type:'self'},'lives-in'),['Fictional Typed Town']);
  // Never Again on "location: Fictional Bad Town" is never again under lives-in.
  store.save('ai_suggestion_suppressions',{subject_type:'self',subject_id:null,attribute:'location',value:'Fictional Bad Town'});
  const suppressed=new Domains(query).writeFact({label:'Current city',value:'Fictional Bad Town',origin:'review_queue'});
  assert.equal(suppressed.facts[0].outcome,'suppressed');
});

test('a fact kept in a private section stays private when its next value comes under the fixed name',t=>{
  const {store,query,domains}=offline(t);
  store.save('profile_categories',{slug:'private-places',name:'Private places',visibility_scope:'private'});
  store.save('fact_slots',{subject_type:'self',subject_id:null,attribute:'location',label:'Location',category_slug:'private-places',show_to_agent:true,is_pinned:true});
  const old=store.save('claims',{subject_type:'self',subject_id:null,attribute:'location',value:'Fictional Secret Town',valid_from:'2026-01-01'});
  const written=domains.writeFact({label:'Current city',value:'Fictional Hidden Town',valid_from:'2026-09-01'});
  assert.equal(written.facts[0].closed,1);assert.equal(store.get('claims',old.id).valid_to,'2026-09-01');
  const slot=query.rows('fact_slots').find(s=>s.attribute==='lives-in');
  assert.equal(slot.category_slug,'private-places');assert.equal(slot.is_pinned,true);
  assert.equal(visibleRows(query,'claims').some(c=>c.value==='Fictional Hidden Town'),false,'no assistant sees it');
});

test('note processing: the model is told the fixed names, and what it proposes is filed under them',async t=>{
  const {store,query,domains}=offline(t);
  let seen;domains.provider=async input=>{seen=input;return {metadata:{type:'observation'},tags:[],suggestions:[
    {type:'add_claim',title:'Moved',payload:{label:'Current City',value:'Fictional Bay',subject:'self'},evidence_quote:'I moved to Fictional Bay'},
    {type:'add_claim',title:'Tea',payload:{label:'Favourite tea',value:'fictional jasmine',subject:'self'},evidence_quote:'I love fictional jasmine'}]};};
  store.save('claims',{subject_type:'self',subject_id:null,attribute:'location',value:'Fictional Old Bay',valid_from:'2025-01-01'});
  const note=store.save('notes',{title:'News',content:'I moved to Fictional Bay last week. I love fictional jasmine tea.'});
  await domains.invoke('process-note',{note_id:note.id});
  assert.ok(seen.fixed_names.includes('lives-in (one at a time): the town or city someone lives in now'),'the names are in what the model reads');
  assert.match(seen.contract,/fixed_names/);
  const proposals=query.rows('review_queue');
  assert.equal(proposals.find(p=>p.payload.value==='Fictional Bay').payload.attribute,'lives-in');
  assert.equal(proposals.find(p=>p.payload.value==='fictional jasmine').payload.attribute,'favourite_tea','a kind the list does not name keeps its own name');
  const kept=await domains.invoke('review-queue-bulk',{action:'keep',ids:proposals.map(p=>p.id)});
  assert.deepEqual(kept.errors,[]);
  assert.deepEqual(currentOf(query,{type:'self'},'lives-in'),['Fictional Bay'],'kept, it ends the value under the old name');
  // The other model calls that propose facts are told the names too.
  let told;domains.provider=async input=>{told=input;return {suggestions:[{type:'add_profile_entry',title:'Born',payload:{label:'Birthday',attribute:'Birthday',value:'1 May'},evidence_quote:'I moved to Fictional Bay'}]};};
  await domains.invoke('generate-profile-suggestions',{});
  assert.ok(told.fixed_names.some(l=>l.startsWith('date-of-birth')));assert.match(told.contract,/fixed_names/);
  assert.equal(query.rows('review_queue').find(p=>p.payload.value==='1 May').payload.attribute,'date-of-birth');
});

// world_fields.py's cases (scripts/test-world-fields.py in the engine), on the notebook.
test('the daily closing ends the older of two current values across names and stores, and leaves a tie and a many-at-a-time kind alone',async t=>{
  const {root,store,query}=offline(t);
  worldFile(root,'entities','owner.md',{slug:'owner',name:'Fictional Owner',self:'true'});
  const a=worldFile(root,'claims','owner--current-city--2026-03-01.md',{subject:'owner',attribute:'current-city',value:'Fictional A',valid_from:'2026-03-01'});
  const b=worldFile(root,'claims','owner--city--undated.md',{subject:'owner',attribute:'City',value:'"Fictional B"'});
  const h=worldFile(root,'claims','owner--hobby--2026-02-01.md',{subject:'owner',attribute:'hobby',value:'fictional chess',valid_from:'2026-02-01'});
  worldFile(root,'claims','owner--hobbies--2026-09-01.md',{subject:'owner',attribute:'hobbies',value:'fictional go',valid_from:'2026-09-01'});
  const garbled=worldFile(root,'claims','owner--location--garbled.md',{subject:'owner',attribute:'location',value:'Fictional G',valid_from:'sometime in 2027'});
  const n1=store.save('claims',{subject_type:'self',subject_id:null,attribute:'Location',value:'Fictional C',valid_from:'2026-09-30'});
  const n2=store.save('claims',{subject_type:'contact',subject_id:'p1',attribute:'city',value:'Fictional D',valid_from:'2026-05-05'});
  const n3=store.save('claims',{subject_type:'contact',subject_id:'p1',attribute:'location',value:'Fictional E',valid_from:'2026-05-05'});
  const result=await closeFacts({store,query});
  assert.equal(meta(a).valid_to,'2026-09-30','an older dated value under another name');
  assert.equal(meta(b).valid_to,'2026-09-30','an undated one');
  assert.equal(meta(garbled).valid_to,'2026-09-30','a date that is no day decides nothing and is older than any');
  assert.equal(store.get('claims',n1.id).valid_to??null,null,'the newest, in the notebook, stays');
  assert.ok(!store.get('claims',n2.id).valid_to&&!store.get('claims',n3.id).valid_to,'two values the same day are left to a person');
  assert.equal(meta(h).valid_to,undefined,'a many-at-a-time kind is never touched');
  assert.equal(result.values.length,3);
  const before=fs.readFileSync(a,'utf8');
  await closeFacts({store,query});
  assert.equal(fs.readFileSync(a,'utf8'),before,'a second run changes nothing');
  // A notebook value ends when a newer world value says otherwise; a value with a comma is one value.
  const m1=store.save('claims',{subject_type:'self',subject_id:null,attribute:'city',value:'Fictional F',valid_from:'2026-01-01'});
  worldFile(root,'claims','owner--lives-in--2026-10-05.md',{subject:'owner',attribute:'lives-in',value:'Fictional Krefeld, Fictional Land',valid_from:'2026-10-05'});
  await closeFacts({store,query});
  assert.equal(store.get('claims',m1.id).valid_to,'2026-10-05');
  assert.equal(store.get('claims',n1.id).valid_to,'2026-10-05');
  assert.equal(store.get('claims',n1.id).closure_evidence.source_id,'world/claims/owner--lives-in--2026-10-05.md');
});

test('a world subject is a notebook person by the id the import kept, or by their one name; a name two people share stays its own',t=>{
  const {root,store,query}=offline(t);
  const lea=store.save('contacts',{name:'Fictional Lea'}),merged=store.save('contacts',{name:'Fictional Lea (old card)',merged_into:lea.id});
  store.save('contacts',{name:'Fictional Twin'});store.save('contacts',{name:'Fictional Twin'});
  worldFile(root,'entities','lea.md',{slug:'lea',name:'Fictional Lea',menerio_id:merged.id});
  worldFile(root,'entities','twin.md',{slug:'twin',name:'Fictional Twin'});
  worldFile(root,'claims','lea--location--2026-04-01.md',{subject:'lea',attribute:'location',value:'Fictional Port',valid_from:'2026-04-01'});
  store.save('claims',{subject_type:'contact',subject_id:lea.id,attribute:'current-city',value:'Fictional Ridge',valid_from:'2026-02-01'});
  worldFile(root,'claims','twin--location--2026-04-01.md',{subject:'twin',attribute:'location',value:'Fictional Mill',valid_from:'2026-04-01'});
  store.save('claims',{subject_type:'contact',subject_id:query.rows('contacts').find(c=>c.name==='Fictional Twin').id,attribute:'city',value:'Fictional Weir',valid_from:'2026-01-01'});
  const steps=supersededValues(store,query);
  assert.deepEqual(steps.map(s=>[s.group,s.record.value]),[['contact:'+lea.id+'|lives-in','Fictional Ridge']]);
});

// world_relationships.py's cases (scripts/test-world-relationships.py in the engine), on the notebook.
test('a relationship that ended is ended everywhere it is recorded; agreeing words, someone else\'s lover and a day that says both are left alone',async t=>{
  const {root,store,query}=offline(t);
  worldFile(root,'entities','owner.md',{slug:'owner',name:'Fictional Owner',self:'true'});
  const ids={};
  for(const [slug,rel] of [['lea','Girlfriend'],['mei','wife'],['rik',null],['ann','partner'],['sol','ex-boyfriend']]){
    const c=store.save('contacts',{name:'Fictional '+slug[0].toUpperCase()+slug.slice(1),relationship:rel});ids[slug]=c.id;
    worldFile(root,'entities',slug+'.md',{slug,name:c.name,menerio_id:c.id});
  }
  const link=(label,target,source='self')=>store.save('contact_relationships',source==='self'?{source_type:'self',target_type:'contact',target_id:target,label}:{source_type:'contact',source_id:source,target_type:'contact',target_id:target,label});
  const leaLink=link('partner',ids.lea),meiLink=link('spouse',ids.mei),rikLink=link('lover',ids.rik,ids.mei);
  const old=worldFile(root,'claims','owner--relationship--undated.md',{subject:'owner',attribute:'relationship',value:'partner',object:'lea',origin:'menerio'},'Kept from the old import.');
  worldFile(root,'claims','lea--relationship-to-owner--2026-10-03.md',{subject:'lea',attribute:'relationship-to-owner',value:'ex-girlfriend',valid_from:'2026-10-03'});
  const meiWife=worldFile(root,'claims','mei--relationship--2026-07-19.md',{subject:'mei',attribute:'relationship',value:'wife',valid_from:'2026-07-19'});
  worldFile(root,'claims','mei--relationship-to-owner--2026-10-08.md',{subject:'mei',attribute:'relationship-to-owner',value:'wife and partner',valid_from:'2026-10-08'});
  const rik=worldFile(root,'claims','rik--relationship-to-mei--2026-10-08.md',{subject:'rik',attribute:'relationship-to-mei',value:'lover',valid_from:'2026-10-08'});
  const solEx=worldFile(root,'claims','sol--relationship-to-owner--2026-01-01.md',{subject:'sol',attribute:'relationship-to-owner',value:'ex-boyfriend',valid_from:'2026-01-01'});
  worldFile(root,'claims','sol--relationship-to-owner--2026-05-01.md',{subject:'sol',attribute:'relationship-to-owner',value:'boyfriend',valid_from:'2026-05-01'});
  const annA=worldFile(root,'claims','ann--relationship-to-owner--2026-09-09.md',{subject:'ann',attribute:'relationship-to-owner',value:'girlfriend',valid_from:'2026-09-09'});
  worldFile(root,'claims','ann--relationship-to-owner--2026-09-09-2.md',{subject:'ann',attribute:'relationship-to-owner',value:'former girlfriend',valid_from:'2026-09-09'});
  const result=await closeFacts({store,query});
  assert.equal(meta(old).valid_to,'2026-10-03','an undated partner claim ends on the day of the newer ex');
  assert.equal(meta(old).value,'partner');assert.match(fs.readFileSync(old,'utf8'),/Kept from the old import\./);
  assert.equal(store.get('contact_relationships',leaLink.id).valid_to,'2026-10-03','the notebook\'s link ends that day too');
  assert.equal(store.get('contacts',ids.lea).relationship,'ex-girlfriend','her card says the newest word');
  assert.equal(store.get('contact_relationships',meiLink.id).valid_to??null,null,'spouse beside "wife and partner" is not ended');
  assert.equal(meta(meiWife).valid_to,undefined,'nor the older "wife"');
  assert.ok(!store.get('contact_relationships',rikLink.id).valid_to&&meta(rik).valid_to===undefined,'a lover of someone else is never the owner\'s');
  assert.equal(meta(solEx).valid_to,'2026-05-01','together again: the old ex ends');
  assert.equal(store.get('contacts',ids.sol).relationship,'boyfriend','and the card that still said ex says the newest word');
  assert.ok(meta(annA).valid_to===undefined&&store.get('contacts',ids.ann).relationship==='partner','one day saying both is left to a person');
  assert.ok(result.files.includes('world/claims/owner--relationship--undated.md')&&result.files.includes('world/claims/sol--relationship-to-owner--2026-01-01.md'));
  const before=fs.readFileSync(old,'utf8'),again=await closeFacts({store,query});
  assert.equal(fs.readFileSync(old,'utf8'),before);assert.equal(again.relationships.length,0,'a second run changes nothing');
});

test('without a self entity the owner is known by the profile\'s name; Michael\'s engine running first leaves nothing to do',async t=>{
  const {root,store,query}=offline(t);
  store.save('profiles',{id:'owner',display_name:'Fictional Pat Owner'});
  const lea=store.save('contacts',{name:'Fictional Lea'});
  worldFile(root,'entities','lea.md',{slug:'lea',name:'Fictional Lea',menerio_id:lea.id});
  const link=store.save('contact_relationships',{source_type:'self',target_type:'contact',target_id:lea.id,label:'partner'});
  worldFile(root,'claims','lea--relationship-to-fictional--2026-10-03.md',{subject:'lea',attribute:'relationship-to-fictional',value:'ex-girlfriend',valid_from:'2026-10-03'});
  assert.deepEqual(endedRelationships(store,query).map(s=>[s.action,s.record.kind]),[['end','link']]);
  // The engine's world_relationships.py already ended it (same day, same line): nothing more happens.
  store.save('contact_relationships',{id:link.id,valid_to:'2026-10-03'},store.get('contact_relationships',link.id)._hash);
  const result=await closeFacts({store,query});
  assert.equal(result.relationships.length,0);assert.equal(store.get('contact_relationships',link.id).valid_to,'2026-10-03');
  const p=worldFile(root,'claims','x--lives-in--undated.md',{subject:'x',attribute:'lives-in',value:'v'});
  setValidTo(p,'2026-10-01');setValidTo(p,'2026-10-02');
  assert.equal((fs.readFileSync(p,'utf8').match(/^valid_to:/gm)||[]).length,1,'one end line, the latest');
});

test('the closing runs once a day on the machine that runs the routines, and soon after a Menerio import',async t=>{
  const {store,query}=offline(t);
  store.save('claims',{subject_type:'self',subject_id:null,attribute:'city',value:'Fictional One',valid_from:'2026-01-01'});
  store.save('claims',{subject_type:'self',subject_id:null,attribute:'location',value:'Fictional Two',valid_from:'2026-02-01'});
  const here=new FactClosing({store,query,device:'local'}),there=new FactClosing({store,query,device:'elsewhere'});
  const at=h=>Date.parse('2026-10-08T'+String(h).padStart(2,'0')+':00:00Z');
  assert.equal(there.due(at(12)),false,'another machine never');
  assert.equal(here.due(at(3)),false,'not before four in the morning');
  here.request();assert.equal(here.due(at(3)),true,'after an import, at once');
  const ran=await here.tick(at(3));
  assert.equal(ran.values.length,1);
  assert.equal(query.rows('claims').find(c=>c.value==='Fictional One').valid_to,'2026-02-01');
  const status=JSON.parse(fs.readFileSync(path.join(store.state,'fact-closing-status.json'),'utf8'));
  assert.equal(status.last_day,'2026-10-08');assert.equal(status.ended_values,1);
  assert.equal(here.due(at(5)),false,'once a day');
  assert.equal(here.due(at(5)+86400000),true,'the next day again');
  assert.equal(await here.tick(at(5)),null);
});

test('the server runs the closing beside its other routines',async t=>{
  const {svc}=await service(t);
  assert.ok(svc.domains.factClosing instanceof FactClosing);
  svc.domains.factClosing.request();
  assert.equal(svc.domains.factClosing.due(),true);
});
