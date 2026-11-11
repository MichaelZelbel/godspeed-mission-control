import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../core/records/store.mjs';import {NativeScheduler} from '../core/native-scheduler.mjs';
import {recordRoutine} from '../core/background-reports.mjs';import {openStep,heard,STEP_QUESTIONS} from '../core/waiting-steps.mjs';

// Hermes as the notebook runs it, with no delivery wrapper: `hermes cron run <id>` and `hermes cron
// tick` run a no-agent script job whose script records its words (godspeed_routines.py does) and
// prints them, Hermes keeps them in cron/output and writes one executions row with its delivery outcome.
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-certified-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'.hermes');fs.mkdirSync(path.join(home,'cron'),{recursive:true});
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');
 fs.writeFileSync(path.join(home,'cron','jobs.json'),JSON.stringify({jobs:[{id:'probe1',name:'Probe',script:'probe.py',no_agent:true,deliver:'telegram',workdir:root,schedule_display:'every 30m'}]}));
 const store=new Store(root,{device:'vps'});store.save('settings',{id:'installation',owner:'vps',timezone:'Europe/Berlin'});
 const db=new DatabaseSync(path.join(home,'cron','executions.db'));
 db.exec('create table executions (id text primary key, job_id text, source text, status text, started_at text, finished_at text, delivery_outcome text)');db.close();
 const hermes={words:null,outcome:'delivered',seen:[]};
 const run=async(exe,args)=>{
  hermes.seen.push(args.join(' '));
  const ran=args.join(' ')==='cron run probe1'?'direct':args.join(' ')==='cron tick'?'builtin':null;
  if(!ran||!hermes.words)return {stdout:''};
  const started=new Date();
  await recordRoutine(new Store(root,{device:'vps'}),{routine:'probe',text:hermes.words,home,delivery:'telegram'});
  const folder=path.join(home,'cron','output','probe1');fs.mkdirSync(folder,{recursive:true});
  const name=started.toISOString().slice(0,19).replace('T','_').replace(/:/g,'-')+'-'+hermes.seen.length+'.md';
  fs.writeFileSync(path.join(folder,name),'# Cron Job: Probe\n\n**Job ID:** probe1\n**Mode:** no_agent (script)\n\n---\n\n'+hermes.words+'\n');
  const finished=new Date(Date.now()+5),ledger=new DatabaseSync(path.join(home,'cron','executions.db'));
  ledger.prepare('insert into executions values (?,?,?,?,?,?,?)').run('run'+hermes.seen.length,'probe1',ran,'completed',started.toISOString().replace('Z','+00:00'),finished.toISOString().replace('Z','+00:00'),hermes.outcome);ledger.close();
  return {stdout:''};
 };
 const scheduler=new NativeScheduler(store,{executable:'hermes',home,device:'vps',run});
 const ask=about=>openStep(store,{about,question:'Shall I turn them off?',yes:'I will turn them off.',no:'I will leave them.',by:'routine:probe',chat:'telegram'});
 const buttons=id=>fs.existsSync(path.join(store.state,STEP_QUESTIONS,id+'.json'));
 return {root,store,scheduler,hermes,ask,buttons};
}
const ways={'cron run probe1':s=>s.runNow('probe1'),'cron tick':s=>s.tick()};

for(const [way,go] of Object.entries(ways)){
 test(`a question from a no-agent routine the notebook runs with \`hermes ${way}\` gets its buttons and a plain yes answers it`,async t=>{
  const {root,scheduler,hermes,ask,buttons}=setup(t),step=ask('Seven leftover programs still run.');
  hermes.words=step.message;
  await go(scheduler);
  assert.ok(hermes.seen.includes(way));
  const fresh=new Store(root,{device:'vps'});
  assert.ok(fresh.get('approvals',step.id).sent_at,'the step is certified');
  assert.ok(buttons(step.id),'its Yes/No buttons are handed to the gateway');
  assert.equal(heard(fresh,{chat:'telegram',words:'yes'}).kind,'answered');
  assert.equal(fresh.get('approvals',step.id).status,'approved');
 });

 for(const outcome of ['failed','queued'])test(`a run through \`hermes ${way}\` whose delivery Hermes reports as ${outcome} leaves its question unanswerable`,async t=>{
  const {root,scheduler,hermes,ask,buttons}=setup(t),step=ask('Seven leftover programs still run.');
  hermes.words=step.message;hermes.outcome=outcome;
  await go(scheduler);
  const fresh=new Store(root,{device:'vps'});
  assert.equal(fresh.get('approvals',step.id).sent_at,undefined);
  assert.equal(buttons(step.id),false);
  assert.equal(heard(fresh,{chat:'telegram',words:'yes'}).kind,'none');
 });
}

test('an earlier delivered run does not certify the same question asked again by a run whose delivery failed',async t=>{
 const {root,store,scheduler,hermes,ask}=setup(t),first=ask('Seven leftover programs still run.');
 hermes.words=first.message;
 await scheduler.runNow('probe1');
 assert.ok(new Store(root,{device:'vps'}).get('approvals',first.id).sent_at);
 const second=ask('Seven leftover programs still run.');
 assert.equal(second.message,first.message);
 hermes.outcome='failed';
 await new Promise(r=>setTimeout(r,2100));
 await scheduler.runNow('probe1');
 assert.equal(new Store(store.root,{device:'vps'}).get('approvals',second.id).sent_at,undefined);
});
