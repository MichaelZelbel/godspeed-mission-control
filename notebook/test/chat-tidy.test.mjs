import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {routineFiles,writeRoutineFiles} from '../core/starting-routines.mjs';
import {CHAT_TIDY_SCRIPT} from '../core/notebook-routines.mjs';

// THE NIGHT CHAT TIDY-UP (26 October 2026), the routine that summarises the long chat with the
// assistant while nobody waits for an answer (godspeed_routines.py, chat_tidy). Every rule it holds
// itself to is checked here against a seeded state.db and a stand-in for the assistant's control
// channel, because the one thing this routine must never do is rewrite a conversation that is not
// the owner's chat or is still in use: on 26 October 2026 a hand test whose copy step failed went
// on to summarise the live chat instead of the copy.
//
// The stand-in is a real tui_gateway.entry module in a folder of its own, named to the routine as
// the assistant's source folder, so what runs is the routine's own command (<python> -m
// tui_gateway.entry) and not a shortcut made for the test. It answers from a plan the test writes
// and records every request it was sent, so "it compressed nothing" is a fact about the record.

// The interpreter by its own full path, because the install names the assistant's Python by path
// (starting-routines.mjs, hermesRuntime) and the routine refuses anything it cannot find as a file.
const python=['python3','python'].reduce((found,p)=>{if(found)return found;
 try{return execFileSync(p,['-c','import sys;print(sys.executable)'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()||null;}catch{return null;}},null);
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-tidy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const CHAT='chat-session-1',OTHER='other-session-2';
const CHANNEL=`import json, os, sys

plan = json.load(open(os.environ["CHANNEL_PLAN"], encoding="utf-8"))
seen = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    seen.append({"method": msg.get("method"), "params": msg.get("params")})
    with open(os.environ["CHANNEL_RECORD"], "w", encoding="utf-8") as f:
        json.dump(seen, f)
    answer = plan.get(msg.get("method"))
    if answer and answer.get("move_route_to"):   # the gateway re-routes the chat meanwhile
        import sqlite3
        con = sqlite3.connect(os.path.join(os.environ["HERMES_HOME"], "state.db"))
        con.execute("update gateway_routing set entry_json = ?", (json.dumps({"session_id": answer["move_route_to"]}),))
        con.commit()
        con.close()
    if answer is None:            # a step this channel never answers
        continue
    if answer.get("delete_messages"):   # what the gateway's own /compress does to the chat
        import sqlite3
        con = sqlite3.connect(os.path.join(os.environ["HERMES_HOME"], "state.db"))
        con.execute("delete from messages where rowid in (select rowid from messages where session_id = ? limit ?)",
                    (answer.get("from", "chat-session-1"), answer["delete_messages"]))
        con.commit()
        con.close()
    out = {"jsonrpc": "2.0", "id": msg.get("id")}
    out["error" if "error" in answer else "result"] = answer.get("error", answer)
    sys.stdout.write(json.dumps(out) + "\\n")
    sys.stdout.flush()
`;

// The whole chat the routine could find: the routing table, the stored conversations, their messages
// and any open turn lease, in the tables the routine reads.
function seed(home,{routed=CHAT,tokens=174000,quietMinutes=60,lease=null,anchor=true,chain=null}={}){
 const db=new DatabaseSync(path.join(home,'state.db'));
 db.exec('create table gateway_routing(scope text, session_key text, entry_json text);'
  +'create table sessions(id text primary key, model_config text, parent_session_id text);'
  +'create table messages(session_id text, timestamp real, role text, content text);'
  +'create table session_turn_leases(conversation_id text, expires_at real);');
 const now=Date.now()/1000;
 const config=tokens===null||!anchor?JSON.stringify({model:'x'}):JSON.stringify({model:'x',_usage_anchor:{prompt_tokens:tokens}});
 db.prepare('insert into gateway_routing values (?,?,?)').run(path.join(home,'sessions'),'agent:main:telegram:dm:4242',JSON.stringify({session_id:routed}));
 db.prepare('insert into sessions values (?,?,?)').run(CHAT,config,chain);
 if(chain)db.prepare('insert into sessions values (?,?,?)').run(chain,JSON.stringify({model:'x'}),null);
 db.prepare('insert into sessions values (?,?,?)').run(OTHER,JSON.stringify({model:'x',_usage_anchor:{prompt_tokens:120000}}),null);
 for(let i=0;i<4;i++)db.prepare('insert into messages values (?,?,?,?)').run(CHAT,now-quietMinutes*60-i*60,'user','a message of the chat');
 for(let i=0;i<3;i++)db.prepare('insert into messages values (?,?,?,?)').run(OTHER,now-5*3600-i*60,'user','a message of the other conversation');
 if(lease)db.prepare('insert into session_turn_leases values (?,?)').run(lease,now+600);
 db.close();
}

// A throwaway Hermes home with the routine's own files in it, exactly the ones the notebook writes,
// and the stand-in named as the assistant's Python and source folder.
function home(t,{plan,seeded={},entry=CHANNEL}={}){
 const root=temporary(t),hermes=path.join(root,'hermes'),channel=path.join(root,'channel');
 fs.mkdirSync(hermes,{recursive:true});fs.mkdirSync(path.join(channel,'tui_gateway'),{recursive:true});
 fs.writeFileSync(path.join(channel,'tui_gateway','__init__.py'),'');
 fs.writeFileSync(path.join(channel,'tui_gateway','entry.py'),entry);
 const files=routineFiles({root,home:hermes,state:path.join(root,'.godspeed'),timezone:'Europe/Berlin',hermes:null});
 files['godspeed-routines.json']=JSON.stringify({...JSON.parse(files['godspeed-routines.json']),hermes_python:python,hermes_source:channel},null,2)+'\n';
 writeRoutineFiles(hermes,files);
 seed(hermes,seeded);
 const planFile=path.join(root,'plan.json'),record=path.join(root,'record.json');
 fs.writeFileSync(planFile,JSON.stringify(plan||{}));
 // Run as the routine runs it: the small script file the notebook wrote, in the scripts folder.
 const run=(args=[])=>{
  const r=spawnSync(python,[path.join(hermes,'scripts',CHAT_TIDY_SCRIPT),...args],
   {cwd:path.join(hermes,'scripts'),encoding:'utf8',windowsHide:true,timeout:120000,
    env:{...process.env,PYTHONIOENCODING:'utf-8',CHANNEL_PLAN:planFile,CHANNEL_RECORD:record}});
  return {code:r.status,said:r.stdout||'',log:r.stderr||''};
 };
 const asked=()=>{try{return JSON.parse(fs.readFileSync(record,'utf8'));}catch{return [];}};
 const rows=id=>{const db=new DatabaseSync(path.join(hermes,'state.db'),{readOnly:true});
  const out=JSON.stringify([db.prepare('select * from sessions where id = ?').all(id),
   db.prepare('select * from messages where session_id = ? order by timestamp').all(id)]);db.close();return out;};
 return {root,hermes,run,asked,rows};
}
const created={session_id:'hidden-2',stored_session_id:'hidden-stored-2'};
const ran={type:'plugin',output:'ok: chat-session-1'};
const KEY='agent:main:telegram:dm:4242';
const needs={skip:!python&&'needs Python'};
const methods=chat=>chat.asked().map(a=>a.method);

test('the long chat is summarised through the plugin command on the hidden session, and tidied only when it got shorter',needs,async t=>{
 const chat=home(t,{plan:{'session.create':created,'command.dispatch':{...ran,delete_messages:2}}});
 const before=chat.rows(OTHER);
 const {code,said,log}=chat.run();
 // What the pull request quotes: the routine's own log of a tidied chat.
 for(const line of log.trim().split('\n'))console.log('chat-tidy log: '+line);
 assert.equal(code,0,log);
 assert.equal(said,'','it says nothing to the person: its output is its log');
 assert.match(log,/chat chat-session-1: last prompt 174000 tokens, last message 60 min ago, open leases 0/);
 assert.match(log,/tidied in \d+ s: ok: chat-session-1; messages 4 -> 2/);
 assert.deepEqual(methods(chat),['session.create','command.dispatch']);
 assert.deepEqual(chat.asked()[0].params,{title:'Godspeed chat tidy',hidden:true});
 const dispatch=chat.asked()[1].params;
 assert.deepEqual(dispatch,{name:'godspeed-chat-tidy',arg:KEY+' '+CHAT,session_id:'hidden-2'});
 assert.equal(chat.rows(OTHER),before,'the second stored conversation is left byte-for-byte alone');
});

test('two nights leave no hidden-session row in the assistant\'s database',needs,async t=>{
 const chat=home(t,{plan:{'session.create':created,'command.dispatch':{...ran}}});
 const before=chat.rows('hidden-2');
 for(let night=0;night<2;night++){const {code,log}=chat.run();assert.equal(code,0,log);}
 assert.deepEqual(methods(chat).filter(m=>m==='session.create').length,1,'each run makes one; the stand-in\'s record restarts per run');
 assert.equal(chat.rows('hidden-2'),before,'no row for the hidden session');
 assert.equal(JSON.parse(chat.rows('hidden-2'))[0].length,0);
 const db=new DatabaseSync(path.join(chat.hermes,'state.db'),{readOnly:true});
 const hiddenRows=db.prepare("select count(*) as n from sessions where id in ('hidden-2','hidden-stored-2')").get().n;db.close();
 assert.ok(hiddenRows<=1);
});

test('a route that moves during the summary is logged and is never tidied',needs,async t=>{
 const chat=home(t,{plan:{'session.create':created,'command.dispatch':{...ran,delete_messages:2,move_route_to:OTHER}}});
 const {code,log}=chat.run();
 assert.equal(code,0,log);
 assert.match(log,/route moved during the summary: not tidied/);
 assert.doesNotMatch(log,/tidied in/);
});

test('a refusal, or a chat that did not get shorter, is logged and is no failed run',needs,async t=>{
 const refused=home(t,{plan:{'session.create':created,'command.dispatch':{type:'plugin',output:'refused: a turn for this chat is running'}}});
 const one=refused.run();
 assert.equal(one.code,0,one.log);
 assert.match(one.log,/not summarised: refused: a turn for this chat is running/);
 assert.doesNotMatch(one.log,/tidied/);
 const same=home(t,{plan:{'session.create':created,'command.dispatch':ran}});
 const two=same.run();
 assert.equal(two.code,0,two.log);
 assert.match(two.log,/not tidied: ok: chat-session-1; messages 4 -> 4/);
 assert.doesNotMatch(two.log,/\btidied in\b/);
});

test('an answer that is neither ok nor refused is a failed run',needs,async t=>{
 const chat=home(t,{plan:{'session.create':created,'command.dispatch':{type:'plugin',output:'compressed!'}}});
 const {code,log}=chat.run();
 assert.equal(code,1);
 assert.match(log,/The summary command answered 'compressed!'/);
});

test('a chat in use is left alone: a message five minutes old, or an open turn lease',needs,async t=>{
 const fresh=home(t,{plan:{'session.create':created},seeded:{quietMinutes:5}});
 const fiveMinutes=fresh.run();
 for(const line of fiveMinutes.log.trim().split('\n'))console.log('chat-tidy log: '+line);
 assert.equal(fiveMinutes.code,0,fiveMinutes.log);
 assert.match(fiveMinutes.log,/skip: in use \(quiet for less than 30 min\)/);
 assert.deepEqual(fresh.asked(),[],'the control channel was never started');
 // A turn lease is kept under the lineage root, so it counts for the conversation that continues it.
 const leased=home(t,{plan:{'session.create':created},seeded:{chain:'root-session-0',lease:'root-session-0'}});
 const open=leased.run();
 assert.equal(open.code,0,open.log);
 assert.match(open.log,/open leases 1/);assert.match(open.log,/skip: a turn is open/);
 assert.deepEqual(leased.asked(),[]);
});

test('a chat that is short, or had no reply since the last summary, is left alone',needs,async t=>{
 const short=home(t,{plan:{'session.create':created},seeded:{tokens:20000}});
 const small=short.run();
 assert.equal(small.code,0,small.log);
 assert.match(small.log,/skip: below 60000 tokens/);
 assert.deepEqual(short.asked(),[]);
 const summarised=home(t,{plan:{'session.create':created},seeded:{anchor:false}});
 const again=summarised.run();
 assert.equal(again.code,0,again.log);
 assert.match(again.log,/last prompt unknown tokens/);
 assert.match(again.log,/skip: no reply since the last summary/);
 assert.deepEqual(summarised.asked(),[]);
});

test('a route that moves while the hidden session is opened stops the run before the command',needs,async t=>{
 const chat=home(t,{plan:{'session.create':{...created,move_route_to:OTHER},'command.dispatch':{...ran,delete_messages:2}}});
 const {code,log}=chat.run();
 assert.equal(code,1);
 assert.match(log,/The chat moved before the summary; stopping\./);
 assert.ok(!methods(chat).includes('command.dispatch'),'nothing was summarised');
});

test('a dry run finds the chat and opens nothing',needs,async t=>{
 const chat=home(t,{plan:{'session.create':created,'command.dispatch':ran}});
 const {code,log}=chat.run(['--dry-run']);
 assert.equal(code,0,log);
 assert.match(log,/dry run: would summarise chat-session-1 \(4 messages\)/);
 assert.deepEqual(chat.asked(),[]);
});

test('two chats of the owner\'s in the routing table stop it: it could be the wrong one',needs,async t=>{
 const chat=home(t,{plan:{'session.create':created}});
 const db=new DatabaseSync(path.join(chat.hermes,'state.db'));
 db.prepare('insert into gateway_routing values (?,?,?)').run(path.join(chat.hermes,'sessions'),'agent:main:telegram:dm:99',JSON.stringify({session_id:OTHER}));
 db.close();
 const {code,log}=chat.run();
 assert.equal(code,1);
 assert.match(log,/Expected one chat of the owner's in the assistant's routing table, found 2\./);
 assert.deepEqual(chat.asked(),[]);
});

test('a chat app connected but no message yet: nothing to tidy up, and no failed run',needs,async t=>{
 // The routine is made the moment a chat app is connected, which on a fresh install is before the
 // first message gives the gateway anything to route.
 const chat=home(t,{plan:{'session.create':created}});
 const db=new DatabaseSync(path.join(chat.hermes,'state.db'));
 db.exec('delete from gateway_routing');db.close();
 const {code,said,log}=chat.run();
 assert.equal(code,0,'a night with no chat to tidy up is not a failure');
 assert.equal(said,'');
 assert.match(log,/skip: the assistant routes no chat of the owner's yet/);
 assert.deepEqual(chat.asked(),[],'the control channel was never started');
});

test('the routing table decides which chat app it is, so another one needs no new code',needs,async t=>{
 const chat=home(t,{plan:{'session.create':created,'command.dispatch':{...ran,delete_messages:1}}});
 const db=new DatabaseSync(path.join(chat.hermes,'state.db'));
 db.exec('delete from gateway_routing');
 db.prepare('insert into gateway_routing values (?,?,?)').run(path.join(chat.hermes,'sessions'),'agent:main:signal:dm:7',JSON.stringify({session_id:CHAT}));
 // A group chat and another scope are not the owner's own chat, and are never counted.
 db.prepare('insert into gateway_routing values (?,?,?)').run(path.join(chat.hermes,'sessions'),'agent:main:telegram:group:8',JSON.stringify({session_id:OTHER}));
 db.prepare('insert into gateway_routing values (?,?,?)').run('/somewhere/else/sessions','agent:main:telegram:dm:9',JSON.stringify({session_id:OTHER}));
 db.close();
 const {code,log}=chat.run();
 assert.equal(code,0,log);
 assert.equal(chat.asked()[1].params.arg,'agent:main:signal:dm:7 '+CHAT);
 assert.match(log,/tidied in \d+ s/);
});

test('the assistant\'s own terminal is no chat app: its conversations beside the Telegram chat do not count',needs,async t=>{
 const chat=home(t,{plan:{'session.create':created,'command.dispatch':{...ran,delete_messages:1}}});
 const db=new DatabaseSync(path.join(chat.hermes,'state.db'));
 // How the assistant routes a conversation in its own terminal or desktop app, one key each, in the
 // same scope as the chat app's.
 for(const id of ['local-1','local-2'])db.prepare('insert into gateway_routing values (?,?,?)')
  .run(path.join(chat.hermes,'sessions'),'agent:main:local:dm:'+id,JSON.stringify({session_id:OTHER}));
 db.close();
 const {code,log}=chat.run();
 assert.equal(code,0,log);
 assert.match(log,/chat chat-session-1: /,'the Telegram chat is the one it found');
 assert.equal(chat.asked()[1].params.arg,KEY+' '+CHAT);
});

test('a channel that ends says why, in the assistant\'s own words',needs,async t=>{
 const refused='import sys\nsys.stderr.write("[gateway-exit] refused: this home is owned by a running gateway; attach to it instead\\n")\nsys.exit(1)\n';
 const chat=home(t,{entry:refused,plan:{}});
 const {code,log}=chat.run();
 assert.equal(code,1);
 assert.match(log,/session\.create: the assistant's control channel exited \(1\): \[gateway-exit\] refused: this home is owned by a running gateway/);
 assert.deepEqual(chat.asked(),[]);
});

test('the routine\'s own script file and the install\'s paths, as the notebook writes them',needs,async t=>{
 const chat=home(t,{plan:{}});
 const script=fs.readFileSync(path.join(chat.hermes,'scripts',CHAT_TIDY_SCRIPT),'utf8');
 assert.match(script,/main\("chat-tidy"\)/);
 const config=JSON.parse(fs.readFileSync(path.join(chat.hermes,'scripts','godspeed-routines.json'),'utf8'));
 assert.equal(config.home,chat.hermes);assert.equal(config.root,chat.root);
 assert.ok('hermes_python' in config&&'hermes_source' in config);
 // Nothing of the server this was ported from is left in the routine's text.
 const runner=fs.readFileSync(path.join(chat.hermes,'scripts','godspeed_routines.py'),'utf8');
 for(const gone of [/\/root\/godspeed/,/opt\/hermes-src/,/Michael/i])assert.ok(!gone.test(runner),'left over: '+gone);
});
