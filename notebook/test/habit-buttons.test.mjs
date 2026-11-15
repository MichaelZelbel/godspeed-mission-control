import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {addArea} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {addHabit,track,setStatus,readHabit,setHabitSchedule} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';
import {habitButtonAction} from '../core/habit-buttons.mjs';
import {hash} from '../core/records/store.mjs';

const NOW=new Date('2026-10-13T10:00:00Z');
const AUTH={ownerId:'1234',userId:'1234',chatId:'1234',chatType:'private',botId:'5678'};
const ENV={TELEGRAM_ALLOWED_USERS:'1234'};
function fixture({paused=false,days='daily',zone='Europe/Berlin'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-buttons-'));
 addArea(root,{slug:'learning',title:'Learning',rhythm:'weekly sunday',starts:'2026-10-01'});
 let habit=addHabit(root,{area:'learning',slug:'a-word',title:'Learn a word',doneMeans:'Learn one new word',days,timezone:zone},'2026-10-01');
 if(paused)habit=setStatus(habit,'paused','2026-10-12');
 const run=(input,options={})=>habitButtonAction(root,{...AUTH,...input},{env:ENV,now:NOW,...options});
 const issue=()=>run({command:'issue',habitId:'habit-learning-a-word'});
 const bind=callbackData=>run({command:'bind',callbackData,messageId:'77'});
 const tap=callbackData=>run({command:'tap',callbackData,messageId:'77',callbackId:'unique-tap'});
 return {root,habit,run,issue,bind,tap};
}

test('only an active due unfinished habit offers completion; tokens carry no operation and require immutable message binding',()=>{
 const {habit,run,issue,bind,tap}=fixture();const original=fs.readFileSync(habit.file,'utf8');
 const issued=issue();assert.equal(issued.ok,true);assert.equal(issued.habit.doneMeans,'Learn one new word');
 assert.equal(issued.buttons[0].text,'I did it');const token=issued.buttons[0].callbackData;
 assert.match(token,/^gsh1:[a-f0-9]{32}$/);assert.ok(Buffer.byteLength(token)<=64);
 assert.equal(tap(token).status,'unbound');assert.equal(fs.readFileSync(habit.file,'utf8'),original);
 assert.equal(bind(token).ok,true);assert.equal(bind(token).ok,true);
 assert.equal(run({command:'bind',callbackData:token,messageId:'78'}).status,'denied');
 assert.equal(run({command:'tap',callbackData:token,messageId:'78'}).status,'denied');
 const saved=tap(token);assert.equal(saved.status,'applied');assert.equal(saved.habit.progress.lifetimeCompletedDays,1);
 assert.equal(saved.buttons[0].text,'Undo');assert.match(fs.readFileSync(habit.file,'utf8'),/done \(telegram-button:[a-f0-9]{32}\) "Telegram button: I did it\."/);
 assert.equal(issue().buttons.length,0,'a completed day cannot offer a second completion');
});

test('duplicate taps and restarts refresh actual progress, never repeat the canonical write',()=>{
 const f=fixture(),token=f.issue().buttons[0].callbackData;f.bind(token);const saved=f.tap(token),bytes=fs.readFileSync(f.habit.file,'utf8');
 const repeated=habitButtonAction(f.root,{...AUTH,command:'tap',callbackData:token,messageId:'77'},{env:ENV,now:NOW});
 assert.equal(repeated.status,'already-applied');assert.equal(repeated.habit.progress.lifetimeCompletedDays,1);assert.equal(fs.readFileSync(f.habit.file,'utf8'),bytes);
 assert.equal(repeated.buttons[0].callbackData,saved.buttons[0].callbackData,'receipt preserves its one Undo token');
});

test('paused offers only Resume; rest, exemptions and already completed dates offer no done action',()=>{
 const f=fixture({paused:true}),token=f.issue().buttons[0].callbackData;assert.equal(f.issue().buttons[0].text,'Resume');f.bind(token);
 const r=f.tap(token);assert.equal(r.habit.status,'active');assert.equal(r.habit.progress.lifetimeCompletedDays,0);assert.equal(r.buttons[0].text,'I did it');
 assert.match(fs.readFileSync(f.habit.file,'utf8'),/telegram-button:[a-f0-9]{32}/,'resume has real button provenance');
 assert.equal(fixture({days:'mon'}).issue().buttons.length,0);
 const skip=fixture();track(skip.habit,'2026-10-13','skip','fixture','ill');assert.equal(skip.issue().buttons.length,0);
});

test('wrong user, chat, bot, missing/open/multiowner config and malformed callback are denied without a habit',()=>{
 const f=fixture(),token=f.issue().buttons[0].callbackData;f.bind(token);const before=fs.readFileSync(f.habit.file,'utf8');
 for(const overrides of [{userId:'9'},{chatId:'9'},{chatType:'group'},{ownerId:'9'},{botId:'9'},{messageId:'9'},{callbackData:'gsh1:../escape'}]){
  const r=f.run({command:'tap',callbackData:token,messageId:'77',...overrides});assert.equal(r.ok,false);assert.equal(r.habit,undefined);
 }
 for(const allowed of ['', '*','1234,999','1234 999'])assert.equal(f.run({command:'issue',habitId:'habit-learning-a-word'},{env:{TELEGRAM_ALLOWED_USERS:allowed}}).status,'denied');
 assert.equal(fs.readFileSync(f.habit.file,'utf8'),before);
});

test('old next-day cards, changed minimum/schedule/status and optimistic hash mismatches cannot save',()=>{
 for(const change of [f=>fs.appendFileSync(f.habit.file,'\nowner note\n'),f=>setStatus(f.habit,'paused','2026-10-13'),f=>setHabitSchedule(f.habit,'mon','2026-10-13','Europe/Berlin'),f=>fs.writeFileSync(f.habit.file,fs.readFileSync(f.habit.file,'utf8').replace('Learn one new word','Learn two words'))]){
  const f=fixture(),token=f.issue().buttons[0].callbackData;f.bind(token);change(f);const bytes=fs.readFileSync(f.habit.file,'utf8');
  const r=f.tap(token);assert.equal(r.status,'stale');assert.equal(r.ok,false);assert.equal(fs.readFileSync(f.habit.file,'utf8'),bytes);
 }
 const f=fixture({zone:'Pacific/Auckland'}),token=f.issue().buttons[0].callbackData;f.bind(token);
 assert.equal(f.run({command:'tap',callbackData:token,messageId:'77'},{now:new Date('2026-10-13T11:01:00Z')}).status,'stale','local midnight expires buttons, independently of UTC date');
 assert.equal(readHabit(f.habit.file).log['2026-10-13'],undefined);
});

test('saved elsewhere refreshes without a duplicate, while a changed minimum still invalidates the card',()=>{
 const f=fixture(),token=f.issue().buttons[0].callbackData;f.bind(token);track(f.habit,'2026-10-13','done','notebook','owner UI');const before=fs.readFileSync(f.habit.file,'utf8');
 assert.equal(f.tap(token).status,'already-done');assert.equal(fs.readFileSync(f.habit.file,'utf8'),before);
 fs.writeFileSync(f.habit.file,before.replace('Learn one new word','Learn two words'));assert.equal(f.tap(token).status,'already-applied','a consumed token only refreshes, never writes again');
});

test('safe Undo removes only this own newest answer and restores any previous answer; later edits refuse Undo',()=>{
 const f=fixture();track(f.habit,'2026-10-13','no','notebook','Earlier answer');const prior=fs.readFileSync(f.habit.file,'utf8');
 const token=f.issue().buttons[0].callbackData;f.bind(token);const saved=f.tap(token),undo=saved.buttons[0].callbackData;
 assert.equal(f.tap(undo).status,'applied');assert.equal(readHabit(f.habit.file).log['2026-10-13'].answer,'no');assert.equal(fs.readFileSync(f.habit.file,'utf8'),prior);
 assert.equal(f.tap(token).status,'already-applied');assert.equal(fs.readFileSync(f.habit.file,'utf8'),prior,'retry original completion after Undo cannot redo it');
 assert.equal(f.tap(undo).status,'already-applied');
 const g=fixture(),t=g.issue().buttons[0].callbackData;g.bind(t);const u=g.tap(t).buttons[0].callbackData;track(readHabit(g.habit.file),'2026-10-13','no','notebook','correction');const edited=fs.readFileSync(g.habit.file,'utf8');
 assert.equal(g.tap(u).status,'stale');assert.equal(fs.readFileSync(g.habit.file,'utf8'),edited);
});

test('interrupted saves recover by exact durable after-hash; ambiguous pre-save attempt is consumed without retry',()=>{
 for(const stage of ['after-intent','after-save','after-receipt']){
  const f=fixture(),token=f.issue().buttons[0].callbackData;f.bind(token);
  assert.throws(()=>f.run({command:'tap',callbackData:token,messageId:'77'},{checkpoint:s=>{if(s===stage)throw Error('simulated process death');}}),/simulated/);
  const before=fs.readFileSync(f.habit.file,'utf8'),r=f.tap(token);
  assert.equal(r.status,stage==='after-intent'?'uncertain':'already-applied');assert.equal(fs.readFileSync(f.habit.file,'utf8'),before);
  assert.equal(readHabit(f.habit.file).log['2026-10-13']?.answer,stage==='after-intent'?undefined:'done');
 }
});

test('bridge accepts bounded JSON stdin and does not cold-load the notebook records tree',()=>{
 const f=fixture();fs.mkdirSync(path.join(f.root,'notebook'),{recursive:true});fs.writeFileSync(path.join(f.root,'notebook','corrupt.md'),'not a record');
 const r=spawnSync(process.execPath,['notebook/scripts/habit-button-action.mjs'],{cwd:path.resolve(import.meta.dirname,'../..'),env:{...process.env,...ENV,GODSPEED_WORKSPACE:f.root,GODSPEED_NOW:NOW.toISOString()},input:JSON.stringify({...AUTH,command:'issue',habitId:'habit-learning-a-word'}),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).buttons[0].text,'I did it');
 assert.equal(fs.existsSync(path.join(f.root,'notebook','_system')),false,'narrow service never constructs or migrates a full Store');
});

test('a legacy writer editing after preparation is never overwritten, and the attempted token cannot retry',()=>{
 const f=fixture(),token=f.issue().buttons[0].callbackData;f.bind(token);
 const result=f.run({command:'tap',callbackData:token,messageId:'77'},{checkpoint:stage=>{if(stage==='after-intent')fs.appendFileSync(f.habit.file,'\nA new owner note\n');}});
 assert.equal(result.ok,false);assert.equal(result.status,'stale');assert.match(fs.readFileSync(f.habit.file,'utf8'),/A new owner note/);
 assert.equal(readHabit(f.habit.file).log['2026-10-13'],undefined);const before=fs.readFileSync(f.habit.file,'utf8');
 assert.equal(f.tap(token).status,'uncertain');assert.equal(fs.readFileSync(f.habit.file,'utf8'),before);
});

test('DST-local midnight limits expiry; copying the token to another workspace cannot authorize a tap',()=>{
 const f=fixture(),fall=new Date('2026-10-24T23:00:00Z');
 const issued=f.run({command:'issue',habitId:'habit-learning-a-word',locale:'de'},{now:fall});assert.equal(issued.locale,'de');assert.equal(issued.buttons[0].text,'Erledigt');
 const token=issued.buttons[0].callbackData,file=path.join(f.root,'.godspeed','habit-buttons',token.slice(5)+'.json');
 const stored=JSON.parse(fs.readFileSync(file));assert.ok(stored.expiresAt<=fall.getTime()+86400000);assert.equal(stored.date,'2026-10-25');
 const g=fixture();fs.mkdirSync(path.join(g.root,'.godspeed','habit-buttons'),{recursive:true});fs.copyFileSync(file,path.join(g.root,'.godspeed','habit-buttons',path.basename(file)));
 assert.equal(g.run({command:'bind',callbackData:token,messageId:'77'},{now:fall}).status,'denied');
 assert.equal(stored.workspace,hash(fs.realpathSync(f.root)));
});
