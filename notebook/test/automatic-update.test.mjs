import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {HermesLifecycle} from '../core/hermes-lifecycle.mjs';
import {AutomaticUpdate,AUTOMATIC_FILE} from '../core/automatic-update.mjs';
import {readStatus,writeStatus} from '../core/update.mjs';
import {readNotices} from '../core/notices.mjs';

// Update automatically (#458): off unless chosen, once a day at the chosen time in the person's time
// zone, never while a chat or routine runs, paused when asked, and said once afterwards. The update
// itself is the `start` it is given, which the notebook makes startUpdate; here a spy stands in.
const NOTES='https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/candidate/2.0.0-beta.30';
function computer(version){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-automatic-update-')),commit='a'.repeat(40),runtime=path.join(root,'.godspeed','integrated-runtime');
  fs.mkdirSync(path.join(runtime,'versions',commit,'notebook'),{recursive:true});
  fs.writeFileSync(path.join(runtime,'version'),commit+'\n');
  fs.writeFileSync(path.join(runtime,'versions',commit,'notebook','package.json'),JSON.stringify({version}));
  return root;
}
const installVersion=(root,version)=>fs.writeFileSync(path.join(root,'.godspeed','integrated-runtime','versions','a'.repeat(40),'notebook','package.json'),JSON.stringify({version}));
// Berlin is an hour ahead of UTC in November: berlin('2026-11-12','04:00') is 03:00 UTC.
const berlin=(day,time)=>new Date(Date.parse(day+'T'+time+':00Z')-60*60*1000);
// `answer` says what the update's start answers; by default it starts one, as Update now does.
function setup({way='handover',answer}={}){
  const root=computer('2.0.0-beta.20'),store=new Store(root,{device:'local'});
  store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
  const lifecycle=new HermesLifecycle(),clock={at:berlin('2026-11-12','10:00')},starts=[];
  const started=()=>{const status=writeStatus(root,{state:'checking',from:'2.0.0-beta.20',to:'2.0.0-beta.30',notes:NOTES,message:'Getting 2.0.0-beta.30 ready.'},()=>clock.at);return {code:202,started:true,status};};
  const start=async()=>{starts.push(clock.at.toISOString());return (answer||started)();};
  const automatic=new AutomaticUpdate({store,lifecycle,start,way:()=>way,now:()=>clock.at});
  const at=async(day,time)=>{clock.at=berlin(day,time);return automatic.tick();};
  // The update the spy started ended: the status its command wrote, and the version now running.
  const ended=(state,message)=>{if(state==='updated')installVersion(root,'2.0.0-beta.30');writeStatus(root,{...readStatus(root),state,message},()=>clock.at);};
  return {root,store,lifecycle,automatic,starts,at,clock,ended};
}
// The person chose automatic on 11 November, so 12 November is the first day it counts.
const chosen=(env,input={})=>{env.clock.at=berlin('2026-11-11','10:00');env.automatic.save({choice:'automatic',...input});};

test('nothing updates unless the person chose it, and an installation that never chose reads Update myself',async()=>{
  const env=setup();
  assert.equal(env.automatic.overview().choice,'myself');assert.equal(env.automatic.overview().time,'04:00');
  for(const day of ['2026-11-12','2026-11-13'])for(const time of ['04:00','05:00','23:00'])await env.at(day,time);
  assert.deepEqual(env.starts,[]);
  fs.writeFileSync(path.join(env.store.state,AUTOMATIC_FILE),JSON.stringify({choice:'Automatic',changed_day:'2026-11-01'}));
  await env.at('2026-11-14','05:00');
  assert.deepEqual(env.starts,[],'only the exact choice counts');assert.equal(env.automatic.overview().choice,'myself');
});

test('the chosen time is honoured once a day, and a changed time counts from the next day',async()=>{
  const env=setup();chosen(env);
  assert.equal(await env.at('2026-11-12','03:59'),null);assert.equal(env.starts.length,0);
  assert.equal(await env.at('2026-11-12','04:00'),'started');assert.deepEqual(env.starts,[berlin('2026-11-12','04:00').toISOString()]);
  env.ended('updated','Updated to 2.0.0-beta.30.');
  await env.at('2026-11-12','04:01');await env.at('2026-11-12','12:00');
  assert.equal(env.starts.length,1,'one check a day');
  // Another release on the next day: the same time again.
  writeStatus(env.root,{state:'updated',to:'2.0.0-beta.30',message:'Updated.'});
  await env.at('2026-11-13','03:00');assert.equal(env.starts.length,1);
  await env.at('2026-11-13','04:00');assert.equal(env.starts.length,2);
  env.ended('updated','Updated.');
  // At 02:00 on the 14th the time changes to 06:00: not used on the 14th, used on the 15th.
  env.clock.at=berlin('2026-11-14','02:00');env.automatic.save({time:'06:00'});
  for(const time of ['04:00','06:00','23:59'])await env.at('2026-11-14',time);
  assert.equal(env.starts.length,2,'not on the day it changed');
  await env.at('2026-11-15','05:59');assert.equal(env.starts.length,2);
  await env.at('2026-11-15','06:00');assert.equal(env.starts.length,3);
});

test('it waits while a chat or a routine runs, and nothing starts while it runs',async()=>{
  const env=setup();chosen(env);
  const chat=env.lifecycle.acquire('chat reply');
  await env.at('2026-11-12','04:00');assert.equal(env.starts.length,0,'a chat is answered');
  chat();await env.at('2026-11-12','04:05');assert.equal(env.starts.length,1,'once the chat is answered');
  for(const kind of ['chat reply','routine tick','routine run','assistant update'])assert.equal(env.lifecycle.acquire(kind),null,kind+' waits for the update');
  env.ended('updated','Updated.');
  await env.at('2026-11-12','04:06');
  assert.equal(env.lifecycle.busy,false,'the lease ends with the update');
  const chatAfter=env.lifecycle.acquire('chat reply');assert.ok(chatAfter);chatAfter();

  const busy=setup();chosen(busy);
  const tick=busy.lifecycle.acquire('routine tick');
  for(const time of ['04:00','06:00','23:59'])await busy.at('2026-11-12',time);
  assert.equal(busy.starts.length,0,'a routine that never ends that day');
  tick();
  await busy.at('2026-11-13','03:59');assert.equal(busy.starts.length,0,'the next day, at the chosen time');
  await busy.at('2026-11-13','04:00');assert.equal(busy.starts.length,1);
});

test('on Windows the lease holds while the setup installs, after the update command handed it over',async()=>{
  const env=setup({way:'windows'});chosen(env);
  await env.at('2026-11-12','04:00');
  writeStatus(env.root,{...readStatus(env.root),state:'switching',message:'The Windows setup is installing 2.0.0-beta.30.'},()=>env.clock.at);
  for(const time of ['04:01','04:10','04:29'])await env.at('2026-11-12',time);
  assert.equal(env.lifecycle.acquire('routine tick'),null,'no routine while the setup installs');
  await env.at('2026-11-12','04:30');
  assert.equal(env.lifecycle.busy,false,'a setup that never finished counts as stopped after 30 minutes');
  assert.equal(env.automatic.overview().last.result,'failed');
});

test('Settings saved while an update is being started is kept, and an attempt that cannot be kept starts nothing',async()=>{
  const env=setup(),{starts}=env;chosen(env);
  let saved;
  env.automatic.start=async()=>{starts.push('');env.clock.at=berlin('2026-11-12','04:00');saved=env.automatic.save({choice:'myself'});return {code:200,started:false};};
  assert.equal(await env.at('2026-11-12','04:00'),'current');
  assert.equal(saved.choice,'myself');assert.equal(env.automatic.overview().choice,'myself','the change made during the start stays');
  await env.at('2026-11-14','04:00');assert.equal(starts.length,1,'Update myself from then on');

  const stuck=setup();chosen(stuck);
  stuck.automatic.write=()=>{throw Error('read-only');};
  for(const time of ['04:00','04:01','04:02'])assert.equal(await stuck.at('2026-11-12',time),null);
  assert.deepEqual(stuck.starts,[],'nothing starts when today\'s attempt cannot be written down');
  assert.equal(stuck.lifecycle.busy,false);
});

test('a pause holds through its date, or until the person turns it back on',async()=>{
  const env=setup();chosen(env,{paused:{until:'2026-11-13'}});
  assert.deepEqual(env.automatic.overview().paused,{until:'2026-11-13'});
  await env.at('2026-11-12','04:00');await env.at('2026-11-13','04:00');
  assert.equal(env.starts.length,0);
  await env.at('2026-11-14','04:00');assert.equal(env.starts.length,1,'the first chosen time after the date');
  assert.equal(env.automatic.overview().paused,null,'a pause whose date passed is over');

  const held=setup();chosen(held,{paused:{until:null}});
  for(const day of ['2026-11-12','2026-11-13','2026-11-14'])await held.at(day,'04:00');
  assert.equal(held.starts.length,0);
  held.clock.at=berlin('2026-11-14','12:00');held.automatic.save({paused:null});
  await held.at('2026-11-14','23:00');assert.equal(held.starts.length,0,'turned back on, from the next day');
  await held.at('2026-11-15','04:00');assert.equal(held.starts.length,1);
});

test('a failed update is said once in plain words and tried again only the next day',async()=>{
  const env=setup();chosen(env);
  await env.at('2026-11-12','04:00');
  env.ended('failed','The update to 2.0.0-beta.30 stopped before it was finished. The version you have keeps running. What the installer said is in /home/someone/godspeed/.godspeed/update/update.log.');
  for(const time of ['04:01','04:02','12:00','23:59'])await env.at('2026-11-12',time);
  assert.equal(env.starts.length,1,'no retry that day');
  const said=readNotices(env.store);
  assert.deepEqual(said.map(n=>n.id),['godspeed-update-failed-2026-11-12']);
  assert.equal(said[0].text,'Godspeed Mission Control could not update itself to 2.0.0-beta.30. The update to 2.0.0-beta.30 stopped before it was finished. The version you have, 2.0.0-beta.20, keeps running. It tries again tomorrow at 04:00.');
  assert.equal(env.store.get('notifications','godspeed-update-failed').status,'pending');
  assert.equal(env.automatic.overview().last.result,'failed');
  await env.at('2026-11-13','04:00');assert.equal(env.starts.length,2,'tried again the next day');

  const offline=setup({answer:()=>({code:502,error:'GitHub could not be reached to see whether a newer version exists.'})});chosen(offline);
  assert.equal(await offline.at('2026-11-12','04:00'),'failed');
  for(const time of ['04:01','12:00'])await offline.at('2026-11-12',time);
  assert.equal(offline.starts.length,1);
  assert.deepEqual(readNotices(offline.store).map(n=>n.text),['Godspeed Mission Control could not update itself. GitHub could not be reached to see whether a newer version exists. The version you have, 2.0.0-beta.20, keeps running. It tries again tomorrow at 04:00.']);
  assert.equal(offline.lifecycle.busy,false);
});

test('a finished update is said once, with the version and what changed',async()=>{
  const env=setup();chosen(env);
  await env.at('2026-11-12','04:00');
  await env.at('2026-11-12','04:01');
  assert.deepEqual(readNotices(env.store),[],'nothing while it runs');
  env.ended('updated','Updated to 2.0.0-beta.30.');
  for(const time of ['04:02','04:03','09:00'])await env.at('2026-11-12',time);
  const said=readNotices(env.store);
  assert.deepEqual(said.map(n=>n.text),['Godspeed Mission Control updated itself to 2.0.0-beta.30. What changed: '+NOTES]);
  assert.equal(env.store.get('notifications','godspeed-update').status,'pending');
  assert.deepEqual(env.automatic.overview().last,{day:'2026-11-12',result:'updated',to:'2.0.0-beta.30',message:null});
});

test('where the notebook cannot update itself, the choice is not offered and a saved one does nothing',async()=>{
  const env=setup({way:'server'});
  const offer=env.automatic.overview();
  assert.equal(offer.offered,false);assert.match(offer.reason,/Docker server/);assert.doesNotMatch(offer.reason,/\n/);
  assert.throws(()=>env.automatic.save({choice:'automatic'}),error=>error.status===409);
  fs.writeFileSync(path.join(env.store.state,AUTOMATIC_FILE),JSON.stringify({choice:'automatic',changed_day:'2026-11-01'}));
  await env.at('2026-11-12','05:00');assert.deepEqual(env.starts,[]);
  const unwatched=new AutomaticUpdate({store:env.store,lifecycle:null,start:()=>{throw Error('never');},way:()=>'handover'});
  assert.equal(unwatched.offer().offered,false,'without the lifecycle it cannot know when a chat runs');
  assert.equal(await unwatched.tick(),null);
});

test('Settings refuses a time or pause that is not one',()=>{
  const env=setup();
  for(const input of [{choice:'often'},{time:'4:00'},{time:'24:00'},{paused:{until:'2026-02-30'}},{paused:'tomorrow'},null])assert.throws(()=>env.automatic.save(input),error=>error.status===400,JSON.stringify(input));
  assert.equal(env.automatic.save({choice:'myself',paused:{until:null}}).paused,null,'only automatic updates pause');
});
