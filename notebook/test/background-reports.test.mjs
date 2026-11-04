import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {chatContext} from '../core/chat-context.mjs';
import {queueNotice,readNotices} from '../core/notices.mjs';import {sayNotice,REPORT_CONTRACT} from '../core/background-reports.mjs';

// BACKGROUND REPORTS (4 November 2026, #198): a notice is written with the chat's guidance, recorded
// where the chat reads it, and the chat's next reply is told about it.
const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
function setup(t,{telegram=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-reports-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'.hermes-home');fs.mkdirSync(home);fs.mkdirSync(path.join(root,'profile'));
 fs.writeFileSync(path.join(home,'SOUL.md'),'Fictional persona: warm and brief.');fs.writeFileSync(path.join(root,'AGENTS.md'),'Fictional manual: explain from zero.');
 if(telegram)fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');
 return {root,home,store:new Store(root,{device:'pc'})};
}
const provider=(reports,seen=[])=>async input=>{seen.push(input);return JSON.stringify({reports});};
const records=store=>[...store.records.values()].filter(r=>r.type==='conversation_messages'&&r.id.startsWith('background-report-'));
const notice={id:'backup-1',text:"Last night's backup failed.",about:'last night\'s backup',facts:['The backup could not reach the disk.'],step:'step-9f3a2c'};

test('a queued notice is written with the chat\'s guidance and recorded',async t=>{
 const {store,home}=setup(t),seen=[];
 const {text}=await sayNotice(store,{notice,home,provider:provider([{about:'last night\'s backup',text:'Your backup did not run last night, because the disk was out of reach.'}],seen)});
 assert.equal(text,'Your backup did not run last night, because the disk was out of reach.');
 assert.match(seen[0].guidance.who_it_is,/warm and brief/);assert.match(seen[0].guidance.manual,/explain from zero/);
 assert.doesNotMatch(seen[0].contract,/word for word/i);assert.equal(seen[0].contract,REPORT_CONTRACT);
 const [saved,...none]=records(store);assert.equal(none.length,0);
 assert.deepEqual([saved.role,saved.source_app,saved.conversation_id,saved.delivered_to,saved.report.written],['assistant','background','telegram-owner','telegram','assistant']);
 assert.deepEqual(saved.report.facts,notice.facts);assert.equal(saved.report.step,notice.step);assert.ok(saved.sent_at);
});

test('the next chat turn\'s context contains the report, and so does the plugin\'s block',async t=>{
 const {root,store,home}=setup(t);
 const {text}=await sayNotice(store,{notice,home,provider:provider([{about:'backup',text:'Your backup did not run last night.'}])});
 const context=chatContext(new QueryService(store),{conversation_id:'telegram-owner',message:'what is this about?'});
 assert.ok(context.messages.some(m=>m.role==='assistant'&&m.content===text));
 if(!python)return t.skip('needs Python');
 const plugin=fileURLToPath(new URL('../assistant-files/godspeed-context/__init__.py',import.meta.url));
 const block=(platform,hours=0)=>execFileSync(python,['-I','-c','import importlib.util,sys,time;s=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.reports_block(sys.argv[2],sys.argv[3],time.time()+float(sys.argv[4])*3600))',plugin,root,platform,String(hours)],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}}).trim();
 const now=block('telegram');
 assert.match(now,/^\[godspeed-reports\]/);assert.match(now,/Your backup did not run last night\./);assert.match(now,/A step waits for their yes\./);assert.ok(!now.includes('step-9f3a2c'),'the step id is never shown');
 assert.equal(block('cli'),'None','a report sent to Telegram is not for the notebook\'s chat');
 assert.equal(block('telegram',25),'None','a day later it is no longer listed');
});

test('two unrelated facts become two reports, said one at a time',async t=>{
 const {store,home}=setup(t),seen=[];
 const two=provider([{about:'backup',text:'Your backup failed.'},{about:'voice',text:'Your voice replies stopped.'}],seen);
 assert.equal((await sayNotice(store,{notice,home,provider:two})).text,'Your backup failed.');
 const second=readNotices(store).find(n=>n.id==='backup-1~2');
 assert.equal(second.text,'Your voice replies stopped.');assert.equal(second.written,true);
 assert.equal((await sayNotice(store,{notice:second,home,provider:two})).text,'Your voice replies stopped.');
 assert.equal(seen.length,1,'a report already written asks the AI nothing');assert.equal(records(store).length,2);
});

test('with the AI unavailable or refused, the plain text goes out and is recorded',async t=>{
 const {store,home}=setup(t,{telegram:false});
 const cases=[null,async()=>{throw Error('down');},provider([{about:'backup',text:'Reply approve 59f1d506 to go on.'}]),provider([{about:'backup',text:'The step step-9f3a2c waits.'}]),async()=>'not json'];
 for(const ai of cases)assert.equal((await sayNotice(store,{notice,home,provider:ai})).text,notice.text);
 const saved=records(store);assert.equal(saved.length,cases.length);
 assert.ok(saved.every(r=>r.report.written==='fallback'&&r.content===notice.text&&r.conversation_id===null&&r.delivered_to==='notebook'));
});

test('a notice queued with no facts is written from its text',t=>{
 const {store}=setup(t);queueNotice(store,{id:'n1',text:' Plain. '});
 assert.deepEqual(readNotices(store)[0].facts,['Plain.']);
});
