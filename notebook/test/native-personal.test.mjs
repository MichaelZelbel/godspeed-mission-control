import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {backup,restore} from '../core/archives.mjs';
import {jobExecutor} from '../core/runtime.mjs';
import {nativeTick} from '../core/native-personal.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-native-'));
test('native coach and journal commands share canonical notebook files and survive backup restore',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);
 const command=(addon,args)=>domains.invoke('personal-operation',{type:'addon-command',addon,args});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'relationships',question:'What matters in the fictional conversation?'});
 await command('coach',['talk','said','relationships','--words','I want to listen first.']);assert.ok(query.rows('coach_talks')[0].replies.some(r=>r.content.includes('listen first')));
 await command('journal',['start','Fictional conversation preparation','--done-means','Draft has a listening question']);assert.ok(query.rows('journal').some(j=>j.kind==='start'));
 await command('journal',['note','Fictional preparation started']);assert.ok(query.rows('journal').some(j=>j.content==='Fictional preparation started'));
 assert.throws(()=>query.execute({table:'coach_talks',operation:'insert',values:{title:'A parallel talk'}}),/read-only/);
 const media=temp(),archive=path.join(temp(),'backup');backup(store,media,archive);const fresh=new Store(temp()),newMedia=path.join(temp(),'media');restore(fresh,newMedia,archive);
 const rebuilt=new QueryService(fresh);assert.equal(rebuilt.rows('coach_talks')[0].id,talk.id);assert.ok(rebuilt.rows('journal').some(j=>j.content==='Fictional preparation started'));
 assert.equal(store.list('coach_talks').length,0);assert.equal(store.list('journal').length,0);
});
test('scheduled health habit review uses fresh selected measurements without turning a missed attempt into success',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query),now=Date.now();
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional health source acceptance'});
 const habit=await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional after-tea walk',agreement:'Fictional test agreement [talk:'+talk.id+']',check_at:new Date(now+60000).toISOString()});
 assert.equal(habit.agreement.split('[talk:'+talk.id+']').length-1,1);
 await domains.invoke('personal-operation',{type:'habit-observe',id:habit.id,answer:'no',observation:'Fictional missed attempt after switching tasks'});
 for(const [id,value,at] of [['fresh',18,now],['future',99,now+86400000],['stale',77,now-9*86400000]])store.save('health_observations',{id,metric:'walking_minutes',value,source:'Fictional selected feed',observed_at:new Date(at).toISOString()});
 const execute=jobExecutor(async input=>{assert.equal(input.kind,'habit-review');assert.deepEqual(input.context.health.observations.map(r=>r.value),[18]);assert.equal(input.context.observations[0].answer,'no');assert.ok(input.contract.includes('never proof'));assert.match(input.contract,/A day answered skip does not count either way: it is neither done nor missed\./);return 'What pulled you into the other task?';},query);
 const result=await execute({id:'fixture-health-check',kind:'habit-check',habit_id:habit.id},{settings:{},store});assert.equal(result.verified,true);assert.ok(store.get('notes',result.record_id).content.includes('What pulled'));
 const retained=query.rows('habits').find(h=>h.id===habit.id);assert.equal(retained.observations[0].answer,'no');assert.equal(retained.agreement,habit.agreement);
});

test('the native coach tick reads the newest same-day measurement, whichever feed wrote it',async()=>{
 const run=async order=>{
  const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'UTC'});
  const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional weight?'});
  await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional light day',agreement:'I agree',auto:'weight_kg < 80',check_at:'2030-01-01T19:00:00Z'});
  const now=new Date();now.setUTCHours(12,0,0,0);const day=now.toISOString().slice(0,10);
  for(const [source,value,id] of order){store.save('health_observations',{id,metric:'weight_kg',value,source,...(source==='Health Auto Export'?{via:'phone-receiver'}:{}),observed_on:day,date_precision:'day',observed_at:day+'T00:00:00.000Z'});await new Promise(r=>setTimeout(r,5));}
  nativeTick(store,'coach',now);
  return query.rows('habits')[0].progress.lifetimeCompletedDays;
 };
 // The CSV (70, under the rule) is written last: the habit is ticked from it.
 assert.equal(await run([['Health Auto Export',90,'a-phone'],['Fictional CSV',70,'b-csv']]),1);
 // The phone row is written again after the CSV (91): it is the newest, so the rule fails.
 assert.equal(await run([['Health Auto Export',90,'a-phone'],['Fictional CSV',70,'b-csv'],['Health Auto Export',91,'a-phone']]),0);
});

test('the native coach leaves a short phone day unknown until its manual value settles',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'UTC'});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional protein?'});await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional protein day',agreement:'I agree',auto:'protein_g >= 10',check_at:'2030-01-01T19:00:00Z'});
 const now=new Date(Date.now()+86400000);now.setUTCHours(12,0,0,0);const day=new Date(now.getTime()-86400000).toISOString().slice(0,10);
 store.save('health_observations',{metric:'protein_g',value:20,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00.000Z',data_until:'19:55:00'});nativeTick(store,'coach',now,query);assert.equal(query.rows('habits')[0].progress.lifetimeCompletedDays,0);
 store.save('health_observations',{metric:'protein_g',value:20,source:'Fictional manual',via:'manual',observed_on:day,date_precision:'day',observed_at:day+'T12:00:00.000Z'});nativeTick(store,'coach',now,query);assert.equal(query.rows('habits')[0].progress.lifetimeCompletedDays,1);
});

test('the native coach leaves a current phone day unjudged',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'UTC'});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional current protein?'});await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional current protein day',agreement:'I agree',auto:'protein_g >= 10',check_at:'2030-01-01T19:00:00Z'});
 const now=new Date();now.setUTCHours(12,0,0,0);const day=now.toISOString().slice(0,10);
 store.save('health_observations',{metric:'protein_g',value:20,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00.000Z',data_until:'09:00:00'});nativeTick(store,'coach',now,query);assert.equal(query.rows('habits')[0].progress.lifetimeCompletedDays,0);
});

test('the native coach retains timestamp-only health observations',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'UTC'});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional historical protein?'});await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional historical protein day',agreement:'I agree',auto:'protein_g >= 10',check_at:'2030-01-01T19:00:00Z'});
 const now=new Date(Date.now()+86400000);now.setUTCHours(12,0,0,0);const yesterday=new Date(now.getTime()-86400000).toISOString().slice(0,10);
 store.save('health_observations',{metric:'protein_g',value:20,source:'Fictional manual',observed_at:yesterday+'T12:00:00.000Z'});nativeTick(store,'coach',now,query);assert.equal(query.rows('habits')[0].progress.lifetimeCompletedDays,1);
});
