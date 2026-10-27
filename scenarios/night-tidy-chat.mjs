#!/usr/bin/env node
// The assistant's own chat store, for the proving scenarios: seeded, re-timed and read back
// (scenarios/night-tidy.sh and scenarios/update-keeps-everything.sh).
//
// Why a scenario seeds it at all: the night tidy-up only acts on a chat the gateway routes to the
// owner, above 60,000 recorded prompt tokens, quiet for half an hour. A fresh machine has no such
// chat, and reaching one by talking to the assistant would cost an afternoon and an AI bill. So
// the scenario writes one into the store the assistant keeps it in - state.db in its own home -
// and the routine then finds it exactly as it finds a real one.
//
//   node night-tidy-chat.mjs --home <assistant home> seed [--session id] [--other id]
//        [--tokens 174000] [--quiet-minutes 60] [--messages 40] [--chat 4242]
//   node night-tidy-chat.mjs --home <home> retime --session id [--quiet-minutes 5] [--tokens N]
//   node night-tidy-chat.mjs --home <home> dump --session id      the conversation's own rows
//   node night-tidy-chat.mjs --home <home> routing                the routing table's rows
//   node night-tidy-chat.mjs --home <home> count --session id     messages=<n> tokens=<n>
//
// IT WRITES THE SCHEMA IT FINDS. The tables are the assistant's, not ours: a row is written by
// taking the newest row of the table as its template and changing only what the scenario means to
// say (the conversation, its recorded size, when its messages were sent), so a column this script
// has never heard of keeps whatever the assistant itself puts there. Where a table is empty it
// fills what the column says it must hold. The two tables the gateway keeps for its own bookkeeping
// (the routing table and the turn leases) are made where they are missing, with the columns the
// routine reads; the two the assistant owns (sessions, messages) are never made here, because a
// machine whose assistant has never kept a conversation is a machine this scenario cannot judge,
// and saying so is better than inventing its schema.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const argv=process.argv.slice(2),given={},words=[];
for(let i=0;i<argv.length;i++){
 if(!argv[i].startsWith('--')){words.push(argv[i]);continue;}
 const name=argv[i].slice(2);
 given[name]=argv[i+1]!==undefined&&!argv[i+1].startsWith('--')?argv[++i]:'yes';
}
const option=(name,fallback=null)=>name in given?given[name]:fallback;
const command=words[0];
const die=sentence=>{process.stderr.write(sentence+'\n');process.exit(1);};

const home=option('home')||die('Name the assistant home with --home');
const file=path.join(home,'state.db');
if(!fs.existsSync(file))die('The assistant keeps no chat on this machine yet ('+file+' is not there).');
const CHAT=option('session','scenario-chat-1'),OTHER=option('other','scenario-other-2');
const TOKENS=Number(option('tokens','174000')),QUIET=Number(option('quiet-minutes','60'));
const MESSAGES=Number(option('messages','40')),ROUTED_CHAT=option('chat','4242');
// The scope the gateway keys its routing table by, spelled the way the routine spells it when it
// looks for it (godspeed_routines.py: os.path.join(home, "sessions")). Joined rather than
// normalised, so the home as it is written in the routine's own settings is the home in the row.
const SCOPE=home.replace(/[\\/]+$/,'')+path.sep+'sessions',KEY='agent:main:telegram:dm:'+ROUTED_CHAT;

const db=new DatabaseSync(file);
const tables=()=>new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map(r=>r.name));
const columns=name=>db.prepare('pragma table_info('+name+')').all();
const newest=name=>{try{return db.prepare('select * from '+name+' order by rowid desc limit 1').get()||null;}catch{return null;}};

// The columns a table keeps unique beside its key (the conversations' title has an index of its own).
const uniqueColumns=name=>new Set(db.prepare('pragma index_list('+name+')').all()
 .filter(index=>index.unique&&index.origin!=='pk')
 .flatMap(index=>db.prepare('pragma index_info('+JSON.stringify(index.name)+')').all().map(column=>column.name)));

// One row of a table the assistant owns: the newest row as its template, our own values over it,
// and for a column neither of those names, what the column itself says it must hold. A column the
// table keeps unique is never taken from the template: a row with the newest row's own title would
// replace that row instead of standing beside it, which on 27 October 2026 took the assistant's own
// first conversation out from under its messages ("FOREIGN KEY constraint failed").
function write(name,mine){
 const template=newest(name)||{},unique=uniqueColumns(name);
 const row={};
 for(const column of columns(name)){
  const key=column.name;
  if(key in mine){row[key]=mine[key];continue;}                                      // what the scenario says
  if(column.pk)continue;                                                             // the store's own counting
  if(template[key]!==null&&template[key]!==undefined&&!unique.has(key)){row[key]=template[key];continue;} // the newest row's own
  if(!column.notnull||column.dflt_value!==null)continue;                             // the store fills it itself
  row[key]=/INT|REAL|NUM|FLOA|DOUB/i.test(column.type||'')?0:'';                     // it must hold something
 }
 const names=Object.keys(row);
 if(!names.length)die('The table '+name+' has no column this scenario could write.');
 db.prepare('insert or replace into '+name+' ('+names.join(',')+') values ('+names.map(()=>'?').join(',')+')')
  .run(...names.map(n=>row[n]));
}

// When a message was sent, written the way this store already writes it.
const stamp=seconds=>{
 const template=newest('messages');
 const now=Date.now()/1000;
 return typeof template?.timestamp==='string'?new Date((now-seconds)*1000).toISOString():now-seconds;
};
// The size of the last real prompt, which is what the routine reads to see whether the chat is
// long: the assistant keeps it in the conversation's model_config, under _usage_anchor.
function configWith(session,tokens){
 let config={};
 try{config=JSON.parse(db.prepare('select model_config from sessions where id = ?').get(session)?.model_config||'{}')||{};}catch{config={};}
 if(!config||typeof config!=='object'||Array.isArray(config))config={};
 if(tokens===null)delete config._usage_anchor;
 else config._usage_anchor={...(config._usage_anchor||{}),prompt_tokens:tokens};
 return JSON.stringify(config);
}
function needOwnTables(){
 const have=tables();
 for(const name of ['sessions','messages'])
  if(!have.has(name))die('The assistant\'s chat store has no '+name+' table yet, so no chat can be seeded into it.');
 if(!have.has('gateway_routing'))db.exec('create table gateway_routing(scope text, session_key text, entry_json text)');
 if(!have.has('session_turn_leases'))db.exec('create table session_turn_leases(conversation_id text, expires_at real)');
}

function seed(){
 needOwnTables();
 db.prepare('delete from gateway_routing where scope = ? and session_key = ?').run(SCOPE,KEY);
 db.prepare('delete from messages where session_id in (?,?)').run(CHAT,OTHER);
 for(const session of [CHAT,OTHER])db.prepare('delete from sessions where id = ?').run(session);
 write('sessions',{id:CHAT,model_config:configWith(CHAT,TOKENS),parent_session_id:null});
 write('sessions',{id:OTHER,model_config:configWith(OTHER,120000),parent_session_id:null});
 for(let i=0;i<MESSAGES;i++)write('messages',{session_id:CHAT,timestamp:stamp(QUIET*60+i*60),
  role:i%2?'assistant':'user',content:'A message of the owner\'s own chat, long enough to be worth summarising.'});
 for(let i=0;i<5;i++)write('messages',{session_id:OTHER,timestamp:stamp(5*3600+i*60),
  role:i%2?'assistant':'user',content:'A message of a second stored conversation, which nothing may touch.'});
 write('gateway_routing',{scope:SCOPE,session_key:KEY,entry_json:JSON.stringify({session_id:CHAT})});
 db.prepare('delete from session_turn_leases where conversation_id in (?,?)').run(CHAT,OTHER);
 process.stdout.write('seeded '+CHAT+': '+MESSAGES+' messages, '+TOKENS+' recorded tokens, quiet for '+QUIET+' min, routed as '+KEY+'\n');
}

function retime(){
 const tokens=option('tokens')===null?undefined:(option('tokens')==='none'?null:Number(option('tokens')));
 // "as mine", because a table whose primary key is an integer gives its rowid that column's name.
 const rows=db.prepare('select rowid as mine from messages where session_id = ? order by timestamp').all(CHAT);
 if(!rows.length)die('The conversation '+CHAT+' has no messages to re-time.');
 rows.forEach((row,i)=>db.prepare('update messages set timestamp = ? where rowid = ?')
  .run(stamp(QUIET*60+(rows.length-1-i)*60),row.mine));
 if(tokens!==undefined)db.prepare('update sessions set model_config = ? where id = ?').run(configWith(CHAT,tokens),CHAT);
 db.prepare('delete from session_turn_leases where conversation_id = ?').run(CHAT);
 process.stdout.write('re-timed '+CHAT+': quiet for '+QUIET+' min'+(tokens===undefined?'':', '+tokens+' recorded tokens')+'\n');
}

const stable=rows=>rows.map(row=>JSON.stringify(Object.keys(row).sort().reduce((out,key)=>({...out,[key]:row[key]}),{}))).join('\n')+'\n';

function dump(){
 process.stdout.write(stable(db.prepare('select * from sessions where id = ?').all(CHAT)));
 process.stdout.write(stable(db.prepare('select * from messages where session_id = ? order by timestamp, rowid').all(CHAT)));
}
function routing(){
 process.stdout.write(stable(db.prepare('select * from gateway_routing where scope = ? order by session_key').all(SCOPE)));
}
function count(){
 const messages=db.prepare('select count(*) as n from messages where session_id = ?').get(CHAT).n;
 let tokens='none';
 try{tokens=String(JSON.parse(db.prepare('select model_config from sessions where id = ?').get(CHAT)?.model_config||'{}')?._usage_anchor?.prompt_tokens??'none');}catch{tokens='none';}
 process.stdout.write('messages='+messages+' tokens='+tokens+'\n');
}

try{
 ({seed,retime,dump,routing,count}[command]||(()=>die('Say what to do: seed, retime, dump, routing or count.')))();
}finally{
 try{db.close();}catch{}
}
