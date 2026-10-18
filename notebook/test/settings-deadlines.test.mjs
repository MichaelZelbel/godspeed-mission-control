import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {personalOperation,conversationOperations} from '../core/personal-operations.mjs';import {dueCommand,dueRows,moveSettingsDeadlines} from '../core/native-due.mjs';

// A deadline saved under Settings, Obligations and reminders (18 October 2026). It was a notebook
// record that the 08:00 deadline reminders and the morning brief never read: they read due/ through
// mc-due. With the original assistant it is now a file in due/, made the way mc-due add makes one.
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-settings-deadlines-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
function hermesMode(t,timezone='Europe/Berlin'){
 const root=temporary(t),store=new Store(root,{device:'pc'});store.save('settings',{id:'installation',owner:'pc',timezone,delivery:'notebook'});
 const domains=new Domains(new QueryService(store));domains.nativeScheduler={control:async()=>null};
 return {root,store,domains};
}
const inDays=(n,hour='12:00:00')=>new Date(Date.now()+n*86400000).toISOString().slice(0,10)+'T'+hour+'Z';
const file=(root,slug)=>fs.readFileSync(path.join(root,'due',slug+'.md'),'utf8');

test('a deadline saved in Settings is a file in due/ that the deadline reminders read',t=>{
 const {root,store,domains}=hermesMode(t);
 const row=personalOperation(domains,{type:'obligation-add',title:'Renew my passport',done_when:'The new passport is in my drawer.',due_at:inDays(3),cost:'I cannot fly to Lisbon.'});
 assert.equal(row.native_slug,'renew-my-passport');assert.equal(row.native_file,'due/renew-my-passport.md');
 const text=file(root,'renew-my-passport');
 assert.match(text,/^TITLE:\s+Renew my passport$/m);assert.match(text,/^DONE-WHEN:\s+The new passport is in my drawer\.$/m);assert.match(text,/^COST-IF-MISSED:\s+I cannot fly to Lisbon\.$/m);
 assert.match(text,new RegExp('^STRIP: \\d{4}-\\d\\d-\\d\\d '+inDays(3).slice(0,10)+'$','m'),'its last day is the day chosen');
 assert.equal(store.list('deadlines').length,0,'no notebook record beside it');
 assert.match(dueCommand(store,['today']).result,/Renew my passport/,'the 08:00 reminders (mc-due today) name it, three days before');
 assert.ok(dueRows(store).some(r=>r.title==='Renew my passport'),'Settings lists it');
});

test('it asks what mc-due asks once, and a second one of the same name gets a number',t=>{
 const {root,domains}=hermesMode(t);
 assert.throws(()=>personalOperation(domains,{type:'obligation-add',title:'File taxes',due_at:inDays(30),cost:'A late fee.'}),/what is true when it is done/i);
 assert.throws(()=>personalOperation(domains,{type:'obligation-add',title:'File taxes',done_when:'Filed.',due_at:inDays(30)}),/costs you/);
 assert.throws(()=>personalOperation(domains,{type:'obligation-add',title:'File taxes',done_when:'Filed.'}),/target or a deadline/);
 const target=personalOperation(domains,{type:'obligation-add',title:'Paint the fence',done_when:'The fence is white.',target_at:inDays(20),recurrence:{days:7}});
 assert.match(file(root,'paint-the-fence'),new RegExp('^STRIP: \\S+ - target '+inDays(20).slice(0,10)+'$','m'),'a target alone, no last day');
 assert.match(file(root,'paint-the-fence'),/^REPEATS:\s+weekly$/m);
 const again=personalOperation(domains,{type:'obligation-add',title:'Paint the fence',done_when:'Done.',target_at:inDays(40)});
 assert.equal(target.native_slug,'paint-the-fence');assert.equal(again.native_slug,'paint-the-fence-2');
});

test('a day chosen in the form is that day on the person\'s own clock, also west of UTC',t=>{
 const {root,domains}=hermesMode(t,'America/Los_Angeles');
 // The form sends a chosen day as its noon in UTC.
 personalOperation(domains,{type:'obligation-add',title:'Send the invoice',done_when:'Sent.',target_at:'2026-12-01T12:00:00Z'});
 assert.match(file(root,'send-the-invoice'),/target 2026-12-01$/m);
});

test('a deadline told in the notebook\'s chat becomes a file in due/ too',async t=>{
 const {root,domains}=hermesMode(t);
 const message='Remind me to renew my passport by 1 March 2027. Done means the new one is here; missing it means no trip.';
 await conversationOperations(domains,{conversation_id:'chat',message},[{type:'obligation-add',source_quote:message,title:'Renew my passport',done_when:'The new one is here.',due_at:'2027-03-01T12:00:00+01:00',cost:'No trip.'}]);
 assert.match(file(root,'renew-my-passport'),/2027-03-01$/m);
});

test('a deadline Settings saved as a record before is moved into due/ once, and listed once',t=>{
 const {root,store}=hermesMode(t);
 const old=store.save('deadlines',{title:'Car service',due_at:inDays(10),target_at:null,start_at:new Date().toISOString(),timezone:'Europe/Berlin',status:'open',recurrence:null,completion_check:null});
 assert.deepEqual(moveSettingsDeadlines(store),['car-service']);
 assert.match(file(root,'car-service'),/^DONE-WHEN:\s+Car service: done\.$/m);
 const record=store.get('deadlines',old.id);assert.equal(record.status,'closed');assert.equal(record.moved_to,'due/car-service.md');
 assert.deepEqual(moveSettingsDeadlines(store),[],'once');
 const q=new QueryService(store);assert.equal(q.rows('deadlines').filter(d=>d.title==='Car service'&&d.status!=='closed').length,1);
});
