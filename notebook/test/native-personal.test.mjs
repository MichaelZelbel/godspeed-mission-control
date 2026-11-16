import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {backup,restore} from '../core/archives.mjs';
import {jobExecutor} from '../core/runtime.mjs';
import {nativeTick,addonInvocation} from '../core/native-personal.mjs';
import {saveSettings as saveHeadacheSettings,DEFAULTS as HEADACHE_DEFAULTS} from '../../third-party/addons/godspeed-headache/lib/settings.mjs';
import {writeEntry as writeHeadacheEntry} from '../../third-party/addons/godspeed-headache/lib/store.mjs';
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

test('scheduled health habit review refuses all provider prose while a phone column is unknown',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query),day=new Date().toISOString().slice(0,10);store.save('settings',{id:'installation',timezone:'UTC'});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional current health source'}),habit=await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional current health habit',agreement:'I agree',check_at:new Date(Date.now()+60000).toISOString()});
 store.save('health_observations',{metric:'protein_g',value:20,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until:'09:00:00'});
 const unsafe=jobExecutor(async input=>{assert.equal(input.kind,'habit-review');assert.match(input.contract,/may_be_incomplete and not_judged/);return {question:'Did you miss your protein target?',health_claims:[]};},query);
 await assert.rejects(unsafe({id:'current-health-habit-review',kind:'habit-check',habit_id:habit.id},{settings:{},store}),/Assistant output cannot be used while phone health is unknown/);assert.equal(query.rows('notes').filter(note=>note.source_app==='habit-check').length,0);
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

test('headache patterns receive complete requested phone columns across the executable boundary',()=>{
 const store=new Store(temp());store.save('settings',{id:'installation',timezone:'UTC'});
 const baseMetrics=['sleep_total_h','steps','distance_km','active_kcal','basal_kcal','food_kcal','protein_g','carbs_g','fat_g','flights'].map(metric=>[metric,123.456789012345]),dates=[];
 store.transaction(records=>{for(let ago=89;ago>=1;ago--){const date=new Date(Date.now()-ago*86400000).toISOString().slice(0,10);dates.push(date);for(const [index,[metric,value]] of baseMetrics.entries())records.saveUnderLock('health_observations',{id:index+'-'+date,metric,value:metric==='sleep_total_h'?(ago<=6?5:8):value,source:'Health Auto Export',via:'phone-receiver',observed_on:date,date_precision:'day',observed_at:date+'T00:00:00Z',data_until:'22:00:00'});}});
 const today=new Date().toISOString().slice(0,10);store.save('health_observations',{id:'incomplete-current-day',metric:'sleep_total_h',value:99,source:'Health Auto Export',via:'phone-receiver',observed_on:today,date_precision:'day',observed_at:today+'T00:00:00Z',data_until:'09:00:00'});
 saveHeadacheSettings(store.root,{...HEADACHE_DEFAULTS,git_sync:'off',daily_columns:['sleep_total_h']});
 for(const [i,date] of dates.slice(-6).entries()){const episode='fixture-'+i,start=new Date(date+'T06:00:00Z'),end=new Date(date+'T08:00:00Z');writeHeadacheEntry(store.root,HEADACHE_DEFAULTS,{kind:'start',episode,start:start.toISOString()},start);writeHeadacheEntry(store.root,HEADACHE_DEFAULTS,{kind:'end',episode,end:end.toISOString()},end);}
 const invocation=addonInvocation(store,{addon:'headache',args:['patterns','--days','90']});
 const rows=JSON.parse(invocation.env.GODSPEED_HEADACHE_DAILY_ROWS);assert.equal(rows.length,89);assert.ok(rows.every(row=>Object.keys(row).join(',')==='date,sleep_total_h'),'unrequested complete metrics do not consume the bridge');
 const run=spawnSync(invocation.command,invocation.argv,{cwd:invocation.cwd,env:invocation.env,encoding:'utf8',shell:false});assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);assert.deepEqual(report.compare[0],{column:'sleep_total_h',headache_days:6,free_days:83,mean_on:5,mean_off:8,enough:true});
 saveHeadacheSettings(store.root,{...HEADACHE_DEFAULTS,git_sync:'off',daily_columns:baseMetrics.map(([metric])=>metric)});assert.throws(()=>addonInvocation(store,{addon:'headache',args:['patterns','--days','90']}),/too much daily health data/,'a requested comparison that cannot cross the bridge is explicit');
 fs.writeFileSync(path.join(store.root,'daily.csv'),['date,sleep_total_h',...dates.map(date=>date+',99')].join('\n'));saveHeadacheSettings(store.root,{...HEADACHE_DEFAULTS,git_sync:'off',daily_table:'daily.csv',daily_columns:['sleep_total_h']});
 const preferred=addonInvocation(store,{addon:'headache',args:['patterns','--days','90']});assert.equal(preferred.env.GODSPEED_HEADACHE_DAILY_ROWS,undefined);const csvRun=spawnSync(preferred.command,preferred.argv,{cwd:preferred.cwd,env:preferred.env,encoding:'utf8',shell:false});assert.equal(csvRun.status,0,csvRun.stderr);assert.equal(JSON.parse(csvRun.stdout).compare[0].mean_on,99,'a configured table remains authoritative');
 saveHeadacheSettings(store.root,{...HEADACHE_DEFAULTS,git_sync:'off',daily_table:'missing.csv',daily_columns:['sleep_total_h']});
 const missing=addonInvocation(store,{addon:'headache',args:['patterns','--days','90']});assert.ok(missing.env.GODSPEED_HEADACHE_DAILY_ROWS,'a missing configured table keeps the phone fallback');const missingRun=spawnSync(missing.command,missing.argv,{cwd:missing.cwd,env:missing.env,encoding:'utf8',shell:false});assert.equal(missingRun.status,0,missingRun.stderr);assert.equal(JSON.parse(missingRun.stdout).compare[0].mean_on,5);
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

test('the native coach keeps resolved day columns ahead of timestamp-only observations',async()=>{
 const run=async (now,dayOffset,rows)=>{
  const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'UTC'});
  const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional resolved protein?'});await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional resolved protein day',agreement:'I agree',auto:'protein_g >= 10',check_at:'2030-01-01T19:00:00Z'});
  const day=new Date(now.getTime()+dayOffset*86400000).toISOString().slice(0,10);
  for(const row of rows(day))store.save('health_observations',row);nativeTick(store,'coach',now,query);return query.rows('habits')[0].progress.lifetimeCompletedDays;
 };
 const tomorrow=new Date(Date.now()+86400000);tomorrow.setUTCHours(12,0,0,0);const today=new Date();today.setUTCHours(12,0,0,0);
 assert.equal(await run(tomorrow,-1,day=>[
  {metric:'protein_g',value:20,source:'Fictional manual',via:'manual',observed_on:day,date_precision:'day',observed_at:day+'T20:00:00.000Z'},
  {metric:'protein_g',value:5,source:'Fictional timestamp',observed_at:day+'T10:00:00.000Z'},
 ]),1,'a timestamp-only row cannot overwrite a settled manual day');
 assert.equal(await run(tomorrow,-1,day=>[
  {metric:'protein_g',value:5,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00.000Z',data_until:'19:55:00'},
  {metric:'protein_g',value:20,source:'Fictional timestamp',observed_at:day+'T10:00:00.000Z'},
 ]),0,'a timestamp-only row cannot make an incomplete phone day automatic evidence');
 assert.equal(await run(today,0,day=>[
  {metric:'protein_g',value:5,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00.000Z',data_until:'09:00:00'},
  {metric:'protein_g',value:20,source:'Fictional timestamp',observed_at:day+'T10:00:00.000Z'},
 ]),0,'a timestamp-only row cannot make a current phone day automatic evidence');
 assert.equal(await run(tomorrow,-1,day=>[
  {metric:'protein_g',value:20,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00.000Z',data_until:'21:00:30'},
  {metric:'protein_g',value:5,source:'Fictional timestamp',observed_at:day+'T10:00:00.000Z'},
 ]),1,'a timestamp-only row cannot overwrite a complete phone day');
 assert.equal(await run(tomorrow,-1,day=>[
  {metric:'protein_g',value:20,source:'Fictional CSV',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00.000Z'},
  {metric:'protein_g',value:5,source:'Fictional timestamp',observed_at:day+'T10:00:00.000Z'},
 ]),1,'a timestamp-only row cannot overwrite a legacy day');
});

test('the native coach keeps resolved spaced metrics ahead of timestamp-only aliases',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'UTC'});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional heart rate?'});await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional steady heart rate',agreement:'I agree',auto:'resting_heart_rate >= 10',check_at:'2030-01-01T19:00:00Z'});
 const now=new Date(Date.now()+86400000);now.setUTCHours(12,0,0,0);const day=new Date(now.getTime()-86400000).toISOString().slice(0,10);
 store.save('health_observations',{metric:'resting heart rate',value:20,source:'Fictional manual',via:'manual',observed_on:day,date_precision:'day',observed_at:day+'T12:00:00.000Z'});
 store.save('health_observations',{metric:'resting_heart_rate',value:5,source:'Fictional timestamp',observed_at:day+'T13:00:00.000Z'});
 nativeTick(store,'coach',now,query);assert.equal(query.rows('habits')[0].progress.lifetimeCompletedDays,1);
});

test('the native coach keeps resolved underscored metrics ahead of timestamp-only aliases',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'UTC'});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional heart rate?'});await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional steady heart rate',agreement:'I agree',auto:'resting_heart_rate >= 10',check_at:'2030-01-01T19:00:00Z'});
 const now=new Date(Date.now()+86400000);now.setUTCHours(12,0,0,0);const day=new Date(now.getTime()-86400000).toISOString().slice(0,10);
 store.save('health_observations',{metric:'resting_heart_rate',value:20,source:'Fictional manual',via:'manual',observed_on:day,date_precision:'day',observed_at:day+'T12:00:00.000Z'});
 store.save('health_observations',{metric:'resting heart rate',value:5,source:'Fictional timestamp',observed_at:day+'T13:00:00.000Z'});
 nativeTick(store,'coach',now,query);assert.equal(query.rows('habits')[0].progress.lifetimeCompletedDays,1);
});

test('the native coach uses a complete phone day as automatic evidence',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'UTC'});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'health',question:'Fictional complete protein?'});await domains.invoke('personal-operation',{type:'habit-agree',talk_id:talk.id,title:'Fictional complete protein day',agreement:'I agree',auto:'protein_g >= 10',check_at:'2030-01-01T19:00:00Z'});
 const now=new Date(Date.now()+86400000);now.setUTCHours(12,0,0,0);const day=new Date(now.getTime()-86400000).toISOString().slice(0,10);
 store.save('health_observations',{metric:'protein_g',value:20,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00.000Z',data_until:'21:00:30'});nativeTick(store,'coach',now,query);assert.equal(query.rows('habits')[0].progress.lifetimeCompletedDays,1);
});
