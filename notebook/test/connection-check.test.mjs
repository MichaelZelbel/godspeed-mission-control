import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {installStarter} from '../core/starter-workspace.mjs';
import {readNotices} from '../core/notices.mjs';import {addonDeadlines} from '../core/addon-deadlines.mjs';
import {CONNECTION_NAMES} from '../core/connection-names.mjs';import {runDue} from '../core/connection-check.mjs';import {CONNECTIONS,defaultProbes,checkConnections,nextState,telegramProbe,githubProbe,mailProbe,aiProbe,gitKind,aiKind,telegramKind,mailKind,connectionCheckWanted,RECORD_FILE} from '../core/connection-check.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// THE DAILY CONNECTION CHECK (#200, 4 November 2026). The connections are stubs; the notices, the
// deadlines (the real tools/due.js) and the records are real. Everything here is made up.
const TOKEN='123456789:AAHinventedtokeninventedtokeninvented';
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-check-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));installStarter(root);return {root,store:new Store(root,{device:'pc'})};};
const stubs=(over={})=>({ai:async()=>({set_up:true,ok:true}),telegram:async()=>({set_up:true,ok:true}),github:async()=>({set_up:true,ok:true}),mail:async()=>({set_up:true,ok:true}),...over});
const refused=async()=>({set_up:true,ok:false,kind:'sign-in'}),down=async()=>({set_up:true,ok:false,kind:'other'});
const deadlines=store=>addonDeadlines(store,{addon:'connection-check',action:'list'}).deadlines;
const bell=(store,name)=>store.get('notifications','connection-'+name);
const D1='2026-11-04',D2='2026-11-05',D3='2026-11-06';

test('all connections working: nothing is said and no deadline is made',async t=>{
 const {store,root}=fixture(t);
 const record=await checkConnections({store,day:D1,probes:stubs()});
 assert.deepEqual(readNotices(store),[]);assert.deepEqual(deadlines(store),[]);
 assert.equal(bell(store,'telegram'),undefined);
 assert.deepEqual(Object.values(record.connections).map(c=>[c.set_up,c.ok]),[[true,true],[true,true],[true,true],[true,true]]);
 assert.ok(!fs.existsSync(path.join(root,'.godspeed','connection-check')),'no marker file on an ordinary day');
});

test('a connection that is not set up is not called and not mentioned',async t=>{
 const {store}=fixture(t);
 const record=await checkConnections({store,day:D1,probes:{ai:async()=>({set_up:false}),telegram:async()=>({set_up:false}),github:async()=>({set_up:false}),mail:async()=>({set_up:false})}});
 assert.deepEqual(Object.values(record.connections),[{set_up:false},{set_up:false},{set_up:false},{set_up:false}]);
 assert.deepEqual(readNotices(store),[]);
});

test('a refused Telegram key: one message and one deadline, closed by the routine the day it works again',async t=>{
 const {store}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({telegram:refused})});
 const notices=readNotices(store);assert.equal(notices.length,1);assert.match(notices[0].text,/Telegram refused your bot's key/);
 const open=deadlines(store);assert.equal(open.length,1);assert.equal(open[0].key,'telegram:'+D1);assert.equal(open[0].state,'open');
 assert.equal(bell(store,'telegram').status,'pending');
 await checkConnections({store,day:D1,probes:stubs({telegram:refused})});
 assert.equal(readNotices(store).length,1,'a second run the same day says nothing more');assert.equal(deadlines(store).length,1);
 await checkConnections({store,day:D2,probes:stubs({telegram:refused})});
 assert.equal(readNotices(store).length,1,'still refused the next day: one message for the whole stretch');assert.equal(deadlines(store).length,1);
 await checkConnections({store,day:D3,probes:stubs()});
 assert.equal(deadlines(store)[0].state,'closed');assert.equal(bell(store,'telegram').status,'resolved');
 assert.equal(readNotices(store).length,1);
 await checkConnections({store,day:'2026-11-07',probes:stubs()});
 assert.equal(deadlines(store).length,1,'working days after that touch nothing');
});

test('a network failure is said only on the second failure in a row',async t=>{
 const {store}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({telegram:down})});
 await checkConnections({store,day:D1,probes:stubs({telegram:down})});
 assert.deepEqual(readNotices(store),[],'once, even run twice the same day');
 await checkConnections({store,day:D2,probes:stubs({telegram:down})});
 assert.equal(readNotices(store).length,1);assert.match(readNotices(store)[0].text,/could not reach Telegram yesterday or today/);assert.deepEqual(deadlines(store),[],'nothing needs a sign-in');
 await checkConnections({store,day:D3,probes:stubs({telegram:down})});
 assert.equal(readNotices(store).length,1,'then no more');
});

test('a working day in between starts the count again',async t=>{
 const {store}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({github:down})});
 await checkConnections({store,day:D2,probes:stubs()});
 await checkConnections({store,day:D3,probes:stubs({github:down})});
 assert.deepEqual(readNotices(store),[]);
});

test('a probe that throws counts as a failure that needs no sign-in',async t=>{
 const {store}=fixture(t);
 const record=await checkConnections({store,day:D1,probes:stubs({mail:async()=>{throw Error('boom '+TOKEN);}})});
 assert.equal(record.connections.mail.kind,'other');assert.ok(!JSON.stringify(record).includes(TOKEN));
});

test('nextState keeps a deadline that is open while the failure changes kind',()=>{
 const first=nextState({},{set_up:true,ok:false,kind:'sign-in'},D1);
 assert.deepEqual(first.actions,[{do:'sign-in'},{do:'deadline'}]);
 const other=nextState({...first.entry,deadline:{slug:'x',key:'k'}},{set_up:true,ok:false,kind:'other'},D2);
 assert.deepEqual(other.entry.deadline,{slug:'x',key:'k'});assert.deepEqual(other.actions,[]);
});

test('no key, token or password reaches a record, a message, a deadline or a log',async t=>{
 const {store,root}=fixture(t),home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-home-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN='+TOKEN+'\n');
 const seen=[];
 const rejected=telegramProbe({home,fetcher:async url=>{seen.push(String(url));return {ok:false,status:401,json:async()=>({ok:false,error_code:401,description:'Unauthorized '+TOKEN})};}});
 assert.deepEqual(await rejected(),{set_up:true,ok:false,kind:'sign-in'});
 assert.ok(seen[0].endsWith('/bot'+TOKEN+'/getMe'),'the one call is getMe');
 const unreachable=telegramProbe({home,fetcher:async url=>{throw Error('connect failed '+url);}});
 assert.deepEqual(await unreachable(),{set_up:true,ok:false,kind:'other'});
 const failing=githubProbe({store,run:()=>{throw Object.assign(Error('git failed https://x:'+TOKEN+'@github.com/a/b'),{stderr:Buffer.from("fatal: Authentication failed for 'https://x:"+TOKEN+"@github.com/a/b'")});}});
 fs.mkdirSync(store.state,{recursive:true});fs.writeFileSync(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true}));
 assert.deepEqual(await failing(),{set_up:true,ok:false,kind:'sign-in'});
 await checkConnections({store,day:D1,probes:stubs({telegram:rejected,github:failing})});
 const everything=[];const walk=dir=>{for(const name of fs.readdirSync(dir)){const p=path.join(dir,name);if(fs.statSync(p).isDirectory()){if(name!=='.git'&&name!=='node_modules')walk(p);}else everything.push(fs.readFileSync(p,'utf8'));}};
 walk(root);
 assert.ok(everything.length>0);
 assert.ok(!everything.join('\n').includes(TOKEN.split(':')[1])&&!everything.join('\n').includes(TOKEN),'no file of the mission control holds the key');
});

test('the classifiers sort sign-in failures from the rest',()=>{
 assert.equal(gitKind("fatal: Authentication failed for 'https://github.com/a/b'"),'sign-in');
 assert.equal(gitKind('fatal: could not read Username for https://github.com: terminal prompts disabled'),'sign-in');
 assert.equal(gitKind('fatal: unable to access: Could not resolve host: github.com'),'other');
 assert.equal(aiKind({reason:'sign-in'}),'sign-in');assert.equal(aiKind({reason:'limit'}),'other');assert.equal(aiKind(Error('timeout')),'other');
 assert.equal(telegramKind(401,{}),'sign-in');assert.equal(telegramKind(404,{}),'sign-in');assert.equal(telegramKind(200,{error_code:401}),'sign-in');assert.equal(telegramKind(502,{}),'other');
 assert.equal(mailKind('disconnected'),'sign-in');assert.equal(mailKind('degraded'),'other');
});

test('each probe is set up only when its connection is, and asks only once',async t=>{
 const {store,root}=fixture(t),home=path.join(root,'hermes-home');fs.mkdirSync(home);
 assert.deepEqual(await telegramProbe({home,fetcher:async()=>{throw Error('called');}})(),{set_up:false});
 assert.deepEqual(await githubProbe({store,run:()=>{throw Error('called');}})(),{set_up:false});
 assert.deepEqual(await mailProbe({imap:()=>({status:()=>({state:'not connected'}),check:async()=>{throw Error('called');}})})(),{set_up:false});
 assert.deepEqual(await aiProbe({store,home,hermes:'hermes',ask:async()=>{throw Error('called');}})(),{set_up:false},'no Hermes path');
 const imap=state=>()=>({status:()=>({state:'connected'}),check:async()=>({state})});
 assert.deepEqual(await mailProbe({imap:imap('connected')})(),{set_up:true,ok:true});
 assert.deepEqual(await mailProbe({imap:imap('disconnected')})(),{set_up:true,ok:false,kind:'sign-in'});
 assert.deepEqual(await mailProbe({imap:imap('degraded')})(),{set_up:true,ok:false,kind:'other'});
 // The shapes mc-mail-imap's check() really returns when Gmail was asked and failed: a refused password
 // leaves the state disconnected, any other trouble leaves it connected beside an error.
 const failed=(state,error)=>()=>({status:()=>({state:'connected'}),check:async()=>({state,checked:'failed just now',error})});
 assert.deepEqual(await mailProbe({imap:failed('disconnected','Gmail did not accept the app password.')})(),{set_up:true,ok:false,kind:'sign-in'});
 assert.deepEqual(await mailProbe({imap:failed('connected','Gmail does not have the folder')})(),{set_up:true,ok:false,kind:'other'});
 fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: openrouter\n  default: x\n');
 let asked=0;
 assert.deepEqual(await aiProbe({store,home,hermes:process.execPath.replace(/[^/\\]+$/,'hermes'),ask:async o=>{asked++;assert.equal(o.route,'main');}})(),{set_up:true,ok:true});
 assert.equal(asked,1);
 assert.deepEqual(await aiProbe({store,home,hermes:'/bin/hermes',ask:async()=>{throw Object.assign(Error('x'),{reason:'sign-in'});}})(),{set_up:true,ok:false,kind:'sign-in'});
});

test('the check is wanted when Telegram or Gmail is connected',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-home-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const none=()=>({status:()=>({state:'not connected'})}),mail=()=>({status:()=>({state:'connected'})});
 assert.equal(connectionCheckWanted(home,none),false);assert.equal(connectionCheckWanted(home,mail),true);
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN='+TOKEN+'\n');
 assert.equal(connectionCheckWanted(home,none),true);
 assert.equal(connectionCheckWanted(home,()=>{throw Error('no mail tool');}),true);
 assert.ok(RECORD_FILE);
});

test('a connection reported unset between a refusal and its recovery still closes its deadline',async t=>{
 const {store}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({telegram:refused})});
 await checkConnections({store,day:D2,probes:stubs({telegram:async()=>({set_up:false})})});
 await checkConnections({store,day:D3,probes:stubs()});
 assert.equal(deadlines(store)[0].state,'closed');assert.equal(bell(store,'telegram').status,'resolved');
});

test('a missed day breaks a network-failure streak',async t=>{
 const {store}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({github:down})});
 await checkConnections({store,day:'2026-11-07',probes:stubs({github:down})});
 assert.deepEqual(readNotices(store),[]);
});

test('a deadline that could not be made or closed fails the routine and is retried',async t=>{
 const {store}=fixture(t);
 const failing=()=>({status:1,out:''});
 await assert.rejects(checkConnections({store,day:D1,probes:stubs({telegram:refused}),due:failing}),/deadline/);
 assert.deepEqual(deadlines(store),[]);assert.equal(readNotices(store).length,0,'nothing is queued until its deadline exists');
 await checkConnections({store,day:D1,probes:stubs({telegram:refused})});
 assert.equal(deadlines(store).length,1);assert.equal(readNotices(store).length,1,'the message is not repeated');
 await assert.rejects(checkConnections({store,day:D2,probes:stubs(),due:failing}),/deadline/);
 assert.equal(bell(store,'telegram').status,'pending');
 await checkConnections({store,day:D2,probes:stubs()});
 assert.equal(deadlines(store)[0].state,'closed');assert.equal(bell(store,'telegram').status,'resolved');
});

test('every connection owns its probe, and mail reaches its own check',async()=>{
 assert.deepEqual(Object.keys(defaultProbes({store:{},home:'x'})),Object.keys(CONNECTIONS));
 let checks=0;
 const imap=()=>({status:()=>({state:'connected'}),check:async()=>{checks++;return {state:'disconnected'};}});
 assert.deepEqual(await defaultProbes({store:{},home:'x',imap}).mail(),{set_up:true,ok:false,kind:'sign-in'});
 assert.equal(checks,1);
});

test('a refusal whose deadline failed, then an unset day, is neither repeated nor forgotten',async t=>{
 const failing=()=>({status:1,out:''}),unset=async()=>({set_up:false});
 for(const [third,closed] of [[refused,false],[undefined,true]]){
  const {store}=fixture(t);
  await assert.rejects(checkConnections({store,day:D1,probes:stubs({telegram:refused}),due:failing}),/deadline/);
  await checkConnections({store,day:D2,probes:stubs({telegram:unset})});
  await checkConnections({store,day:D3,probes:stubs(third&&{telegram:third})});
  assert.equal(readNotices(store).length,closed?0:1,closed?'recovered before any deadline: the sign-in notice is taken back':'one message for the whole stretch');
  if(closed){assert.equal(bell(store,'telegram').status,'resolved');}
  else assert.equal(deadlines(store).length,1,'the deadline is made on the first day it can be');
 }
});

test('a refusal whose deadline failed survives an unset day and then network trouble until a working call',async t=>{
 const {store}=fixture(t);
 await assert.rejects(checkConnections({store,day:D1,probes:stubs({telegram:refused}),due:()=>({status:1,out:''})}),/deadline/);
 await checkConnections({store,day:D2,probes:stubs({telegram:async()=>({set_up:false})})});
 await checkConnections({store,day:D3,probes:stubs({telegram:async()=>({set_up:true,ok:false,kind:'other'})})});
 assert.equal(deadlines(store).length,1,'its deadline is made while the connection is still down');
 await checkConnections({store,day:D3,probes:stubs()});
 assert.equal(bell(store,'telegram').status,'resolved');
 assert.equal(readNotices(store).length,1);
});

test('a recovery leaves an unrelated repeating deadline that is overdue exactly as it was',async t=>{
 const {store,root}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({telegram:refused})});
 const added=runDue(store,D1,['add','weekly','--title','Weekly','--to',D1,'--done-when','x','--cost','y','--repeats','weekly']);assert.equal(added.status,0,added.out);
 const dir=path.join(root,'notebook','Deadlines'),snapshot=()=>JSON.stringify(fs.readdirSync(dir).filter(f=>/weekly/i.test(f)).map(f=>[f,fs.readFileSync(path.join(dir,f),'utf8')]));
 const before=snapshot();assert.ok(before.length>4);
 await checkConnections({store,day:D2,probes:stubs()});
 assert.equal(addonDeadlines(store,{addon:'connection-check',action:'list'}).deadlines[0].state,'closed');
 assert.equal(snapshot(),before,'no window of the unrelated deadline was grown');
});

test('the GitHub probe only reads the remote',async t=>{
 const {store}=fixture(t),calls=[];
 fs.mkdirSync(store.state,{recursive:true});fs.writeFileSync(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true}));
 assert.deepEqual(await githubProbe({store,run:args=>{calls.push(args);}})(),{set_up:true,ok:true});
 assert.deepEqual(calls,[['ls-remote','--heads','origin','main']]);
});

test('the probes cover exactly the connections Settings names, in the same order',()=>{
 assert.deepEqual(Object.keys(CONNECTIONS),Object.keys(CONNECTION_NAMES));
 assert.deepEqual(Object.keys(defaultProbes({store:{},home:'x'})),Object.keys(CONNECTION_NAMES));
});

test('a recovery closes only its own connection\'s deadline, never another that closes itself',async t=>{
 const {store,root}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({telegram:refused})});
 const marker=path.join(root,'other.marker');
 assert.equal(runDue(store,D1,['add','unrelated','--title','Unrelated','--target',D1,'--to','2026-12-01','--done-when','x','--cost','y','--self-check','file-newer','--self-check-arg','other.marker']).status,0);
 fs.writeFileSync(marker,'');
 await checkConnections({store,day:D2,probes:stubs()});
 const state=addonDeadlines(store,{addon:'connection-check',action:'list'}).deadlines;
 assert.equal(state[0].state,'closed');
 const closing=fs.readFileSync(path.join(root,JSON.parse(runDue(store,D2,['state','--json']).out).find(r=>r.slug===state[0].slug).closedBy),'utf8');assert.match(closing,/self check/i);assert.doesNotMatch(closing,/you said so/i,'the closing is the self-check\'s, not the owner\'s word');
 assert.match(runDue(store,D2,['state']).out,/unrelated[^\n]*open|open[^\n]*unrelated/i,'the unrelated deadline stays open');
});
