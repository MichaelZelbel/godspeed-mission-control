import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {chatContext} from '../core/chat-context.mjs';
import {addonCommand} from '../core/native-personal.mjs';
import {charmArgs,charmConversation,CHARM_ACTIONS} from '../core/charm-operation.mjs';
import {readEvents} from '../../third-party/addons/godspeed-charm/lib/record.mjs';
import {findTracker} from '../../third-party/addons/godspeed-charm/lib/notebook.mjs';

// The Charm Challenge in the notebook's own chat (spec 2026-10-21, "Where it works"): a `charm`
// operation reaches the godspeed-charm command through addonCommand, the conversation is always
// this chat's own, and the answer is the command's own line. The model here is a stand-in that
// returns what a model would; the checks, the writes and the replies are the notebook's own.
// The add-on runs as a child process with this process's environment, so GODSPEED_CHARM_NOW is
// its clock as well as the notebook's.
const START='2026-10-21T08:00:00Z'; // 10:00 in Berlin, a Wednesday
function fixture(now=START){
 process.env.GODSPEED_CHARM_NOW=now;
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-charm-'))),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 return {store,query,domains};
}
test.after(()=>{delete process.env.GODSPEED_CHARM_NOW;});
const op=(domains,input)=>domains.invoke('personal-operation',{type:'charm',...input});
// A stand-in model: its own reply, the language it reports and the operations it asks for.
function model(domains,{reply='Here is the fixed draft.',language='en',operations=[]}={}){
 const calls=[];
 domains.provider=async input=>{calls.push(input);if(input.kind==='reply-language')return {lines:input.input.lines};return {reply,language,operations};};
 return calls;
}
const say=(domains,message,ops,options={})=>{const calls=model(domains,{...options,operations:ops.map(o=>({type:'charm',source_quote:message,...o}))});return domains.invoke('conversation-chat',{message,conversation_id:options.conversation||'c1'}).then(r=>({...r,calls}));};

test('a charm start returns the exact start line, and status the count',async()=>{
 const {store,domains}=fixture();
 const started=await op(domains,{action:'start',words:'start the Charm Challenge'});
 assert.equal(started.ok,true);
 assert.equal(started.reply,'Charm Challenge started. 21 days to go, done on Wednesday 11 November.');
 assert.equal(started.state.running,true);
 assert.equal(findTracker(store.root).tracker.specialist,'charm');
 // The installation's timezone is the challenge's day boundary, as for the other add-ons.
 assert.equal(JSON.parse(fs.readFileSync(path.join(store.root,'routines','charm','settings.json'),'utf8')).timezone,'Europe/Berlin');
 process.env.GODSPEED_CHARM_NOW='2026-10-30T08:00:00Z';
 const status=await op(domains,{action:'status'});
 assert.equal(status.reply,'12 days to go, done on Wednesday 11 November. Longest run so far: 9 days. Restarts: 0.');
 // German in, German out: the command's own German line.
 assert.equal((await op(domains,{action:'status',language:'de'})).reply,'Noch 12 Tage, fertig am Mittwoch, 11. November. Längste Serie bisher: 9 Tage. Neustarts: 0.');
 // No routine is made for it: the Charm Challenge has no jobs.
 assert.deepEqual(store.list('jobs').map(j=>j.id).filter(id=>/tick|cycle/.test(id)),[]);
});

test('a refusal is a plain sentence, never "Personal command failed"',async()=>{
 const {domains}=fixture();
 const stopped=await op(domains,{action:'stop',words:'stop the Charm Challenge'});
 assert.deepEqual({ok:stopped.ok,reply:stopped.reply},{ok:false,reply:'No Charm Challenge is running. Say the word and we start one.'});
 // Asking and answering belong to a notebook chat: without one, a plain error, nothing written.
 await assert.rejects(op(domains,{action:'asked',words:'garbage'}),/Only a chat in the notebook/);
 await assert.rejects(op(domains,{action:'dance'}),/start, status, asked, answer, slip or stop/);
});

test('the command line: this chat\'s conversation, their words, the language',()=>{
 assert.deepEqual(CHARM_ACTIONS,['start','status','asked','answer','slip','stop']);
 assert.equal(charmConversation('c1'),'notebook:c1');assert.equal(charmConversation('notebook:abc:session:x'),'notebook:abc:session:x');assert.equal(charmConversation(''),'');
 assert.deepEqual(charmArgs({action:'asked',words:'why is this garbage',language:'de'},'notebook:c1'),['asked','--conversation','notebook:c1','--words','why is this garbage','--language','de']);
 assert.deepEqual(charmArgs({action:'answer',answer:'yes',source_quote:'ja'},'notebook:c1'),['answer','yes','--conversation','notebook:c1','--words','ja']);
 assert.deepEqual(charmArgs({action:'status',language:'fr'},'notebook:c1'),['status']);
 assert.throws(()=>charmArgs({action:'answer',answer:'maybe'},'notebook:c1'),/yes or no/);
});

test('addonCommand runs the charm commands it allows and refuses setup',()=>{
 const {store}=fixture();
 assert.throws(()=>addonCommand(store,{addon:'charm',args:['setup']}),/not available through the notebook/);
 assert.throws(()=>addonCommand(store,{addon:'charm',args:['check']}),/not available through the notebook/);
 const status=JSON.parse(addonCommand(store,{addon:'charm',args:['status']}).result);
 assert.deepEqual({ok:status.ok,reply:status.reply},{ok:true,reply:'No Charm Challenge is running. Say the word and we start one.'});
 // A refusal (exit 2) is an error that carries the plain sentence and the state.
 try{addonCommand(store,{addon:'charm',args:['stop']});assert.fail('a stop with nothing running is refused');}
 catch(error){assert.equal(error.message,'No Charm Challenge is running. Say the word and we start one.');assert.equal(error.refusal.reply,error.message);assert.equal(error.refusal.state.running,false);}
 // A settings file nobody can read refuses in a plain sentence too, and writes nothing.
 fs.mkdirSync(path.join(store.root,'routines','charm'),{recursive:true});fs.writeFileSync(path.join(store.root,'routines','charm','settings.json'),'{not json');
 assert.throws(()=>addonCommand(store,{addon:'charm',args:['start']}),error=>!!error.refusal&&/cannot read its settings/.test(error.message)&&!/Personal command failed/.test(error.message));
 assert.equal(findTracker(store.root),null);
});

test('generic track on the charm tracker is refused, and "track charm" never makes a tracker',async()=>{
 const {store,domains}=fixture();
 await op(domains,{action:'start',words:'start the Charm Challenge'});
 const charm=findTracker(store.root),said='The Charm Challenge keeps its own count: say "start the Charm Challenge" or "charm slip".';
 await assert.rejects(domains.invoke('personal-operation',{type:'track',tracker:charm.id,value:3}),error=>error.message===said);
 await assert.rejects(domains.invoke('personal-operation',{type:'tracker-correct',tracker:'Charm Challenge',remove:true}),error=>error.message===said);
 await assert.rejects(domains.invoke('personal-operation',{type:'tracker-hold',name:'Charm'}),error=>error.message===said);
});

test('in the chat: a slip keeps the model\'s own reply and ends with the question; yes resets here only',async()=>{
 const {store,query,domains}=fixture();
 let r=await say(domains,'start the Charm Challenge',[{action:'start'}]);
 assert.equal(r.reply,'Charm Challenge started. 21 days to go, done on Wednesday 11 November.');
 process.env.GODSPEED_CHARM_NOW='2026-10-30T08:00:00Z';
 // The block the model is given names this chat's conversation and says the steps as operations.
 const block=chatContext(query,{message:'why is this garbage again, fix the date',conversation_id:'c1'}).personal.charm;
 assert.match(block,/^\[godspeed-charm\] The person is doing the Charm Challenge: day 10 of 21, 12 days to go/);
 assert.ok(block.includes('charm {action:"asked", words:<their message>}'));assert.doesNotMatch(block,/godspeed-charm asked|--conversation/);
 // R14: the work first, in the model's own words, then the one question at the end.
 r=await say(domains,'why is this garbage again, fix the date',[{action:'asked',conversation:'notebook:somewhere-else'}],{reply:'Fixed: the date is now 30 October.'});
 assert.equal(r.reply,'Fixed: the date is now 30 October. That sounded like a slip. Back to 21? Yes / No.');
 const asked=readEvents(store.root).at(-1);
 assert.deepEqual({kind:asked.kind,conversation:asked.conversation,words:asked.words},{kind:'asked',conversation:'notebook:c1',words:'why is this garbage again, fix the date'},'the conversation is the chat\'s own, never the model\'s');
 assert.match(chatContext(query,{message:'yes',conversation_id:'c1'}).personal.charm,/Open question in this conversation: after their words "why is this garbage again, fix the date" earlier today/);
 // A yes in another chat answers nothing here: the operation is refused before anything runs.
 await assert.rejects(say(domains,'yes',[{action:'answer',answer:'yes'}],{conversation:'c2'}),/no open question/i);
 assert.doesNotMatch(chatContext(query,{message:'yes',conversation_id:'c2'}).personal.charm,/Open question/);
 // A note's chat runs no operations, so it is given no block to act on.
 const note=store.save('notes',{title:'Draft',content:'A draft.'});
 assert.equal(chatContext(query,{message:'why is this garbage',conversation_id:'c1',note_id:note.id}).personal.charm,null);
 // An answer must be the yes or no the message says.
 await assert.rejects(say(domains,'no',[{action:'answer',answer:'yes'}]),/yes or a no/i);
 await assert.rejects(say(domains,'yes, but only if you fix it',[{action:'answer',answer:'yes'}]),/yes or a no/i);
 r=await say(domains,'yes',[{action:'answer',answer:'yes'}]);
 assert.equal(r.reply,'Back to 21. Done on Friday 20 November. Restarts: 1.');
 // A reset today: a second slip question is refused by the command, and nothing is added.
 r=await say(domains,'this is useless, try again',[{action:'asked'}],{reply:'Here is a second try.'});
 assert.equal(r.reply,'Here is a second try.');
 assert.equal(readEvents(store.root).filter(e=>e.kind==='asked').length,1);
});

test('a slip resets only on plain words; a story is a question',async()=>{
 const {store,domains}=fixture();
 await say(domains,'start the Charm Challenge',[{action:'start'}]);
 process.env.GODSPEED_CHARM_NOW='2026-10-25T08:00:00Z';
 await assert.rejects(say(domains,'I yelled at Copilot again',[{action:'slip'}]),/charm slip/);
 assert.equal(readEvents(store.root).some(e=>e.kind==='reset'),false);
 let r=await say(domains,'I yelled at Copilot again',[{action:'asked'}],{reply:'That happens.'});
 assert.equal(r.reply,'That happens. That sounded like a slip. Back to 21? Yes / No.');
 r=await say(domains,'charm slip',[{action:'slip'}],{reply:'ignored'});
 assert.equal(r.reply,'Back to 21. Done on Sunday 15 November. Restarts: 1.');
 // German in, German out, without a rewrite call: the command speaks German itself.
 process.env.GODSPEED_CHARM_NOW='2026-10-26T08:00:00Z';
 r=await say(domains,'wie steht meine Charm Challenge?',[{action:'status'}],{language:'de'});
 assert.equal(r.reply,'Noch 20 Tage, fertig am Sonntag, 15. November. Längste Serie bisher: 4 Tage. Neustarts: 1.');
 assert.deepEqual(r.calls.map(c=>c.kind),['conversation-chat']);
});

test('their words arrive as they were said, a leading dash included; the question in German',async()=>{
 const {store,domains}=fixture();
 await say(domains,'start the Charm Challenge',[{action:'start'}]);
 process.env.GODSPEED_CHARM_NOW='2026-10-23T08:00:00Z';
 let r=await say(domains,'--seriously? this is garbage\nagain',[{action:'asked'}],{reply:'Here it is.'});
 assert.equal(r.reply,'Here it is. That sounded like a slip. Back to 21? Yes / No.');
 assert.equal(readEvents(store.root).at(-1).words,'--seriously? this is garbage\nagain');
 assert.deepEqual(fs.readdirSync(path.join(store.state,'charm-words')),[],'the words file is gone');
 r=await say(domains,'Was soll dieser Mist schon wieder?',[{action:'asked'}],{reply:'Hier ist die Korrektur.',language:'de',conversation:'c3'});
 assert.equal(r.reply,'Hier ist die Korrektur. Das klang nach einem Ausrutscher. Zurück auf 21? Ja / Nein.');
});

test('/charm runs the command like /headache, a refusal included; nothing is scheduled',async()=>{
 const {store,domains}=fixture();
 let r=await domains.invoke('conversation-chat',{message:'/charm start',conversation_id:'notebook:personal-commands'});
 assert.equal(JSON.parse(r.reply).reply,'Charm Challenge started. 21 days to go, done on Wednesday 11 November.');
 r=await domains.invoke('conversation-chat',{message:'/charm stop',conversation_id:'notebook:personal-commands'});
 assert.equal(JSON.parse(r.reply).ok,true);
 r=await domains.invoke('conversation-chat',{message:'/charm stop',conversation_id:'notebook:personal-commands'});
 assert.deepEqual(JSON.parse(r.reply),{ok:false,reply:'No Charm Challenge is running. Say the word and we start one.',state:JSON.parse(r.reply).state});
 await assert.rejects(domains.invoke('conversation-chat',{message:'/charm setup',conversation_id:'notebook:personal-commands'}),/not available through the notebook/);
 assert.ok(!store.get('jobs','journal-tick'));assert.ok(!store.get('jobs','coach-tick'));
});

test('the chat block: empty when nothing runs, quiet when the record cannot be read',()=>{
 const {store,query}=fixture();
 assert.equal(chatContext(query,{message:'hello',conversation_id:'c1'}).personal.charm,null);
 fs.mkdirSync(path.join(store.root,'routines','charm'),{recursive:true});fs.writeFileSync(path.join(store.root,'routines','charm','settings.json'),'{not json');
 assert.equal(chatContext(query,{message:'hello',conversation_id:'c1'}).personal.charm,null);
});

test('the assistant is told where the charm command and its mission control are, as for the headache',async()=>{
 const {assistantEnvironment}=await import('../core/assistant-files.mjs');
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-charm-env-')),workspace=path.join(base,'workspace');
 const env=assistantEnvironment({home:path.join(base,'hermes'),workspace,env:{PATH:process.env.PATH||''}});
 assert.equal(env.GODSPEED_CHARM_DIR,workspace);
 assert.ok(fs.existsSync(env.GODSPEED_CHARM_SCRIPT),env.GODSPEED_CHARM_SCRIPT);assert.match(env.GODSPEED_CHARM_SCRIPT,/godspeed-charm[\\/]bin[\\/]godspeed-charm\.mjs$/);
 assert.equal(env.GODSPEED_NODE,process.execPath);
});
