import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {norm,card,trackers,findTracker,entries,trackerStatus,toNumber,dayOf,whenFor,schemaFor,entryData,holdQuestion,createdReply,instantReply} from '../core/trackers.mjs';

// Trackers (work/plans/2026-10-11-trackers-design.md, D-321): the rules every
// way in shares, tested without a model.
const store=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-trackers-')));
const belly=s=>s.save('collections',{name:'Belly',field_schema:schemaFor({unit:'cm',cadence:'daily'}),tracker:{names:['Belly'],cadence:'daily',talk:'health',specialist:null}});
const item=(s,c,when,value)=>s.save('collection_items',{collection_id:c.id,title:when,data:{when,value}});

test('a decimal comma is a decimal point, and words are not numbers',()=>{
  assert.equal(toNumber('92,5'),92.5);assert.equal(toNumber(' 94 '),94);assert.equal(toNumber(93),93);
  assert.throws(()=>toNumber('ninety'),/number/);assert.throws(()=>toNumber(''),/number/);
});

test('only collections with a card are trackers, matched by any of their names',()=>{
  const s=store(),c=belly(s);s.save('collections',{name:'Belly',field_schema:[]});
  s.save('collections',{...c,tracker:{...c.tracker,names:['Belly','Waist']}},c._hash);
  assert.equal(trackers(s).length,1);assert.ok(card(trackers(s)[0]));
  assert.equal(findTracker(s,'  WAIST ').match.id,c.id);
  assert.equal(findTracker(s,'movies').match,null);
  assert.equal(norm('  Bauch  Umfang '),'bauch umfang');
});

test('two trackers sharing a name are both candidates and neither is the match',()=>{
  const s=store();for(const name of ['Sleep hours','Sleep quality'])s.save('collections',{name,field_schema:schemaFor({cadence:'daily'}),tracker:{names:[name,'Sleep'],cadence:'daily',talk:null,specialist:null}});
  const found=findTracker(s,'sleep');assert.equal(found.match,null);assert.equal(found.candidates.length,2);
});

test('the day is the installation day, and a time is kept only for any-number trackers',()=>{
  const now=new Date('2026-10-11T22:30:00Z');
  assert.equal(dayOf(now,'Europe/Berlin'),'2026-10-12');
  assert.equal(whenFor({cadence:'daily'},now,'Europe/Berlin'),'2026-10-12');
  assert.equal(whenFor({cadence:'any',at:'06:30'},now,'Europe/Berlin'),'2026-10-12 06:30');
  assert.equal(whenFor({cadence:'any'},now,'Europe/Berlin'),'2026-10-12 00:30');
  assert.equal(whenFor({cadence:'daily',on:'2026-10-09'},now,'Europe/Berlin'),'2026-10-09');
  assert.throws(()=>whenFor({cadence:'daily',on:'2026-10-13'},now,'Europe/Berlin'),/future/);
  assert.throws(()=>whenFor({cadence:'daily',on:'2025-10-01'},now,'Europe/Berlin'),/year/);
  assert.throws(()=>whenFor({cadence:'daily',on:'2026-02-30'},now,'Europe/Berlin'),/calendar day/);
});

test('a one-number tracker answers with the change since the entry before, naming its day',()=>{
  const s=store(),c=belly(s),now=new Date('2026-10-11T18:00:00Z');
  item(s,c,'2026-10-05',93);const e=item(s,c,'2026-10-11',91);
  const before=entries(s,c).filter(i=>i.id!==e.id);
  assert.equal(instantReply(c,before,e,now,'Europe/Berlin'),'Tracked: 91 cm, down 2 since Monday.');
  assert.equal(instantReply(c,[],e,now,'Europe/Berlin'),'Tracked: Belly 91 cm.');
  const far=item(s,c,'2026-09-01',95);
  assert.equal(instantReply(c,[far],e,now,'Europe/Berlin'),'Tracked: 91 cm, down 4 since 1 September.');
});

test('a tracker with no number counts this month, and several columns are read back',()=>{
  const s=store(),now=new Date('2026-10-11T18:00:00Z');
  const sauna=s.save('collections',{name:'Sauna',field_schema:schemaFor({fields:[],cadence:'any'}),tracker:{names:['Sauna'],cadence:'any',talk:null,specialist:null}});
  for(const w of ['2026-09-30 19:00','2026-10-02 19:00','2026-10-06 19:00'])s.save('collection_items',{collection_id:sauna.id,title:w,data:{when:w}});
  const e=s.save('collection_items',{collection_id:sauna.id,title:'2026-10-11 19:00',data:{when:'2026-10-11 19:00'}});
  assert.equal(instantReply(sauna,entries(s,sauna).filter(i=>i.id!==e.id),e,now,'Europe/Berlin'),'Tracked: Sauna, 3rd time this month.');
  const sleep=s.save('collections',{name:'Sleep',field_schema:schemaFor({fields:[{key:'hours',label:'Hours',type:'number'},{key:'quality',label:'Quality',type:'number'}],cadence:'daily'}),tracker:{names:['Sleep'],cadence:'daily',talk:'health',specialist:null}});
  const n=s.save('collection_items',{collection_id:sleep.id,title:'2026-10-11',data:{when:'2026-10-11',hours:7,quality:4}});
  // The columns read back in the words of a sentence: a unit after its number, a range as "of 5".
  assert.equal(instantReply(sleep,[],n,now,'Europe/Berlin'),'Tracked: Sleep, hours 7, quality 4.');
  const rated=s.save('collections',{name:'Rest',field_schema:schemaFor({fields:[{label:'Hours',type:'number',unit:'hours'},{label:'Quality',type:'number',min:1,max:5}],cadence:'daily'}),tracker:{names:['Rest'],cadence:'daily',talk:null,specialist:null}});
  const r=s.save('collection_items',{collection_id:rated.id,title:'2026-10-10',data:{when:'2026-10-10',hours:7,quality:4}});
  assert.equal(instantReply(rated,[],r,now,'Europe/Berlin'),'Tracked: Rest yesterday, 7 hours, quality 4 of 5.');
});

test('a tracker rests after thirty days without an entry',()=>{
  const s=store(),c=belly(s);item(s,c,'2026-09-01',95);
  assert.equal(trackerStatus(s,c,new Date('2026-09-30T12:00:00Z')),'active');
  assert.equal(trackerStatus(s,c,new Date('2026-10-02T12:00:00Z')),'resting');
});

test('the question and the first reply say exactly what will happen',()=>{
  const proposal={name:'Belly',cadence:'daily',field_schema:schemaFor({unit:'cm',cadence:'daily'}),talk:'health',entry:{when:'2026-10-11',data:{value:92}}};
  assert.equal(holdQuestion(proposal,'2026-10-11'),"Start a new tracker called Belly, one number in cm, once a day? I've kept the 92 for today.");
  assert.equal(holdQuestion({...proposal,entry:{when:'2026-10-10',data:{value:92}}},'2026-10-11'),"Start a new tracker called Belly, one number in cm, once a day? I've kept the 92 for 10 October.");
  const c={name:'Belly',field_schema:proposal.field_schema,tracker:{names:['Belly'],cadence:'daily',talk:'health'}};
  assert.equal(createdReply(c,{data:{when:'2026-10-11',value:92}}),'Tracked: Belly 92 cm. From now on just say "track belly" and the number. Your health talk will read it.');
  assert.equal(createdReply({...c,tracker:{...c.tracker,talk:null}},null),'Belly is ready. Say "track belly" and the number.');
  // A talk is a coaching area by the name the person gave it.
  assert.equal(createdReply({...c,tracker:{...c.tracker,talk:'work'}},null),'Belly is ready. Say "track belly" and the number. Your work talk will read it.');
  assert.deepEqual(entryData(c,{value:'92,5',note:'after dinner'}),{value:92.5,note:'after dinner'});
  assert.throws(()=>entryData(c,{}),/value/);
});
