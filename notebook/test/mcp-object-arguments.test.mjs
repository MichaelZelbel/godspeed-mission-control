import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';
import {trackers} from '../core/trackers.mjs';

// A tool's object and list arguments, as a client that knows only the tool's schema sends them
// (24 October 2026). personal_operation declared no arguments at all, so Claude Code sent its
// `expected` as JSON text ("{\"collections/<id>\":\"<hash>\"}") instead of an object, every
// lookup of a hash in it found nothing, and "the health talk should look at my workouts tracker"
// was refused twice with "Read the current record hash before editing", while the same call sent
// with curl went through. The tools now declare those arguments, and text that is the JSON object
// (or list) a declared argument takes is read as that object once, where a call comes in. The hash
// check itself is unchanged: a wrong hash still conflicts and a missing one is still refused.
function fixture(t,{talks=['health']}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-mcp-arguments-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 for(const area of talks){fs.mkdirSync(path.join(root,'coach',area),{recursive:true});fs.writeFileSync(path.join(root,'coach',area,'area.md'),'AREA: '+area+'\nTITLE: '+area+'\nRHYTHM: weekly sunday\nTIME: 19:00\nSTARTS: 2026-10-01\nSTATUS: on\n\n## Preparation\n\nx\n');}
 const scopes=['actions','collections'];
 const call=async(args,name='personal_operation')=>{const r=await mcp({id:1,method:'tools/call',params:{name,arguments:args}},{store,query,domains,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
 return {root,store,query,domains,call,op:input=>domains.invoke('personal-operation',input)};
}
const ok=r=>{assert.equal(r.error,false,r.text);return JSON.parse(r.text);};
const sleep=async f=>{const held=await f.op({type:'tracker-hold',name:'Sleep',fields:[{label:'Hours',type:'number',unit:'hours'}]});await f.op({type:'tracker-create',proposal_id:held.proposal_id});};
const listed=async(f,name='Sleep')=>ok(await f.call({type:'tracker-list'})).trackers.find(x=>x.name===name);
const talks=(f,name='Sleep')=>trackers(f.store).find(c=>c.name===name).tracker.talks;
const words='The health talk may also look at my sleep tracker.';

test('a tracker\'s hash sent as JSON text goes through, as the same call sent as an object does',async t=>{
 const f=fixture(t);await sleep(f);const sleepy=await listed(f);
 // Exactly what Claude Code sent on 24 October 2026, with the space after the colon of its second try.
 const done=ok(await f.call({type:'tracker-talk',tracker:sleepy.id,talk:'health',words,expected:'{"collections/'+sleepy.id+'": "'+sleepy.hash+'"}'}));
 assert.equal(done.reply,'The health talk may now look at your sleep tracker.');
 assert.deepEqual(talks(f),['health']);
 const now=await listed(f);assert.equal(done.tracker_hash,now.hash);
 const off=ok(await f.call({type:'tracker-talk',tracker:now.id,talk:'health',remove:true,words:'The health talk no longer needs my sleep tracker.',expected_hashes:JSON.stringify({['collections/'+now.id]:now.hash})}));
 assert.equal(off.reply,'The health talk no longer looks at your sleep tracker.');
 assert.deepEqual(talks(f),[]);
});

test('the hash check is unchanged: a wrong hash in JSON text conflicts, a missing one is refused',async t=>{
 const f=fixture(t);await sleep(f);const sleepy=await listed(f);
 const stale=await f.call({type:'tracker-talk',tracker:sleepy.id,talk:'health',words,expected:JSON.stringify({['collections/'+sleepy.id]:'0'.repeat(64)})});
 assert.equal(stale.error,true);assert.match(stale.text,/This record changed/);
 assert.deepEqual(talks(f),[]);
 const missing=await f.call({type:'tracker-talk',tracker:sleepy.id,talk:'health',words});
 assert.equal(missing.error,true);assert.match(missing.text,/Read the current record hash before editing/);
 // A hash for another record, or text that is no JSON object, is no hash for this one.
 for(const expected of [JSON.stringify({'collections/another':sleepy.hash}),'['+JSON.stringify(sleepy.hash)+']','{"collections/'+sleepy.id+'":',' ','null']){
  const r=await f.call({type:'tracker-talk',tracker:sleepy.id,talk:'health',words,expected});
  assert.equal(r.error,true,expected);assert.match(r.text,/Read the current record hash before editing|This record changed/,expected);
 }
 assert.deepEqual(talks(f),[],'nothing changed');
});

test('an entry\'s hash sent as JSON text replaces the day\'s number, and a wrong one does not',async t=>{
 process.env.GODSPEED_NOW='2026-10-12T08:00:00Z';t.after(()=>{delete process.env.GODSPEED_NOW;});
 const f=fixture(t);
 const held=ok(await f.call({type:'tracker-hold',name:'Belly',unit:'cm',value:92,words:'track belly 92'}));
 ok(await f.call({type:'tracker-create',proposal_id:held.proposal_id,words:'yes'}));
 const belly=await listed(f,'Belly');
 const wrong=await f.call({type:'track',tracker:belly.id,value:91,expected:JSON.stringify({['collection_items/'+belly.today.id]:'0'.repeat(64)})});
 assert.equal(wrong.error,true);assert.match(wrong.text,/This record changed/);
 const replaced=ok(await f.call({type:'track',tracker:belly.id,value:91,expected:JSON.stringify({['collection_items/'+belly.today.id]:belly.today.hash})}));
 assert.match(replaced.reply,/is now 91 cm/);
});

test('a habit\'s hash sent as JSON text goes through, and its hash given on its own still does',async t=>{
 process.env.GODSPEED_NOW='2026-10-12T08:00:00Z';t.after(()=>{delete process.env.GODSPEED_NOW;});
 const f=fixture(t,{talks:['health','work','money']});
 const {addHabit}=await import('../../third-party/addons/godspeed-coach/lib/habits.mjs');
 addHabit(f.root,{area:'health',slug:'stretching',title:'Stretching',days:'daily'},'2026-10-12');
 const habit=async()=>ok(await f.call({type:'tracker-list'})).trackers.find(x=>x.specialist==='habit');
 let h=await habit();
 const stale=await f.call({type:'tracker-talk',tracker:h.id,talk:'work',words:'The work talk may also look at my stretching habit.',expected:JSON.stringify({['habits/'+h.id]:'0'.repeat(64)})});
 assert.equal(stale.error,true);assert.match(stale.text,/This habit changed/);
 const done=ok(await f.call({type:'tracker-talk',tracker:h.id,talk:'work',words:'The work talk may also look at my stretching habit.',expected:JSON.stringify({['habits/'+h.id]:h.hash})}));
 assert.equal(done.reply,'The work talk may now look at your stretching habit, along with the health talk.');
 h=await habit();
 // A hash that is the whole of expected was always this habit's, and it is left as it came.
 const alone=ok(await f.call({type:'tracker-talk',tracker:h.id,talk:'money',words:'The money talk may also look at my stretching habit.',expected:h.hash}));
 assert.match(alone.reply,/^The money talk may now look at your stretching habit/);
});

// The form the schema declares works for an operation on the one record its id names too: until this
// day a routine, a goal or an obligation compared expected itself with the record's hash, so
// {"jobs/<id>":"<hash>"} was always "changed" and only the hash on its own went through.
test('a routine changes with its hash by record, as JSON text or as an object, and with its hash alone',async t=>{
 const f=fixture(t,{talks:[]});
 f.store.save('jobs',{id:'fictional-routine',kind:'selftest',owner:'local',paused:false,next_run:new Date().toISOString(),interval_ms:60000});
 const job=()=>f.store.get('jobs','fictional-routine');
 const wrong=await f.call({type:'routine-change',id:'fictional-routine',paused:true,expected:{'jobs/fictional-routine':'0'.repeat(64)}});
 assert.equal(wrong.error,true);assert.match(wrong.text,/This record changed/);assert.equal(job().paused,false);
 const other=await f.call({type:'routine-change',id:'fictional-routine',paused:true,expected:{'jobs/another':job()._hash}});
 assert.equal(other.error,true);assert.equal(job().paused,false);
 ok(await f.call({type:'routine-change',id:'fictional-routine',paused:true,expected:JSON.stringify({'jobs/fictional-routine':job()._hash})}));
 assert.equal(job().paused,true);
 ok(await f.call({type:'routine-change',id:'fictional-routine',paused:false,expected:{'jobs/fictional-routine':job()._hash}}));
 assert.equal(job().paused,false);
 ok(await f.call({type:'routine-change',id:'fictional-routine',paused:true,expected:job()._hash}));
 assert.equal(job().paused,true);
 const none=await f.call({type:'routine-change',id:'fictional-routine',paused:false});
 assert.equal(none.error,true);assert.match(none.text,/Read the current record hash before editing/);assert.equal(job().paused,true);
});

test('every tool that takes arguments declares them, with expected as hashes by record',async()=>{
 const {result}=await mcp({id:1,method:'tools/list'},{});
 const tool=name=>result.tools.find(x=>x.name===name).inputSchema;
 const takesNone=new Set(['get_notebook_link','list_note_folders','validate_knowledge','get_stats','list_collections']);
 for(const {name,inputSchema} of result.tools){
  assert.equal(inputSchema.type,'object',name);
  if(!takesNone.has(name))assert.ok(Object.keys(inputSchema.properties||{}).length,name+' declares the arguments it takes');
 }
 const hashes={type:'object',additionalProperties:{type:'string'}};
 for(const name of ['personal_operation','write_fact','structural_change'])assert.deepEqual({type:tool(name).properties.expected.type,additionalProperties:tool(name).properties.expected.additionalProperties},hashes,name);
 const op=tool('personal_operation').properties;
 assert.equal(op.type.type,'string');assert.equal(op.expected_hashes.type,'object');assert.equal(op.data.type,'object');
 for(const key of ['fields','items','meds','answers','queries','symptoms','triggers','pain_where','args'])assert.equal(op[key].type,'array',key);
 assert.equal(tool('personal_operation').additionalProperties,true,'the operations\' other arguments still go through');
 assert.equal(tool('list_records').properties.filters.type,'array');assert.equal(tool('identity_files').properties.fields.type,'object');
});

test('a declared list or object sent as JSON text is read as one; anything else is left as it came',async t=>{
 const f=fixture(t);await sleep(f);
 // A tracker's columns, sent as text: the tracker gets those columns.
 const held=ok(await f.call({type:'tracker-hold',name:'Mood',fields:JSON.stringify([{label:'Mood',type:'number',min:1,max:5}]),words:'I want to track my mood from 1 to 5'}));
 const created=ok(await f.call({type:'tracker-create',proposal_id:held.proposal_id,words:'yes'}));
 assert.ok(created);
 const mood=trackers(f.store).find(c=>c.name==='Mood');
 assert.ok(mood.field_schema.some(c=>c.key==='mood'&&c.type==='number'&&c.max===5),JSON.stringify(mood.field_schema));
 // A word is a word: a name or a note that happens to start with a brace stays text.
 const note=ok(await f.call({type:'track',tracker:'sleep',value:7,note:'{not json}',words:'track sleep 7'}));
 assert.ok(note);
 const item=f.store.list('collection_items').find(i=>i.collection_id===trackers(f.store).find(c=>c.name==='Sleep').id);
 assert.equal(item.data.note,'{not json}');
});
