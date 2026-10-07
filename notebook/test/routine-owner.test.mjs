import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {NativeScheduler,dailyTime} from '../core/native-scheduler.mjs';
import {controlRoutine} from '../core/jobs/routine-control.mjs';
import {Store} from '../core/records/store.mjs';

// One machine runs the routines. Until 6 October 2026 every machine with the
// assistant ticked Hermes' schedule, whichever machine the owner had chosen,
// and a routine could only repeat every so many minutes, never "daily at 05:16".
const setup=device=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-owner-')),store=new Store(root,{device});
  fs.mkdirSync(path.join(root,'skills','morning-brief'),{recursive:true});fs.writeFileSync(path.join(root,'skills','morning-brief','SKILL.md'),'# Morning brief');
  store.save('settings',{id:'installation',owner:'vps',timezone:'Europe/Berlin',delivery:'notebook'});
  const calls=[];const scheduler=new NativeScheduler(store,{home:path.join(root,'.hermes'),executable:'hermes',device,run:async(exe,args,options)=>{calls.push({args,timezone:options.env.HERMES_TIMEZONE});return {stdout:''};}});
  return {store,scheduler,calls};
};

test('only the chosen machine ticks the assistant\'s schedule',async()=>{
  const laptop=setup('local');await laptop.scheduler.tick();assert.equal(laptop.calls.length,0);
  const server=setup('vps');await server.scheduler.tick();assert.deepEqual(server.calls.map(c=>c.args),[['cron','tick']]);
  server.store.save('settings',{id:'installation',owner:'local'});server.scheduler.lastTick=0;await server.scheduler.tick();assert.equal(server.calls.length,1,'after the owner moves, the old machine stops');
});

test('"daily at 05:16" in the owner\'s timezone, for the assistant\'s schedule and the built-in one',async()=>{
  const {scheduler,calls,store}=setup('vps');
  await scheduler.control({kind:'morning-brief',at:'05:16'},{enable:true});
  assert.deepEqual(calls[0].args.slice(0,3),['cron','create','16 5 * * *']);assert.equal(calls[0].timezone,'Europe/Berlin');
  assert.deepEqual(dailyTime('5:16'),{hour:5,minute:16,time:'05:16'});assert.equal(dailyTime('25:00'),null);
  const job=await controlRoutine(store,{kind:'goal-decision',at:'05:16'},{enable:true,now:Date.parse('2026-10-06T06:00:00Z')});
  assert.deepEqual(job.calendar,{time:'05:16'});assert.equal(job.next_run,'2026-10-07T03:16:00.000Z','05:16 in Berlin summer time is 03:16 UTC');
  await assert.rejects(controlRoutine(store,{kind:'goal-decision',at:'5 past 5'},{enable:true}),/daily time/);
});
