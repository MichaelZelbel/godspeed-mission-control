import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {trackers} from '../core/trackers.mjs';
import {addArea} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {addHabit} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';

// The notebook's own chat answers in the language of the message (D-321, a leftover of steps 2 and
// 3: "German in, German out", as the bot does). A tracker's, a habit's and a headache's line is
// worked out in code in English; when the model says the message is in another language, one more
// call rewrites those lines, and the rewrite is used only when it keeps every number of the line.
function fixture(){
 process.env.GODSPEED_NOW='2026-10-12T05:00:00Z';
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-reply-language-'))),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 fs.mkdirSync(path.join(store.root,'routines','headache'),{recursive:true});
 fs.writeFileSync(path.join(store.root,'routines','headache','settings.json'),JSON.stringify({timezone:'Europe/Berlin',git_sync:'off'}));
 addArea(store.root,{slug:'health',title:'Health',rhythm:'weekly sunday',starts:'2026-10-04'});
 addHabit(store.root,{area:'health',slug:'walk-to-work',title:'Walk to work and back',days:'daily'},'2026-10-04');
 return {store,query,domains};
}
test.after(()=>{delete process.env.GODSPEED_NOW;});
// A stand-in model: the chat's answer with the language it reports, and a rewrite that `rewrite` makes.
function model(domains,{language,operations,rewrite=line=>line}){
 const calls=[];
 domains.provider=async input=>{calls.push(input.kind);
  if(input.kind==='reply-language')return {lines:input.input.lines.map(rewrite)};
  return {reply:'Done!',...(language?{language}:{}),operations};};
 return calls;
}
const say=(domains,message,ops,options={})=>{const calls=model(domains,{...options,operations:ops.map(o=>({source_quote:message,...o}))});return domains.invoke('conversation-chat',{message,conversation_id:'c1'}).then(r=>({...r,calls}));};
const GERMAN={
 'Tracked under Belly: 92 cm.':'Erfasst unter Belly: 92 cm.',
 'Tracked: walk to work and back, done today.':'Erfasst: Arbeitsweg zu Fuß, heute erledigt.',
 'Tracked: since 06:30, still going (30 min), right. How strong, 1 to 10?':'Erfasst: seit 6:30, dauert noch an (30 Min.), rechts. Wie stark, 1 bis 10?'
};

test('German in, German out: a tracker\'s line is rewritten in German, keeping its numbers',async()=>{
 const {store,domains}=fixture();
 await say(domains,'I want to track my belly in cm',[{type:'tracker-create',name:'Belly',unit:'cm'}],{language:'en'});
 const [belly]=trackers(store);
 const r=await say(domains,'track Bauch 92',[{type:'track',tracker:belly.id,value:92,new_name:'Bauch'}],{language:'de',rewrite:line=>GERMAN[line]||line});
 assert.equal(r.reply,'Erfasst unter Belly: 92 cm.');
 assert.deepEqual(r.calls,['conversation-chat','reply-language']);
});

test('a rewrite that loses a number is not used: the English line stands',async()=>{
 const {store,domains}=fixture();
 await say(domains,'I want to track my belly in cm',[{type:'tracker-create',name:'Belly',unit:'cm'}]);
 const [belly]=trackers(store);
 const r=await say(domains,'track Bauch 92',[{type:'track',tracker:belly.id,value:92,new_name:'Bauch'}],{language:'de',rewrite:()=>'Erfasst unter Belly: 29 cm.'});
 assert.equal(r.reply,'Tracked under Belly: 92 cm.');
});

test('English makes no second call, and a model that names no language changes nothing',async()=>{
 const {domains}=fixture();
 let r=await say(domains,'track walk to work',[{type:'track',tracker:'habit-health-walk-to-work'}],{language:'en'});
 assert.equal(r.reply,'Tracked: walk to work and back, done today.');assert.deepEqual(r.calls,['conversation-chat']);
 process.env.GODSPEED_NOW='2026-10-13T05:00:00Z';
 r=await say(domains,'track walk to work',[{type:'track',tracker:'habit-health-walk-to-work'}]);
 assert.deepEqual(r.calls,['conversation-chat']);
 process.env.GODSPEED_NOW='2026-10-12T05:00:00Z';
});

test('a habit and a headache answer in German too',async()=>{
 const {domains}=fixture();
 let r=await say(domains,'track Fußweg zur Arbeit',[{type:'track',tracker:'habit-health-walk-to-work'}],{language:'de',rewrite:line=>GERMAN[line]||line});
 assert.equal(r.reply,'Erfasst: Arbeitsweg zu Fuß, heute erledigt.');
 r=await say(domains,'Kopfschmerzen seit halb sieben, rechts',[{type:'headache',action:'start',at:'06:30',side:'rechts'}],{language:'de',rewrite:line=>GERMAN[line]||line});
 assert.equal(r.reply,'Erfasst: seit 6:30, dauert noch an (30 Min.), rechts. Wie stark, 1 bis 10?');
});
