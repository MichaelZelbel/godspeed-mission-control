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
    if answer is None:            # a step this channel never answers
        continue
    out = {"jsonrpc": "2.0", "id": msg.get("id")}
    out["error" if "error" in answer else "result"] = answer.get("error", answer)
    sys.stdout.write(json.dumps(out) + "\\n")
    sys.stdout.flush()
`;

// A RUNNING GATEWAY, as a current assistant has one wherever a chat app is connected: its stdio
// channel then refuses to start (the real one says "[gateway-exit] refused: <home> is owned by a
// running gateway; attach to it instead"), and the assistant's own client attaches to the gateway.
// The stand-in has the three modules the routine's channel uses for that, answering from the same
// plan and recording into the same record, each request marked as one the gateway was sent.
const REFUSED=`import sys
sys.stderr.write("[gateway-exit] refused: this home is owned by a running gateway; attach to it instead\\n")
sys.exit(1)
`;
const GATEWAY={
 'hermes_constants.py':`import os
from pathlib import Path
def get_hermes_home():
    return Path(os.environ["HERMES_HOME"])
`,
 'hermes_cli/__init__.py':'',
 'hermes_cli/gateway_runtime.py':`class Found:
    state = "ready"
    endpoint = "the-running-gateway"
def discover_gateway_endpoint(home, timeout=2.0):
    return Found()
def attachable(found):
    return found.state == "ready" and found.endpoint is not None
`,
 'hermes_cli/gateway_client.py':`import asyncio, json, os
from contextlib import asynccontextmanager
class GatewayRPCError(ValueError):
    def __init__(self, reason, code=None, data=None):
        super().__init__(reason)
        self.code, self.data = code, data or {}
class Client:
    def __init__(self, endpoint):
        self.endpoint, self.events, self.seen = endpoint, asyncio.Queue(), []
    async def rpc(self, method, *, _timeout=None, **params):
        self.seen.append({"method": method, "params": params, "via": self.endpoint})
        with open(os.environ["CHANNEL_RECORD"], "w", encoding="utf-8") as f:
            json.dump(self.seen, f)
        answer = json.load(open(os.environ["CHANNEL_PLAN"], encoding="utf-8")).get(method)
        if answer is None:
            await asyncio.sleep(3600)
        if "error" in answer:
            raise GatewayRPCError(answer["error"])
        return answer
@asynccontextmanager
async def connect_gateway(endpoint=None, subject=None, *, max_size=None):
    yield Client(endpoint)
`};

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
function home(t,{plan,seeded={},gateway=false,entry=gateway?REFUSED:CHANNEL}={}){
 const root=temporary(t),hermes=path.join(root,'hermes'),channel=path.join(root,'channel');
 fs.mkdirSync(hermes,{recursive:true});fs.mkdirSync(path.join(channel,'tui_gateway'),{recursive:true});
 fs.writeFileSync(path.join(channel,'tui_gateway','__init__.py'),'');
 fs.writeFileSync(path.join(channel,'tui_gateway','entry.py'),entry);
 if(gateway)for(const [name,text] of Object.entries(GATEWAY)){
  fs.mkdirSync(path.dirname(path.join(channel,name)),{recursive:true});fs.writeFileSync(path.join(channel,name),text);
 }
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
const resumed=(extra={})=>({session_id:'live-1',resumed:CHAT,status:'idle',message_count:320,...extra});
const compressed={status:'compressed',before_messages:320,after_messages:20,before_tokens:174000,after_tokens:45000};
const needs={skip:!python&&'needs Python'};

test('the long chat is summarised and closed, and nothing else is touched',needs,async t=>{
 const chat=home(t,{plan:{'session.resume':resumed(),'session.compress':compressed,'session.close':{closed:true}}});
 const before=chat.rows(OTHER);
 const {code,said,log}=chat.run();
 // What the pull request quotes: the routine's own log of a summarised chat.
 for(const line of log.trim().split('\n'))console.log('chat-tidy log: '+line);
 assert.equal(code,0,log);
 assert.equal(said,'','it says nothing to the person: its output is its log');
 assert.match(log,/chat chat-session-1: last prompt 174000 tokens, last message 60 min ago, open leases 0/);
 assert.match(log,/summarised in \d+ s: status compressed, messages 320 -> 20, about 174000 -> 45000 tokens/);
 assert.deepEqual(chat.asked().map(a=>a.method),['session.resume','session.compress','session.close']);
 assert.ok(chat.asked().every(a=>JSON.stringify(a.params).includes('chat-session-1')||JSON.stringify(a.params).includes('live-1')),
  'only the owner\'s chat and the conversation the resume opened are ever named');
 assert.equal(chat.rows(OTHER),before,'the second stored conversation is left byte-for-byte alone');
});

test('a chat in use is left alone: a message five minutes old, or an open turn lease',needs,async t=>{
 const fresh=home(t,{plan:{'session.resume':resumed()},seeded:{quietMinutes:5}});
 const fiveMinutes=fresh.run();
 for(const line of fiveMinutes.log.trim().split('\n'))console.log('chat-tidy log: '+line);
 assert.equal(fiveMinutes.code,0,fiveMinutes.log);
 assert.match(fiveMinutes.log,/skip: in use \(quiet for less than 30 min\)/);
 assert.deepEqual(fresh.asked(),[],'the control channel was never started');
 // A turn lease is kept under the lineage root, so it counts for the conversation that continues it.
 const leased=home(t,{plan:{'session.resume':resumed()},seeded:{chain:'root-session-0',lease:'root-session-0'}});
 const open=leased.run();
 assert.equal(open.code,0,open.log);
 assert.match(open.log,/open leases 1/);assert.match(open.log,/skip: a turn is open/);
 assert.deepEqual(leased.asked(),[]);
});

test('a chat that is short, or had no reply since the last summary, is left alone',needs,async t=>{
 const short=home(t,{plan:{'session.resume':resumed()},seeded:{tokens:20000}});
 const small=short.run();
 assert.equal(small.code,0,small.log);
 assert.match(small.log,/skip: below 60000 tokens/);
 assert.deepEqual(short.asked(),[]);
 const summarised=home(t,{plan:{'session.resume':resumed()},seeded:{anchor:false}});
 const again=summarised.run();
 assert.equal(again.code,0,again.log);
 assert.match(again.log,/last prompt unknown tokens/);
 assert.match(again.log,/skip: no reply since the last summary/);
 assert.deepEqual(summarised.asked(),[]);
});

test('a resume that answers with another conversation compresses nothing',needs,async t=>{
 const chat=home(t,{plan:{'session.resume':{session_id:'live-9',resumed:OTHER,status:'idle'},'session.compress':compressed,'session.close':{closed:true}}});
 const before=chat.rows(OTHER);
 const {code,log}=chat.run();
 assert.equal(code,1,'the run fails');
 assert.match(log,/Resume opened 'other-session-2', not 'chat-session-1'; stopping\./);
 assert.ok(!chat.asked().some(a=>a.method==='session.compress'),'nothing was summarised');
 assert.deepEqual(chat.asked().map(a=>a.method),['session.resume','session.close'],'what it opened it closed');
 assert.equal(chat.rows(OTHER),before);
});

test('a chat the assistant reports as running, or a busy status, is left alone',needs,async t=>{
 for(const busy of [{running:true},{status:'working'},{inflight:{user:'a message still being answered'}}]){
  const chat=home(t,{plan:{'session.resume':resumed(busy),'session.compress':compressed,'session.close':{closed:true}}});
  const {code,log}=chat.run();
  assert.equal(code,0,log);
  assert.match(log,/skip: conversation busy/,JSON.stringify(busy));
  assert.ok(!chat.asked().some(a=>a.method==='session.compress'));
  assert.deepEqual(chat.asked().map(a=>a.method),['session.resume','session.close']);
 }
});

test('a control channel that does not answer ends with the conversation closed and a failing exit',needs,async t=>{
 // The plan names no answer for session.compress, so the channel stays silent on that step.
 const chat=home(t,{plan:{'session.resume':resumed(),'session.close':{closed:true}}});
 const {code,log}=chat.run(['--compress-timeout','2']);
 assert.equal(code,1,'the run fails');
 assert.match(log,/session\.compress: no answer within 2 s\./);
 assert.deepEqual(chat.asked().map(a=>a.method),['session.resume','session.compress','session.close'],
  'the conversation it opened is closed even so');
});

test('a dry run opens and closes the chat and summarises nothing',needs,async t=>{
 const chat=home(t,{plan:{'session.resume':resumed(),'session.compress':compressed,'session.close':{closed:true}}});
 const {code,log}=chat.run(['--dry-run']);
 assert.equal(code,0,log);
 assert.match(log,/dry run: would summarise chat-session-1 \(320 messages loaded\)/);
 assert.deepEqual(chat.asked().map(a=>a.method),['session.resume','session.close']);
});

test('two chats of the owner\'s in the routing table stop it: it could be the wrong one',needs,async t=>{
 const chat=home(t,{plan:{'session.resume':resumed(),'session.compress':compressed}});
 const db=new DatabaseSync(path.join(chat.hermes,'state.db'));
 db.prepare('insert into gateway_routing values (?,?,?)').run(path.join(chat.hermes,'sessions'),'agent:main:telegram:dm:99',JSON.stringify({session_id:OTHER}));
 db.close();
 const {code,log}=chat.run();
 assert.equal(code,1);
 assert.match(log,/Expected one chat of the owner's in the assistant's routing table, found 2\./);
 assert.deepEqual(chat.asked(),[]);
});

test('a chat app connected but no message yet: nothing to tidy up, and no failed run',needs,async t=>{
 // The routine is made the moment a chat app is connected (native-scheduler.mjs, followChatTidy),
 // which on a fresh install is before the first message gives the gateway anything to route.
 const chat=home(t,{plan:{'session.resume':resumed(),'session.compress':compressed}});
 const db=new DatabaseSync(path.join(chat.hermes,'state.db'));
 db.exec('delete from gateway_routing');db.close();
 const {code,said,log}=chat.run();
 assert.equal(code,0,'a night with no chat to tidy up is not a failure');
 assert.equal(said,'');
 assert.match(log,/skip: the assistant routes no chat of the owner's yet/);
 assert.deepEqual(chat.asked(),[],'the control channel was never started');
});

test('the routing table decides which chat app it is, so another one needs no new code',needs,async t=>{
 const chat=home(t,{plan:{'session.resume':resumed(),'session.compress':compressed,'session.close':{closed:true}}});
 const db=new DatabaseSync(path.join(chat.hermes,'state.db'));
 db.exec('delete from gateway_routing');
 db.prepare('insert into gateway_routing values (?,?,?)').run(path.join(chat.hermes,'sessions'),'agent:main:signal:dm:7',JSON.stringify({session_id:CHAT}));
 // A group chat and another scope are not the owner's own chat, and are never counted.
 db.prepare('insert into gateway_routing values (?,?,?)').run(path.join(chat.hermes,'sessions'),'agent:main:telegram:group:8',JSON.stringify({session_id:OTHER}));
 db.prepare('insert into gateway_routing values (?,?,?)').run('/somewhere/else/sessions','agent:main:telegram:dm:9',JSON.stringify({session_id:OTHER}));
 db.close();
 const {code,log}=chat.run();
 assert.equal(code,0,log);
 assert.match(log,/summarised in \d+ s: status compressed/);
});

test('the assistant\'s own terminal is no chat app: its conversations beside the Telegram chat do not count',needs,async t=>{
 const chat=home(t,{plan:{'session.resume':resumed(),'session.compress':compressed,'session.close':{closed:true}}});
 const db=new DatabaseSync(path.join(chat.hermes,'state.db'));
 // How the assistant routes a conversation in its own terminal or desktop app, one key each, in the
 // same scope as the chat app's (seen on a fresh install on 27 October 2026, when this was "found 2").
 for(const id of ['local-1','local-2'])db.prepare('insert into gateway_routing values (?,?,?)')
  .run(path.join(chat.hermes,'sessions'),'agent:main:local:dm:'+id,JSON.stringify({session_id:OTHER}));
 db.close();
 const {code,log}=chat.run();
 assert.equal(code,0,log);
 assert.match(log,/chat chat-session-1: /,'the Telegram chat is the one it found');
 assert.match(log,/summarised in \d+ s: status compressed/);
 assert.equal(chat.asked()[0].params.session_id,CHAT);
});

test('beside a running gateway it attaches to it, as the assistant\'s own terminal does, and sends the same requests',needs,async t=>{
 // The gateway names the stored conversation it opened stored_session_id, and has no close for a
 // viewer (the installed one answered both so on 27 October 2026).
 // A conversation it rebuilt from storage it gives no status at all.
 const opened={session_id:'live-1',stored_session_id:CHAT,message_count:320};
 const chat=home(t,{gateway:true,plan:{'session.resume':opened,'session.compress':compressed,'session.close':{error:'unknown_method'}}});
 const {code,said,log}=chat.run();
 assert.equal(code,0,log);
 assert.equal(said,'');
 assert.match(log,/summarised in \d+ s: status compressed, messages 320 -> 20, about 174000 -> 45000 tokens/);
 assert.deepEqual(chat.asked().map(a=>a.method),['session.resume','session.compress','session.close']);
 assert.ok(chat.asked().every(a=>a.via==='the-running-gateway'),'every request went to the gateway');
 assert.deepEqual(chat.asked()[0].params,{session_id:CHAT});
 assert.doesNotMatch(log,/close:/,'a gateway with no close for a viewer is no failed close');
});

test('beside a running gateway a resume that names another conversation stops it too',needs,async t=>{
 const chat=home(t,{gateway:true,plan:{'session.resume':{session_id:'live-1',stored_session_id:OTHER,status:'idle'},'session.compress':compressed,'session.close':{closed:true}}});
 const {code,log}=chat.run();
 assert.equal(code,1);
 assert.match(log,/Resume opened 'other-session-2', not 'chat-session-1'; stopping\./);
 assert.ok(!chat.asked().some(a=>a.method==='session.compress'),'nothing was compressed');
});

test('beside a running gateway a refusal is still a refusal, and nothing is compressed',needs,async t=>{
 const chat=home(t,{gateway:true,plan:{'session.resume':{error:'session_not_found'},'session.close':{closed:true}}});
 const {code,log}=chat.run();
 assert.equal(code,1);
 assert.match(log,/session\.resume refused: .*session_not_found/);
 assert.deepEqual(chat.asked().map(a=>a.method),['session.resume']);
});

test('a channel that ends says why, in the assistant\'s own words',needs,async t=>{
 const chat=home(t,{entry:REFUSED,plan:{}});
 const {code,log}=chat.run();
 assert.equal(code,1);
 assert.match(log,/session\.resume: the assistant's control channel exited \(1\): \[gateway-exit\] refused: this home is owned by a running gateway/);
});

test('a summary that ends with any other status is a failed run',needs,async t=>{
 const chat=home(t,{plan:{'session.resume':resumed(),'session.compress':{status:'locked'},'session.close':{closed:true}}});
 const {code,log}=chat.run();
 assert.equal(code,1);
 assert.match(log,/The summary ended with status 'locked'\./);
 assert.deepEqual(chat.asked().map(a=>a.method),['session.resume','session.compress','session.close']);
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
