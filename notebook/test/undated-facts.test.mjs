import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {closeFacts} from '../core/fact-closing.mjs';
import {frontMatter} from '../core/world-facts.mjs';

// A fact filed without a "since when" has no known start (9 October 2026). A live run filed the
// facts of a briefing ("Sam lives in Easton") with no date, and the notebook stored the filing day
// as their start. A later "we moved to Clifton on 1 June" then began BEFORE Easton did, so it could
// not end it: both addresses stayed current and the notebook flagged a conflict. Now the start is
// left empty, the filing day is kept as recorded_on, and a value with no start holds on every day,
// so the later, dated value ends it on its own date. Nothing undated decides (D-298): where two
// stores disagree, the recording day stands in for the missing start, as the filing day did before.

const today=()=>new Date().toISOString().slice(0,10);
const tmp=(t,prefix)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const worldFile=(root,folder,name,fields,body='fixture')=>{const p=path.join(root,'world',folder,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,['---',...Object.entries(fields).map(([k,v])=>k+': '+v),'---','',body,''].join('\n'));return p;};
const meta=p=>frontMatter(fs.readFileSync(p,'utf8')).fields;
const offline=t=>{const root=tmp(t,'godspeed-undated-');const store=new Store(root,{device:'local'}),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',owner:'local',timezone:'UTC'});return {root,store,query,domains};};
const livesIn=(query,type='self',id=null)=>query.rows('claims').filter(c=>c.subject_type===type&&(c.subject_id||null)===id&&c.attribute==='lives-in'&&!c.removed_at);
async function service(t){
  // Closed before its folder is removed: Windows keeps an open search index locked.
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-undated-service-'));
  const svc=await createService({root,port:0,provider:async()=>({})});t.after(async()=>{await svc.close();fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+svc.address.port;
  const call=async(name,args)=>{const r=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const result=(await r.json()).result;assert.equal(result.isError,undefined,result.content[0].text);const text=result.content[0].text;try{return JSON.parse(text);}catch{return text;}};
  return {root,svc,call,store:svc.store,query:svc.query};
}

test('the briefing says Easton with no date, then "we moved to Clifton on 1 June": Clifton is current from 1 June and Easton is history to that day',async t=>{
  const {call,store,query}=await service(t);
  const easton=await call('add_claim',{subject_type:'self',attribute:'lives-in',value:'Easton',evidence_quote:'Sam lives in Easton, Bristol.'});
  assert.equal(easton.outcome,'inserted');
  const filed=store.get('claims',easton.claim_id);
  assert.equal(filed.valid_from,null,'no start: the briefing did not say since when');
  assert.equal(filed.recorded_on,today(),'the day it was recorded is kept beside it');
  const moved=await call('add_claim',{subject_type:'self',attribute:'lives-in',value:'Clifton',evidence_quote:'We moved to Clifton on 1 June.',valid_from:'2026-06-01'});
  assert.equal(moved.outcome,'inserted');
  assert.equal(moved.closed_earlier_values,1,'the later, dated value ends the undated one');
  const ended=store.get('claims',easton.claim_id);
  assert.equal(ended.valid_to,'2026-06-01','Easton ends on the day of the move');
  assert.equal(ended.removed_at??null,null,'and is kept, as history');
  const clifton=store.get('claims',moved.claim_id);
  assert.equal(clifton.valid_from,'2026-06-01');assert.equal(clifton.valid_to??null,null);
  assert.deepEqual((await call('get_claims',{subject_type:'self',attribute:'lives-in'})).claims.map(c=>[c.value,c.valid_from]),[['Clifton','2026-06-01']]);
  const history=(await call('get_claims',{subject_type:'self',attribute:'lives-in',mode:'history'})).claims;
  assert.deepEqual(history.map(c=>[c.value,c.valid_from,c.valid_to]).sort(),[['Clifton','2026-06-01',null],['Easton',null,'2026-06-01']]);
  assert.equal(history.find(c=>c.value==='Easton').recorded_on,today(),'the assistant is told when it was recorded');
  assert.equal(query.rows('profile_facts').some(f=>f.has_conflict),false,'no conflict is flagged');
  const asked=await call('search_brain',{query:'Where do I live?',include:['claim']});
  assert.match(asked,/Clifton/);assert.doesNotMatch(asked,/Easton/,'the old address is not read as current');
  const closing=await closeFacts({store,query});
  assert.equal(closing.values.length,0,'the daily closing has nothing left to end');
  assert.deepEqual(livesIn(query).filter(c=>!c.valid_to).map(c=>c.value),['Clifton']);
});

test('the same for a person: Jo in Leeds, undated, then Lisbon since 1 March',async t=>{
  const {call,store,query}=await service(t);
  const jo=store.save('contacts',{name:'Jo Example'});
  await call('add_claim',{subject_type:'contact',subject_name:'Jo Example',attribute:'location',value:'Leeds',evidence_quote:'Jo lives in Leeds.'});
  const moved=await call('add_claim',{subject_type:'contact',subject_name:'Jo Example',attribute:'current-city',value:'Lisbon',evidence_quote:'Jo moved to Lisbon on 1 March.',valid_from:'2026-03-01'});
  assert.equal(moved.closed_earlier_values,1);
  assert.deepEqual(livesIn(query,'contact',jo.id).map(c=>[c.value,c.valid_from,c.valid_to??null]).sort(),[['Leeds',null,'2026-03-01'],['Lisbon','2026-03-01',null]]);
});

test('an undated value filed after a dated one ends it on the day it was recorded, and keeps winning at the daily closing',async t=>{
  const {root,store,query,domains}=offline(t);
  domains.writeFact({label:'Lives in',attribute:'lives-in',value:'Krefeld',valid_from:'2020-01-01'});
  // The same kind in a Mission Control world file, older and still open.
  fs.mkdirSync(path.join(root,'world','entities'),{recursive:true});
  worldFile(root,'entities','owner.md',{slug:'owner',name:'Fictional Owner',self:'true'});
  const file=worldFile(root,'claims','owner--lives-in--2026-03-01.md',{subject:'owner',attribute:'lives-in',value:'Fictional Older Town',valid_from:'2026-03-01'});
  const written=domains.writeFact({label:'Lives in',attribute:'lives-in',value:'Bristol'});
  assert.equal(written.facts[0].closed,1);
  const [krefeld,bristol]=['Krefeld','Bristol'].map(v=>livesIn(query).find(c=>c.value===v));
  assert.equal(krefeld.valid_to,today(),'what it replaces ends on the day it was recorded');
  assert.equal(bristol.valid_from,null);assert.equal(bristol.recorded_on,today());
  const result=await closeFacts({store,query});
  assert.deepEqual(result.values.map(v=>[v.value,v.ends]),[['Fictional Older Town',today()]],'the older dated value in the other store ends, not the newer undated one');
  assert.equal(meta(file).valid_to,today());
  assert.deepEqual(livesIn(query).filter(c=>!c.valid_to).map(c=>c.value),['Bristol']);
});

test('two values with the same newest day stay as two answers, also when one of them has only its recording day',async t=>{
  const {root,store,query,domains}=offline(t);
  worldFile(root,'entities','owner.md',{slug:'owner',name:'Fictional Owner',self:'true'});
  const file=worldFile(root,'claims','owner--lives-in--today.md',{subject:'owner',attribute:'lives-in',value:'Fictional File Town',valid_from:today()});
  domains.writeFact({label:'Lives in',attribute:'lives-in',value:'Fictional Notebook Town'});
  const result=await closeFacts({store,query});
  assert.equal(result.values.length,0,'a tie is left to a person');
  assert.equal(meta(file).valid_to,undefined);
  assert.deepEqual(livesIn(query).filter(c=>!c.valid_to).map(c=>c.value),['Fictional Notebook Town']);
});

test('a many-at-a-time kind keeps every undated value, and an unlisted kind an assistant files keeps both',async t=>{
  const {call,query}=await service(t);
  await call('add_claim',{subject_type:'self',attribute:'hobby',value:'fictional chess',evidence_quote:'I play fictional chess.'});
  await call('add_claim',{subject_type:'self',attribute:'hobbies',value:'fictional go',evidence_quote:'I took up fictional go.',valid_from:'2026-01-01'});
  assert.deepEqual(query.rows('claims').filter(c=>c.attribute==='hobbies'&&!c.valid_to).map(c=>c.value).sort(),['fictional chess','fictional go']);
  await call('add_claim',{subject_type:'self',attribute:'hard_limit',value:'no smoking',evidence_quote:'A hard limit: no smoking.'});
  await call('add_claim',{subject_type:'self',attribute:'hard_limit',value:'no late calls',evidence_quote:'Another hard limit: no late calls.',valid_from:'2026-02-01'});
  assert.deepEqual(query.rows('claims').filter(c=>c.attribute==='hard_limit'&&!c.valid_to).map(c=>c.value).sort(),['no late calls','no smoking']);
});

test('Roll Back of an undated replacing value brings back the value it replaced',async t=>{
  const {store,query,domains}=offline(t);
  domains.writeFact({label:'Lives in',attribute:'lives-in',value:'Town A',valid_from:'2025-01-01'});
  const b=domains.writeFact({label:'Lives in',attribute:'lives-in',value:'Town B'}).facts[0].claimId;
  const item=store.save('review_queue',{status:'kept',applied_at:new Date().toISOString(),suggestion_type:'add_profile_entry',target_entity_type:'claim',target_entity_id:b,payload:{label:'Lives in',value:'Town B'},metadata:{menerio_source_table:'review_queue'}});
  const r=await domains.invoke('review-queue-bulk',{action:'rollback',ids:[item.id]});
  assert.deepEqual(r.errors,[]);
  assert.deepEqual(livesIn(query).filter(c=>!c.valid_to||c.valid_to>today()).map(c=>c.value),['Town A']);
});
