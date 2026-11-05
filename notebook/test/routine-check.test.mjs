import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {installStarter} from '../core/starter-workspace.mjs';
import {readNotices} from '../core/notices.mjs';import {CONNECTION_NOTICE_PREFIX} from '../core/connection-names.mjs';
import {checkRoutines} from '../core/routine-check.mjs';import {runConnectionCheck} from '../scripts/connection-check.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// "YOUR ROUTINES" IN THE DAILY CONNECTION CHECK (#239). The clock and the jobs list are made up.
const NOW=Date.parse('2026-11-05T05:00:00Z'),DAY='2026-11-05',ago=h=>new Date(NOW-h*3600000).toISOString(),ahead=h=>ago(-h);
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-check-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));installStarter(root);const home=path.join(root,'hermes');fs.mkdirSync(home);return {root,home,store:new Store(root,{device:'pc'})};};
const daily=(id,over={})=>({id,name:'Routine '+id,enabled:true,schedule:{kind:'cron',expr:'0 23 * * *'},created_at:ago(500),last_run_at:ago(30),last_status:'ok',next_run_at:ago(6),...over});
const failing=(id,streak,over={})=>daily(id,{last_run_at:ago(5),last_status:'error',last_error:'Traceback\nstderr:\nthe backup disk is full',next_run_at:ahead(19),failure_streak:streak,...over});
const check=(f,jobs)=>checkRoutines({store:f.store,home:f.home,day:DAY,timezone:'UTC',now:()=>new Date(NOW),jobs});
const said=f=>readNotices(f.store);

test('a daily routine last run 30 hours ago is told once, and 20 hours ago says nothing',t=>{
 const f=fixture(t);
 check(f,[daily('late'),daily('fine',{last_run_at:ago(20),next_run_at:ahead(4)})]);
 const [n,...rest]=said(f);assert.equal(rest.length,0);
 assert.ok(n.id.startsWith(CONNECTION_NOTICE_PREFIX));assert.match(n.text,/"Routine late" did not run when it was due/);assert.ok(!/Routine fine/.test(n.text));
 assert.ok(n.about&&n.facts.length===1);
 check(f,[daily('late'),daily('fine',{last_run_at:ago(20),next_run_at:ahead(4)})]);assert.equal(said(f).length,1,'the same spell is not told again');
});

test('one failure says nothing; two are told once with the error in plain words',t=>{
 const f=fixture(t);
 check(f,[failing('a',1)]);assert.equal(said(f).length,0);
 check(f,[failing('a',2,{last_run_at:ago(4)})]);
 assert.equal(said(f).length,1);assert.match(said(f)[0].text,/failed its last two runs: the backup disk is full/);assert.match(said(f)[0].text,/tries again/);
 check(f,[failing('a',3,{last_run_at:ago(3)})]);assert.equal(said(f).length,1,'the next check is silent');
});

test('without a failure streak, two errored runs seen at different checks are not taken for consecutive',t=>{
 const f=fixture(t),bare=over=>{const j=failing('a',0,over);delete j.failure_streak;return j;};
 check(f,[bare()]);check(f,[bare({last_run_at:ago(1)})]);
 assert.equal(said(f).length,0,'a good run may have come between them');
});

test('a good run closes the spell and a later failure is told again',t=>{
 const f=fixture(t);
 check(f,[failing('a',2)]);assert.equal(said(f).length,1);
 check(f,[daily('a',{last_run_at:ago(1),next_run_at:ahead(22)})]);
 check(f,[failing('a',2,{last_run_at:ahead(0.001)})]);
 assert.equal(said(f).length,2);assert.match(said(f)[1].text,/last ran right/);
});

test('paused, switched off and made-today routines say nothing',t=>{
 const f=fixture(t);
 check(f,[daily('off',{enabled:false}),daily('paused',{paused_at:ago(9)}),daily('new',{last_run_at:null,last_status:null,created_at:ago(2)}),failing('offfail',2,{enabled:false})]);
 assert.equal(said(f).length,0);
});

test('two found the same morning give one message naming both',t=>{
 const f=fixture(t);
 check(f,[daily('one'),failing('two',2)]);
 assert.equal(said(f).length,1);assert.match(said(f)[0].text,/Routine one/);assert.match(said(f)[0].text,/Routine two/);assert.equal(said(f)[0].facts.length,2);
});

test('the AI\'s sign-in error and the check\'s own routine say nothing from this source',t=>{
 const f=fixture(t);
 check(f,[failing('ai',2,{last_error:'AuthenticationError: invalid_api_key'}),failing('own',2,{script:'godspeed-connection-check.py'})]);
 assert.equal(said(f).length,0);
});

test('runConnectionCheck tells the routines even when the connections fail, and still rejects',async t=>{
 const f=fixture(t);
 fs.mkdirSync(path.join(f.store.state,'connection-check.json'),{recursive:true});
 await assert.rejects(runConnectionCheck({root:f.root,home:f.home,env:{GODSPEED_TODAY:DAY},probes:{},jobs:[daily('late',{last_run_at:new Date(Date.now()-30*3600000).toISOString(),next_run_at:new Date(Date.now()-6*3600000).toISOString()})]}));
 assert.equal(readNotices(f.store).filter(n=>/routines-/.test(n.id)).length,1);
});

test('the check reads Hermes\' own jobs list from the home when none is given',async t=>{
 const f=fixture(t);
 fs.mkdirSync(path.join(f.home,'cron'));fs.writeFileSync(path.join(f.home,'cron','jobs.json'),JSON.stringify({jobs:[daily('late',{last_run_at:new Date(Date.now()-30*3600000).toISOString(),next_run_at:new Date(Date.now()-6*3600000).toISOString()})]}));
 await runConnectionCheck({root:f.root,home:f.home,env:{GODSPEED_TODAY:DAY},probes:{}});
 const [n,...rest]=said(f);assert.equal(rest.length,0);assert.match(n.text,/"Routine late" did not run when it was due/);
});
