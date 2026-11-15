import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {jobExecutor} from '../core/runtime.mjs';
import {addDays} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

// The cycle heads-up (D-321 step 4): one line in her own morning brief two days before the forecast
// window, only when she switched it on; never a message of its own and never to anyone else.
const LINE='Heads-up: your period may start in two days, likely between 8 and 10 November.';
const SIX=['2026-04-20','2026-05-18','2026-06-17','2026-07-16','2026-08-13','2026-09-12','2026-10-11'];
async function fixture(headsUp){
 process.env.GODSPEED_NOW='2026-10-15T08:00:00Z';
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-cycle-brief-'))),query=new QueryService(store),domains=new Domains(query),op=input=>domains.invoke('personal-operation',input);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 const held=await op({type:'cycle',action:'track',on:SIX[0],flow:'medium'});await op({type:'tracker-create',proposal_id:held.proposal_id});
 for(const [i,start] of SIX.entries())for(const [d,flow] of ['medium','heavy','medium','light'].entries())if(i||d)await op({type:'cycle',action:'track',on:addDays(start,d),flow});
 if(headsUp)await op({type:'cycle',action:'heads-up',enabled:true});
 return {store,query};
}
test.after(()=>{delete process.env.GODSPEED_NOW;});

test('the notebook\'s own morning brief carries the line word for word on the day, and its gate refuses one without it',async()=>{
 const {store,query}=await fixture(true);
 process.env.GODSPEED_NOW='2026-11-06T05:00:00Z';
 let writes=0;
 const provider=async input=>{
  if(input.kind==='brief-verification')return {passed:true,reason:'Fictional sources checked.'};
  assert.equal(input.context.cycle_heads_up,LINE);
  if(++writes===1)return 'No fresh health observations are recorded. Your day is open.';
  assert.ok(input.context.check_feedback.some(f=>/heads-up/i.test(f)));
  return 'No fresh health observations are recorded. Your day is open.\n\n'+LINE;
 };
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-cycle'},{store,settings:{}});
 assert.equal(writes,2);assert.ok(store.get('notes',result.record_id).content.endsWith(LINE));
});

test('no line on another day, and none when the heads-up is off',async()=>{
 for(const [headsUp,day] of [[true,'2026-11-05T05:00:00Z'],[false,'2026-11-06T05:00:00Z']]){
  const {store,query}=await fixture(headsUp);process.env.GODSPEED_NOW=day;
  const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fictional sources checked.'};assert.equal(input.context.cycle_heads_up,null);return 'No fresh health observations are recorded. Your day is open.';};
  await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-quiet'},{store,settings:{}});
 }
});

test('the starter morning brief asks for the line and keeps it one line, and its text is a known revision',()=>{
 const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');
 const text=read('../../starter-godspeed/skills/morning-brief/SKILL.md');
 assert.match(text,/## Cycle heads-up/);
 assert.match(text,/`personal_operation \{"type":"cycle","action":"brief"\}`/);
 assert.match(text,/word for word, as one line/);
 assert.doesNotMatch(text,/[–—]/);
 const digest=createHash('sha256').update(text).digest('hex');
 assert.match(read('../../starter-godspeed/skills/morning-brief/.shipped-sha256'),new RegExp(digest));
 assert.ok(JSON.parse(read('../data/recipe-revisions.json'))['morning-brief/SKILL.md'].includes(digest));
});
