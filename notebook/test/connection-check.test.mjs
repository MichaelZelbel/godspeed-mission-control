import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {Store} from '../core/records/store.mjs';import {installStarter} from '../core/starter-workspace.mjs';
import {readNotices} from '../core/notices.mjs';import {addonDeadlines} from '../core/addon-deadlines.mjs';
import {CONNECTION_NAMES} from '../core/connection-names.mjs';import {CONNECTIONS,defaultProbes,checkConnections,nextState,recoverPhoneConnection,telegramProbe,telegramAPI,githubProbe,mailProbe,agentmailProbe,aiProbe,phoneProbe,gitKind,aiKind,telegramKind,mailKind,connectionCheckWanted,diskProbe,RECORD_FILE,runDue} from '../core/connection-check.mjs';
import {acceptUpload,importFolder,pruneRaw,readRaw} from '../core/phone-health.mjs';
import {runConnectionCheck} from '../scripts/connection-check.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// THE DAILY CONNECTION CHECK (#200, 4 November 2026). The connections are stubs; the notices, the
// deadlines (the real tools/due.js) and the records are real. Everything here is made up.
const TOKEN='123456789:AAHinventedtokeninventedtokeninvented';
const TELEGRAM_API_VECTORS=JSON.parse(fs.readFileSync(new URL('./telegram-api-endpoints.json',import.meta.url),'utf8'));
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-check-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));installStarter(root);return {root,store:new Store(root,{device:'pc'})};};
// One probe for every source the check really has, so a newly added source can never be missing from a fixture: all fine, except the phone, which is not set up.
const SOURCES=Object.keys(CONNECTIONS);
const probesFor=make=>Object.fromEntries(SOURCES.map(name=>[name,make(name)]));
const stubs=(over={})=>({...probesFor(name=>name==='phone'?async()=>({set_up:false}):async()=>({set_up:true,ok:true})),...over});
const refused=async()=>({set_up:true,ok:false,kind:'sign-in'}),down=async()=>({set_up:true,ok:false,kind:'other'});
const deadlines=store=>addonDeadlines(store,{addon:'connection-check',action:'list'}).deadlines;
const bell=(store,name)=>store.get('notifications','connection-'+name);
const D1='2026-11-04',D2='2026-11-05',D3='2026-11-06';

test('all connections working: nothing is said and no deadline is made',async t=>{
 const {store,root}=fixture(t);
 const record=await checkConnections({store,day:D1,probes:stubs()});
 assert.deepEqual(readNotices(store),[]);assert.deepEqual(deadlines(store),[]);
 assert.equal(bell(store,'telegram'),undefined);
 assert.deepEqual(Object.values(record.connections).map(c=>[c.set_up,c.ok]),[[true,true],[true,true],[true,true],[true,true],[true,true],[true,true],[false,undefined]]);
 assert.ok(!fs.existsSync(path.join(root,'.godspeed','connection-check')),'no marker file on an ordinary day');
});

test('a connection that is not set up is not called and not mentioned',async t=>{
 const {store}=fixture(t);
 const record=await checkConnections({store,day:D1,probes:probesFor(()=>async()=>({set_up:false}))});
 assert.deepEqual(Object.values(record.connections),[{set_up:false},{set_up:false},{set_up:false},{set_up:false},{set_up:false},{set_up:false},{set_up:false}]);
 assert.deepEqual(readNotices(store),[]);
});

test('phone health starts its connection after an accepted upload, then speaks once after 36 quiet hours and recovers on the next upload',async t=>{
 const {store,root}=fixture(t),home=path.join(root,'hermes-home'),none=()=>({status:()=>({state:'not connected'})}),legacy=()=>({credentials:()=>({})});fs.mkdirSync(home);
 const at=moment=>phoneProbe({store,now:()=>new Date(moment)});
 assert.deepEqual(await at('2026-11-04T10:00:00Z')(),{set_up:false});
 assert.equal(connectionCheckWanted(home,none,store,legacy),false,'an install with no upload has no phone connection to check');
 acceptUpload(store,{metrics:[]},{now:new Date('2026-11-04T10:00:00Z')});
 assert.equal(connectionCheckWanted(home,none,store,legacy),true,'the first accepted upload starts the daily check');
 await checkConnections({store,day:D1,probes:stubs({phone:at('2026-11-04T20:00:00Z')}),now:()=>new Date('2026-11-04T20:00:00Z')});
 assert.deepEqual(readNotices(store),[]);assert.deepEqual(deadlines(store),[],'an upload ten hours ago is working');
 assert.deepEqual(await at('2026-11-05T22:00:00Z')(),{set_up:true,ok:false,kind:'quiet'},'36 quiet hours need the owner');
 await checkConnections({store,day:D2,probes:stubs({phone:at('2026-11-05T23:00:00Z')}),now:()=>new Date('2026-11-05T23:00:00Z')});
 assert.equal(readNotices(store).length,1);assert.match(readNotices(store)[0].text,/phone has sent no health data since/i);assert.match(readNotices(store)[0].text,/Health Auto Export/);assert.match(readNotices(store)[0].text,/briefing's health numbers stop/i);
 assert.equal(deadlines(store).length,1);assert.equal(deadlines(store)[0].key,'phone:'+D2);assert.equal(deadlines(store)[0].state,'open');
 await checkConnections({store,day:D3,probes:stubs({phone:at('2026-11-06T10:00:00Z')}),now:()=>new Date('2026-11-06T10:00:00Z')});
 assert.equal(readNotices(store).length,1,'the quiet spell is said once');assert.equal(deadlines(store).length,1,'the quiet spell has one deadline');
 acceptUpload(store,{metrics:[]},{now:new Date('2026-11-06T11:00:00Z')});
 await recoverPhoneConnection({store,day:D3,now:()=>new Date('2026-11-06T11:00:00Z')});
 assert.equal(deadlines(store)[0].state,'closed','the accepted upload closes it without another daily check');
});

test('the phone remains a connection after its raw upload expires',async t=>{
 const {store,root}=fixture(t),home=path.join(root,'hermes-home'),none=()=>({status:()=>({state:'not connected'})}),legacy=()=>({credentials:()=>({})});fs.mkdirSync(home);
 acceptUpload(store,{metrics:[]},{now:new Date('2026-10-04T10:00:00Z')});
 pruneRaw(store.state,new Date('2026-11-05T10:00:00Z'));
 assert.deepEqual(readRaw(store.state,'0000-00-00'),[],'the health payload has left after its retention period');
 assert.equal(connectionCheckWanted(home,none,store,legacy),true,'its accepted receipt keeps the daily check running');
 const phone=phoneProbe({store,now:()=>new Date('2026-11-05T10:00:00Z')});
 await checkConnections({store,day:D2,probes:stubs({phone}),now:()=>new Date('2026-11-05T10:00:00Z')});
 assert.equal(readNotices(store).length,1);assert.equal(deadlines(store).length,1);
});

test('imported health data does not establish a phone connection',async t=>{
 const {store,root}=fixture(t),home=path.join(root,'hermes-home'),none=()=>({status:()=>({state:'not connected'})}),legacy=()=>({credentials:()=>({})}),folder=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-phone-import-'));fs.mkdirSync(home);t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 fs.writeFileSync(path.join(folder,'old.jsonl'),JSON.stringify({received_at:'2026-11-04T10:00:00Z',data:{metrics:[]}})+'\n');
 importFolder(store,folder,{now:new Date('2026-11-05T10:00:00Z')});
 assert.deepEqual(await phoneProbe({store,now:()=>new Date('2026-11-06T10:00:00Z')})(),{set_up:false});
 assert.equal(connectionCheckWanted(home,none,store,legacy),false,'legacy raw data is not a receiver upload');
 const record=await checkConnections({store,day:D3,probes:stubs()});
 assert.deepEqual(record.connections.phone,{set_up:false});assert.deepEqual(readNotices(store),[]);assert.deepEqual(deadlines(store),[]);
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

test('a refused mail sign-in is pending in Settings and resolved on recovery, like Telegram',async t=>{
 const {store}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({mail:refused})});
 assert.equal(bell(store,'mail').status,'pending');assert.equal(bell(store,'telegram'),undefined);
 await checkConnections({store,day:D2,probes:stubs()});
 assert.equal(bell(store,'mail').status,'resolved');
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

test('the daily routine sends Telegram probes to its configured API without retaining the token',async t=>{
 const seen=[];const server=http.createServer((req,res)=>{seen.push(req.url);const refused=req.url.includes('refused');res.writeHead(refused?401:200,{'Content-Type':'application/json'});res.end(JSON.stringify(refused?{ok:false,error_code:401}:{ok:true,result:{id:42}}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const api='http://127.0.0.1:'+server.address().port;
 for(const [token,expected] of [[TOKEN,true],['refused-token',false]]){
  const {root,store}=fixture(t),home=path.join(root,'hermes-home');fs.mkdirSync(home);fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN='+token+'\n');
  const record=await runConnectionCheck({root,home,env:{GODSPEED_TODAY:D1,GODSPEED_TELEGRAM_API:api}});
  assert.equal(record.connections.telegram.ok,expected);
  assert.ok(!JSON.stringify(record).includes(token));
  assert.ok(!fs.readFileSync(path.join(store.state,RECORD_FILE),'utf8').includes(token));
 }
 assert.deepEqual(seen,[`/bot${TOKEN}/getMe`,'/botrefused-token/getMe']);
});

test('a Telegram probe sends its token only to HTTPS or a loopback stand-in',async t=>{
 const {root}=fixture(t),home=path.join(root,'hermes-home');fs.mkdirSync(home);fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN='+TOKEN+'\n');
 for(const {input,output} of TELEGRAM_API_VECTORS.accepted)assert.equal(telegramAPI(input),output,input);
 let request;
 assert.deepEqual(await telegramProbe({home,api:'https://api.example.test/telegram/',fetcher:async url=>{request=url;return {ok:true,json:async()=>({ok:true})};}})(),{set_up:true,ok:true});
 assert.equal(request,`https://api.example.test/telegram/bot${TOKEN}/getMe`);
 for(const api of TELEGRAM_API_VECTORS.rejected){
  let called=false;
  assert.deepEqual(await telegramProbe({home,api,fetcher:async()=>{called=true;throw Error('called');}})(),{set_up:true,ok:false,kind:'other'},api);
  assert.equal(called,false,api+' never receives the token');
 }
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
 const noLegacy=()=>({credentials:()=>({}),status:async()=>{throw Error('called');}});
 assert.deepEqual(await mailProbe({imap:()=>({status:()=>({state:'not connected'}),check:async()=>{throw Error('called');}}),legacy:noLegacy})(),{set_up:false});
 store.save('collections',{id:'gm',name:'Gm',field_schema:[],tracker:{names:['Gm'],cadence:'any',talks:[],specialist:null,mail:{senders:['shop.example.invalid'],subjects:['order'],mailbox:'gmail'}}});
 assert.deepEqual(await mailProbe({imap:()=>({status:()=>({state:'not connected'})}),legacy:noLegacy,store})(),{set_up:true,ok:false,kind:'sign-in'},'a saved Gmail rule with nothing connected is a sign-in');
 // Gmail connected the older way is checked when the app-password one is not there.
 const notImap=()=>({status:()=>({state:'not connected'})}),older=state=>()=>({credentials:()=>({GMAIL_REFRESH_TOKEN:'x'}),status:async()=>({state})});
 assert.deepEqual(await mailProbe({imap:notImap,legacy:older('connected')})(),{set_up:true,ok:true});
 assert.deepEqual(await mailProbe({imap:notImap,legacy:older('reconnect needed')})(),{set_up:true,ok:false,kind:'sign-in'});
 assert.deepEqual(await mailProbe({imap:notImap,legacy:older('unreachable')})(),{set_up:true,ok:false,kind:'other'});
 // The mission control's own mailbox is probed only while a mail rule names it.
 const godspeed=state=>async()=>({state});
 assert.deepEqual(await agentmailProbe({store,godspeed:godspeed('connected')})(),{set_up:false},'no rule names it');
 store.save('collections',{id:'shop',name:'Shop',field_schema:[],tracker:{names:['Shop'],cadence:'any',talks:[],specialist:null,mail:{senders:['shop.example.invalid'],subjects:['order'],mailbox:'godspeed'}}});
 assert.deepEqual(await agentmailProbe({store,godspeed:godspeed('connected')})(),{set_up:true,ok:true});
 assert.deepEqual(await agentmailProbe({store,godspeed:godspeed('reconnect needed')})(),{set_up:true,ok:false,kind:'sign-in'});
 assert.deepEqual(await agentmailProbe({store,godspeed:godspeed('not connected')})(),{set_up:true,ok:false,kind:'sign-in'});
 assert.deepEqual(await agentmailProbe({store,godspeed:godspeed('unreachable')})(),{set_up:true,ok:false,kind:'other'});
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

test('the check is wanted when Telegram or Gmail is connected, and on a server',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-home-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const none=()=>({status:()=>({state:'not connected'})}),mail=()=>({status:()=>({state:'connected'})});
 assert.equal(connectionCheckWanted(home,none),false);assert.equal(connectionCheckWanted(home,mail),true);
 assert.equal(connectionCheckWanted(home,none,undefined,undefined,()=>true),true);
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
 assert.deepEqual(Object.keys(defaultProbes({store:{},home:'x',server:true})),Object.keys(CONNECTIONS));
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
 assert.deepEqual(Object.keys(defaultProbes({store:{},home:'x',server:true})),Object.keys(CONNECTION_NAMES));
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

test('a damaged record fails the check instead of restarting the outage count',async t=>{
 const {store}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({github:down})});
 for(const bad of ['{not json}','{"connections":[]}','null']){
  fs.writeFileSync(path.join(store.state,RECORD_FILE),bad);
  await assert.rejects(checkConnections({store,day:D2,probes:stubs({github:down})}));
 }
 assert.deepEqual(readNotices(store),[]);
});

test('a damaged entry for one connection fails the check instead of restarting its outage count',async t=>{
 const {store}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({github:down})});
 const file=path.join(store.state,RECORD_FILE),good=fs.readFileSync(file,'utf8');
 for(const bad of [1,'x',[],{},{set_up:true,kind:'other'},{set_up:true},{set_up:false,deadline:{slug:'other',key:'other:deadline'}},{set_up:false,kind:'sign-in',told:true,failing_since:D1,deadline:{slug:'other',key:'other:deadline'}}]){
  const record=JSON.parse(good);record.connections.github=bad;fs.writeFileSync(file,JSON.stringify(record));
  await assert.rejects(checkConnections({store,day:D2,probes:stubs({github:down})}));
 }
 assert.deepEqual(readNotices(store),[]);
});

test('a sign-in notice that cannot be stored keeps its deadline, so a recovery still closes it',async t=>{
 const {store,root}=fixture(t);
 const file=path.join(store.state,'notices.json');
 fs.rmSync(file,{force:true});fs.mkdirSync(file);
 await assert.rejects(checkConnections({store,day:D1,probes:stubs({telegram:refused})}));
 fs.rmSync(file,{recursive:true});
 await checkConnections({store,day:D2,probes:stubs()});
 assert.equal(deadlines(store).find(d=>/telegram/.test(d.key)).state,'closed');
});

test('a sign-in still refused after its notice could not be stored queues the notice once, deadline kept',async t=>{
 const {store}=fixture(t);
 const file=path.join(store.state,'notices.json');
 fs.rmSync(file,{force:true});fs.mkdirSync(file);
 await assert.rejects(checkConnections({store,day:D1,probes:stubs({telegram:refused})}));
 fs.rmSync(file,{recursive:true});
 await checkConnections({store,day:D2,probes:stubs({telegram:refused})});
 await checkConnections({store,day:D2,probes:stubs({telegram:refused})});
 assert.equal(readNotices(store).filter(n=>/telegram/.test(n.id)).length,1);
 assert.equal(deadlines(store).find(d=>/telegram/.test(d.key)).state,'open');
});

test('a notice that cannot be stored does not stop the connections after it, and is retried',async t=>{
 const {store}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({ai:down,telegram:refused})}).catch(()=>{});
 const file=path.join(store.state,'notices.json');
 fs.rmSync(file,{force:true});fs.mkdirSync(file);
 const called=[],spy=name=>async()=>{called.push(name);return {set_up:true,ok:true};};
 await assert.rejects(checkConnections({store,day:D2,probes:{...probesFor(spy),ai:async()=>{called.push('ai');return {set_up:true,ok:false,kind:'other'};}}}));
 assert.deepEqual(called,SOURCES);
 fs.rmSync(file,{recursive:true});
 await checkConnections({store,day:D2,probes:stubs({ai:down,telegram:refused})});
 assert.equal(readNotices(store).filter(n=>/ai-other/.test(n.id)).length,1);
});

test('a recovery marker that cannot be written does not stop the connections after it, and the routine fails',async t=>{
 const {store,root}=fixture(t);
 await checkConnections({store,day:D1,probes:stubs({ai:refused})});
 fs.writeFileSync(path.join(root,'.godspeed','connection-check'),'');
 const called=[],spy=name=>async()=>{called.push(name);return {set_up:true,ok:true};};
 await assert.rejects(checkConnections({store,day:D2,probes:probesFor(spy)}),/ai/);
 assert.deepEqual(called,SOURCES);
 fs.rmSync(path.join(root,'.godspeed','connection-check'));
 await checkConnections({store,day:D3,probes:stubs()});
 assert.equal(deadlines(store).find(d=>/^ai:/.test(d.key)).state,'closed','the deadline is still pending after the failed day, so the next working day closes it');
});

// THE DISK ON A SERVER (#238). The file-system reading is a stub; the notices and deadlines are real.
const diskStubs=(percent,over={})=>stubs({disk:diskProbe({store:{root:'/srv/godspeed'},home:'/srv/hermes',used:()=>percent(),biggest:()=>[{folder:'/srv/hermes/sessions',bytes:5*1024**3},{folder:'/srv/godspeed/media',bytes:3*1024**3},{folder:'/srv/godspeed/routines',bytes:512*1024**2}],...over})});
test('the disk warning names the actual three largest direct folders in descending order',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-disk-folders-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const folders=[['small',1000],['second',2000],['largest',4000],['third',3000]].map(([name,bytes])=>{const folder=path.join(root,name);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'data'),'.'.repeat(bytes));return folder;});
 const result=await diskProbe({store:{root},used:()=>86})();
 const largest=[folders[2],folders[3],folders[1]];
 assert.deepEqual(largest.map(folder=>result.words.indexOf(folder+' (')),[...largest.map(folder=>result.words.indexOf(folder+' ('))].sort((a,b)=>a-b));
 for(const folder of largest)assert.match(result.words,new RegExp(folder.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.equal(result.words.includes(folders[0]+' ('),false);
});
test('the disk: 70% and 82% say nothing, 86% says it once with the three biggest folders and one deadline, 78% closes it',async t=>{
 const {store}=fixture(t);let percent=70;
 const probes=diskStubs(()=>percent);
 await checkConnections({store,day:D1,probes});percent=82;await checkConnections({store,day:D1,probes});
 assert.deepEqual(readNotices(store),[]);assert.deepEqual(deadlines(store),[]);
 percent=86;await checkConnections({store,day:D2,probes});
 const told=readNotices(store);assert.equal(told.length,1);
 assert.match(told[0].text,/86% full/);for(const folder of ['/srv/hermes/sessions (5.0 GB)','/srv/godspeed/media (3.0 GB)','/srv/godspeed/routines (512 MB)'])assert.ok(told[0].text.includes(folder),folder);
 assert.equal(deadlines(store).length,1);assert.equal(deadlines(store)[0].state,'open');
 await checkConnections({store,day:D3,probes});
 assert.equal(readNotices(store).length,1,'the next run at 86% says nothing more');assert.equal(deadlines(store).length,1);
 percent=82;await checkConnections({store,day:D3,probes});
 assert.equal(deadlines(store)[0].state,'open','between 80% and 85% nothing changes');
 percent=78;await checkConnections({store,day:D3,probes});
 assert.equal(deadlines(store)[0].state,'closed');assert.equal(readNotices(store).length,1);
});
test('a desktop install has no disk source',async t=>{
 const {store}=fixture(t);
 assert.equal(defaultProbes({store,home:'/h',server:false}).disk,undefined);
 assert.equal(typeof defaultProbes({store,home:'/h',server:true}).disk,'function');
 const {disk,...desktopProbes}=stubs();
 const record=await checkConnections({store,day:D1,probes:desktopProbes});
 assert.equal(record.connections.disk,undefined);
});
test('the routine entry point includes the disk only on a server install',async t=>{
 const {root,store}=fixture(t);const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-home-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const desktop=await runConnectionCheck({root,home,env:{GODSPEED_TODAY:D1}});
 assert.equal(desktop.connections.disk,undefined);
 const server=await runConnectionCheck({root,home,env:{GODSPEED_TODAY:D2,GODSPEED_WEB_ADDRESS:'https://godspeed.example'}});
 assert.equal(typeof server.connections.disk?.set_up,'boolean');
});
