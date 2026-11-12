import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {reconcileJournalMoments,journalMomentId,JournalMoments} from '../core/journal-moments.mjs';
import {nativeRows} from '../core/native-personal.mjs';
import {loadSettings,saveSettings} from '../../third-party/addons/godspeed-journal/lib/settings.mjs';
import {writeEntry} from '../../third-party/addons/godspeed-journal/lib/store.mjs';

const at=hm=>new Date(`2026-11-01T${hm}:00Z`);
const now=at('23:00');
const fixture=(t,settings={})=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-journal-moments-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'AGENTS.md'),'# Fictional workspace\n');
 saveSettings(root,{...loadSettings(root),git_sync:'off',timezone:'UTC',...settings});
 return root;
};
const open=root=>{const store=new Store(root,{device:'pc'});return {store,query:new QueryService(store)};};
const entry=(root,hm,e)=>writeEntry(root,loadSettings(root),e,at(hm));
const start=(root,hm,task,title,done_means=[])=>entry(root,hm,{kind:'start',task,title,done_means,words:title});
const reconcile=({store,query})=>reconcileJournalMoments({store,query,now});
const live=({query})=>query.rows('moments').filter(m=>m.source_type==='journal');

test('a finished task becomes one moment with its real times, written once however often it runs',async t=>{
 const root=fixture(t),nb=open(root);
 start(root,'09:00','t-1','Send the invoice',['invoice sent']);
 entry(root,'10:30',{kind:'done',task:'t-1',words:'sent'});
 assert.equal((await reconcile(nb)).written.length,1);
 const [m]=live(nb);
 assert.equal(m.title,'Send the invoice');assert.equal(m.description,'Done meant: invoice sent');
 assert.equal(m.happened_at,at('09:00').toISOString());assert.equal(m.happened_end,at('10:30').toISOString());
 assert.equal(m.impact_level,1);assert.equal(m.status,'past_fact');assert.equal(m.source_id,'t-1');
 assert.deepEqual(await reconcile(nb),{written:[],updated:[],removed:[]});
 assert.deepEqual(await reconcile(open(root)),{written:[],updated:[],removed:[]},'a restart writes nothing again');
 assert.equal(nb.store.list('moments').length,1);
});

test('a close made while the notebook was not running is written on its next run',async t=>{
 const root=fixture(t);
 start(root,'09:00','t-1','Call the bank');entry(root,'09:20',{kind:'done',task:'t-1'});
 const nb=open(root);
 assert.equal((await reconcile(nb)).written.length,1);
 assert.equal((await reconcile(nb)).written.length,0);
 assert.equal(live(nb).length,1);
});

test('a moment the person removed is not written back',async t=>{
 const root=fixture(t),nb=open(root);
 start(root,'09:00','t-1','Pay the rent');entry(root,'09:05',{kind:'done',task:'t-1'});
 await reconcile(nb);
 const [m]=live(nb);
 await nb.query.executeAsync({table:'moments',operation:'delete',filters:[['eq','id',m.id]]});
 assert.equal(live(nb).length,0);
 assert.deepEqual(await reconcile(nb),{written:[],updated:[],removed:[]});
 assert.deepEqual(await reconcile(open(root)),{written:[],updated:[],removed:[]},'a restart does not bring it back');
 assert.equal(live(nb).length,0);
 assert.equal(nb.store.list('moments').length,1);
});

test('reopening takes the moment out with a tombstone; closing again writes it once with the new times',async t=>{
 const root=fixture(t),nb=open(root);
 start(root,'09:00','t-1','Draft the post');entry(root,'10:00',{kind:'done',task:'t-1'});
 await reconcile(nb);const first=live(nb)[0].id;
 entry(root,'11:00',{kind:'reopen',task:'t-1'});
 assert.deepEqual((await reconcile(nb)).removed,[first]);
 assert.equal(live(nb).length,0);
 assert.ok(nb.store.list('event_corrections').some(c=>c.moment_id===first&&c.patch?.removed_at),'the removal is the notebook\'s own, with its tombstone');
 entry(root,'12:00',{kind:'done',task:'t-1'});
 await reconcile(nb);await reconcile(nb);
 const after=live(nb);
 assert.equal(after.length,1);assert.notEqual(after[0].id,first);
 assert.equal(after[0].happened_end,at('12:00').toISOString());
 start(root,'13:00','t-2','Book the trip');entry(root,'13:30',{kind:'done',task:'t-2'});
 await reconcile(nb);
 entry(root,'14:00',{kind:'reopen',task:'t-2'});entry(root,'14:10',{kind:'drop',task:'t-2'});
 await reconcile(nb);
 assert.deepEqual(live(nb).map(m=>m.source_id),['t-1'],'reopened and then dropped has no moment');
});

test('a task never finished has no moment',async t=>{
 const root=fixture(t),nb=open(root);
 start(root,'09:00','t-1','Still going');
 start(root,'09:10','t-2','Given up');entry(root,'09:30',{kind:'drop',task:'t-2'});
 await reconcile(nb);
 assert.equal(nb.store.list('moments').length,0);
});

test('impact: from the finish, from a later answer once, and a level set in the notebook stays',async t=>{
 const root=fixture(t),nb=open(root);
 start(root,'09:00','t-1','Sign the lease');entry(root,'10:00',{kind:'done',task:'t-1',impact:'3'});
 await reconcile(nb);
 assert.equal(live(nb)[0].impact_level,3);
 entry(root,'10:05',{kind:'impact',task:'t-1',impact:'4'});
 const id=journalMomentId({id:'t-1',ended:at('10:00').toISOString()});
 assert.deepEqual((await reconcile(nb)).updated,[id]);
 assert.equal(live(nb)[0].impact_level,4);
 await nb.query.executeAsync({table:'moments',operation:'update',values:{impact_level:2},filters:[['eq','id',id]]});
 assert.deepEqual(await reconcile(nb),{written:[],updated:[],removed:[]});
 assert.equal(live(nb)[0].impact_level,2);
});

test('with the setting off nothing is written',async t=>{
 const root=fixture(t,{save_as_moments:false}),nb=open(root);
 start(root,'09:00','t-1','Dishes');entry(root,'09:10',{kind:'done',task:'t-1'});
 await reconcile(nb);
 assert.equal(nb.store.list('moments').length,0);
});

test('a moment stays when its entry files go missing',async t=>{
 const root=fixture(t),nb=open(root);
 start(root,'09:00','t-1','Pay rent');entry(root,'09:05',{kind:'done',task:'t-1'});
 await reconcile(nb);
 fs.rmSync(path.join(root,'routines','journal','entries'),{recursive:true,force:true});
 await reconcile(nb);
 assert.equal(live(nb).length,1);
});

test('the journal view does not list impact answers',t=>{
 const root=fixture(t),{store}=open(root);
 start(root,'09:00','t-1','Sign the lease');entry(root,'10:00',{kind:'done',task:'t-1'});
 entry(root,'10:05',{kind:'impact',task:'t-1',impact:'3'});
 assert.deepEqual(nativeRows(store,'journal').map(r=>r.kind),['start','done']);
});

test('only the computer that runs the routines writes moments',t=>{
 const root=fixture(t),{store,query}=open(root);
 assert.equal(new JournalMoments({store,query,device:'pc'}).due(),true,'no installation record yet');
 store.save('settings',{id:'installation',owner:'vps'});
 assert.equal(new JournalMoments({store,query,device:'pc'}).due(),false);
 assert.equal(new JournalMoments({store,query,device:'vps'}).due(),true);
});
