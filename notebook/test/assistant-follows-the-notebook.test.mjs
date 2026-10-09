import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {titleFromContent} from '../core/note-title.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// A live run on 9 October 2026 (a reader's briefing, Chapters 4, 13 and 14 of Teach It Once,
// told in the chat to a real assistant) found the notebook's tools refusing or misleading an
// assistant that meant the right thing: a collection could not be made because the assistant
// wrote "collection", the same person saved twice became two pages, a second "hard limit" ended
// the first, notes were all called "Captured note", and a reply named a link nobody had saved.
// These are those calls, as the assistant made them, and what the notebook's screens then show.
async function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-follows-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,port:0});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});delete process.env.GODSPEED_ASSISTANT_CONFIG;});
  service.store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
  const base='http://127.0.0.1:'+service.address.port;
  const raw=async(name,args={})=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;};
  const call=async(name,args)=>{const result=await raw(name,args);assert.equal(result.isError,undefined,name+': '+result.content[0].text);const text=result.content[0].text;try{return JSON.parse(text);}catch{return text;}};
  const refused=async(name,args)=>{const result=await raw(name,args);assert.equal(result.isError,true,'expected '+name+' to refuse');return result.content[0].text;};
  return {service,call,refused,query:service.query,root};
}
const one=value=>Array.isArray(value)?value[0]:value;

test('Chapter 14: "Make a collection for my supplements ... Add magnesium glycinate" works with the calls an assistant makes',async t=>{
  const {call,query}=await setup(t);
  // "Make a collection for my supplements, with columns for the name, the dose, the time of day,
  // when I started and why I take it. Add magnesium glycinate, 400 mg, evenings, started this
  // month, for sleep." The assistant on 9 October called the type "collection".
  assert.deepEqual(await call('list_collections',{}),[]);
  const made=one(await call('save_record',{type:'collection',value:{name:'Supplements',description:'What I take, how much, when and why',columns:['Name','Dose','Time of day','Started','Why I take it']}}));
  assert.equal(made.slug,'supplements');
  const schema=await call('get_collection_schema',{slug:'supplements'});
  assert.deepEqual(schema.field_schema.map(f=>[f.key,f.label,f.type,!!f.primary]),[['name','Name','text',true],['dose','Dose','text',false],['time_of_day','Time of day','text',false],['started','Started','text',false],['why_i_take_it','Why I take it','text',false]]);
  const added=await call('add_collection_item',{collection_slug:'supplements',data:{name:'Magnesium glycinate',dose:'400 mg',time_of_day:'evenings',started:'2026-10',why_i_take_it:'for sleep'}});
  assert.equal(added.title,'Magnesium glycinate');
  // What the Collections screen and the chat read back.
  const items=await call('list_collection_items',{collection_slug:'supplements'});
  assert.deepEqual(items.map(i=>[i.title,i.data.dose,i.data.time_of_day,i.data.why_i_take_it]),[['Magnesium glycinate','400 mg','evenings','for sleep']]);
  assert.deepEqual((await call('list_collections',{})).map(c=>[c.name,c.item_count]),[['Supplements',1]]);
  assert.ok(query.rows('collection_items').some(i=>i.title==='Magnesium glycinate'));
});

test('a collection made the way the tool describes it, items given by label, and a refusal that names the right type',async t=>{
  const {call,refused}=await setup(t);
  await call('save_record',{type:'collections',value:{name:'Supplements',field_schema:[{label:'Name'},{label:'Dose'},{label:'Started',type:'date'},{label:'Time of day',type:'select',options:['morning','evening']}]}});
  const schema=await call('get_collection_schema',{slug:'supplements'});
  assert.deepEqual(schema.field_schema.map(f=>[f.key,f.type]),[['name','text'],['dose','text'],['started','date'],['time_of_day','select']]);
  // The columns' own words are their keys too.
  const added=await call('add_collection_item',{collection_slug:'Supplements',data:{Name:'Vitamin D',Dose:'1000 IU','Time of day':'morning',Started:'2026-10-01'}});
  assert.equal(added.title,'Vitamin D');
  assert.match(await refused('add_collection_item',{collection_slug:'supplements',data:{brand:'Nobody'}}),/Unknown field brand/);
  // A type save_record does not write is refused with the types it does write.
  const text=await refused('save_record',{type:'goal',value:{title:'Win two clients'}});
  assert.match(text,/collections/);assert.match(text,/personal_operation/);assert.doesNotMatch(text,/tool made for them/);
  // "person" and "Note" name contacts and notes.
  assert.equal(one(await call('save_record',{type:'person',value:{name:'Fictional Greta',relationship:'friend'}})).name,'Fictional Greta');
  assert.equal(one(await call('save_record',{type:'Note',value:{title:'Fictional plain note',content:'Text.'}})).title,'Fictional plain note');
});

test('the same person saved twice is one page; a second person with the same name only when asked',async t=>{
  const {call,query}=await setup(t);
  const jo=one(await call('save_record',{type:'contacts',value:{name:'Jo Okafor',relationship:'sister',notes:'Lives in Leeds.'}}));
  // The briefing filed her again later in the same answer, with other spacing and case.
  const again=one(await call('save_record',{type:'contacts',value:{name:'jo  okafor',relationship:'sister'}}));
  assert.equal(again.id,jo.id);assert.equal(again.already_in_notebook,true);assert.match(again.message,/already has a page/);
  assert.equal(query.rows('contacts').filter(c=>/okafor/i.test(c.name)).length,1,'one page, no "Jo Okafor 2"');
  // A fact filed afterwards goes on her one page.
  await call('add_claim',{subject_type:'contact',subject_name:'Jo Okafor',attribute:'lives-in',value:'Lisbon',evidence_quote:'my sister Jo moved to Lisbon in March',valid_from:'2026-03-01'});
  assert.ok(query.rows('claims').some(c=>c.subject_id===jo.id&&c.value==='Lisbon'));
  // A nickname is the same person too.
  const hannah=one(await call('save_record',{type:'contacts',value:{name:'Hannah Price',aliases:['Han']}}));
  assert.equal(one(await call('save_record',{type:'contacts',value:{name:'Han'}})).id,hannah.id);
  // Someone else who happens to share the name is made only when the caller says so.
  const other=one(await call('save_record',{type:'contacts',value:{name:'Jo Okafor',relationship:'client'},same_name_is_another_person:true}));
  assert.notEqual(other.id,jo.id);assert.equal(other.already_in_notebook,undefined);
  assert.equal(query.rows('contacts').filter(c=>/okafor/i.test(c.name)).length,2);
});

test('a kind of fact the list does not name keeps both values; one the list says is one at a time still ends the old',async t=>{
  const {call}=await setup(t);
  // What the live run filed from "My hard limits" (that belongs in the rules and the page about
  // the person, AGENTS.md says now); as facts, the second must not end the first.
  await call('add_claim',{subject_type:'self',attribute:'hard_limit',value:'never send anything in my name',evidence_quote:'My hard limits: never send anything in my name'});
  const second=await call('add_claim',{subject_type:'self',attribute:'hard_limit',value:'never spend money without asking',evidence_quote:'and never spend money without asking'});
  assert.equal(second.closed_earlier_values,0);
  assert.deepEqual((await call('get_claims',{subject_type:'self',attribute:'hard_limit'})).claims.map(c=>c.value).sort(),['never send anything in my name','never spend money without asking']);
  // lives-in is one at a time (core/fields.mjs): exactly as before.
  await call('add_claim',{subject_type:'self',attribute:'lives-in',value:'Fictional Town',evidence_quote:'I live in Fictional Town.',valid_from:'2025-01-01'});
  const moved=await call('add_claim',{subject_type:'self',attribute:'lives-in',value:'Fictional City',evidence_quote:'I moved to Fictional City.',valid_from:'2026-09-01'});
  assert.equal(moved.closed_earlier_values,1);
  assert.deepEqual((await call('get_claims',{subject_type:'self',attribute:'lives-in'})).claims.map(c=>c.value),['Fictional City']);
});

test('a workspace\'s field list can make a kind one at a time, and then a new value ends the old',async t=>{
  const {call,root}=await setup(t);
  fs.mkdirSync(path.join(root,'world'),{recursive:true});
  fs.writeFileSync(path.join(root,'world','fields.json'),JSON.stringify({fields:[{name:'favourite-tea',one:true,says:'the tea someone likes best now'}]}));
  await call('add_claim',{subject_type:'self',attribute:'favourite-tea',value:'Earl Grey',evidence_quote:'My favourite tea is Earl Grey.',valid_from:'2025-01-01'});
  const next=await call('add_claim',{subject_type:'self',attribute:'favourite-tea',value:'Assam',evidence_quote:'These days I prefer Assam.',valid_from:'2026-01-01'});
  assert.equal(next.closed_earlier_values,1);
});

test('a note given no title is named by its first words, and the answer calls linked only what was saved',async t=>{
  const {call,query,service}=await setup(t);
  const greta=await call('capture_note',{content:'Greta\'s tip for my sleep: magnesium glycinate, 400 mg in the evening.',folder_path:'Health',tags:['sleep','magnesium']});
  assert.equal(greta.title,'Greta\'s tip for my sleep');
  assert.deepEqual(greta.linked,[]);
  // The second note, as the assistant saved it on 9 October: no title, nothing in related.
  const aydin=await call('capture_note',{content:'Dr. Aydin says magnesium is fine with my blood pressure tablets, but not within two hours of them.',folder_path:'Health',tags:['magnesium']});
  assert.equal(aydin.title,'Dr. Aydin says magnesium is fine');
  assert.deepEqual(aydin.linked,[],'nothing was linked');
  assert.deepEqual(service.store.get('notes',aydin.id).related,[]);
  assert.ok(aydin.similar_not_linked.some(n=>n.id===greta.id),'the earlier note is offered as alike, not as a link');
  assert.equal(aydin.related,undefined,'no list the answer could pass off as links');
  assert.match(aydin.about_links,/linked to no other note/);
  assert.ok(!query.rows('notes').some(n=>n.title==='Captured note'));
  // Linked by title, as the recipe asks, the link is saved and reported.
  const third=await call('capture_note',{title:'Magnesium and my tablets',content:'Take magnesium two hours apart from the tablets.\nRelated: [[Greta\'s tip for my sleep]]',folder_path:'Health',related:['Dr. Aydin says magnesium is fine','No such note']});
  assert.deepEqual(third.linked.map(n=>n.title).sort(),['Dr. Aydin says magnesium is fine','Greta\'s tip for my sleep']);
  assert.deepEqual(service.store.get('notes',third.id).related,[aydin.id]);
  assert.deepEqual(third.links_to_no_note,['No such note']);
});

test('titles from first words',()=>{
  assert.equal(titleFromContent('# Meeting with Priya\nWe agreed on the budget.'),'Meeting with Priya');
  assert.equal(titleFromContent('https://www.example.com/a/b'),'Link from example.com');
  assert.equal(titleFromContent('buy milk'),'Buy milk');
  assert.equal(titleFromContent('   ',{fallbackDate:'2026-10-09'}),'Note of 2026-10-09');
  assert.ok(titleFromContent('word '.repeat(40)).split(' ').length<=8);
});
