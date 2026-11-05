import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {trackerOperation} from '../core/tracker-operations.mjs';import {trackers,entries,proposalState} from '../core/trackers.mjs';
import {mailId} from '../core/mail-trackers.mjs';import {runMailCount} from '../scripts/mail-count.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_|AGENTMAIL_)/.test(key))delete process.env[key];

// A TRACKER COUNTS A KIND OF MAIL (#215). The mailbox is a loopback stand-in for AgentMail that answers the
// list call with the previews the real one always returns, every one carrying MARKER, and records every
// request, so a call for a message's body would show. Everything here is made up.
const MARKER='MARKER-7f3c';
const mail=(id,from,subject,timestamp)=>({message_id:id,from,subject,timestamp,labels:['received'],preview:MARKER+' preview of '+id,extracted_text:MARKER+' body of '+id});
const MAILS=[
 // Berlin is two hours ahead on 5 October: o5 is its first local day's 01:30, o6 the last minute-ish of the day before.
 mail('o5','Shop <orders@shop.example.invalid>','New order #1000','2026-10-04T23:30:00Z'),
 mail('o6','Shop <orders@shop.example.invalid>','New order #999','2026-10-04T21:30:00Z'),
 mail('o1','Shop <orders@shop.example.invalid>','New order #1001','2026-10-25T10:00:00Z'),
 mail('o2','Shop <orders@shop.example.invalid>','New order #1002','2026-10-30T23:30:00Z'),
 mail('o3','Shop <orders@shop.example.invalid>','You made a sale','2026-11-02T08:00:00Z'),
 mail('o4','Shop <orders@shop.example.invalid>','NEW ORDER #1004','2026-11-03T09:00:00Z'),
 mail('s1','Shop <orders@shop.example.invalid>','Your shipping label','2026-11-01T09:00:00Z'),
 mail('s2','Shop <orders@shop.example.invalid>','Our newsletter','2026-11-01T10:00:00Z'),
 mail('l1','Fake <x@notshop.example.invalid>','New order #9','2026-11-01T11:00:00Z'),
 mail('a1','HR <hr@jobs.alpha.example.invalid>','Your application to Alpha','2026-10-28T09:00:00Z'),
 mail('a2','Team <team@careers.beta.example.invalid>','Re: your application','2026-11-02T09:00:00Z'),
 mail('a3','HR <hr@jobs.alpha.example.invalid>','Our holiday party','2026-11-02T10:00:00Z'),
 mail('u1','Friend <friend@mail.example.invalid>','Hello there','2026-11-01T12:00:00Z'),
 mail('u2','Friend <friend@mail.example.invalid>','Your application is welcome here','2026-11-01T13:00:00Z'),
 mail('u3','Bank <bank@bank.example.invalid>','Statement','2026-11-01T14:00:00Z'),
];
const requests=[];let status=200;
// With a barrier set, the first page of a list is answered only once that many searches have asked.
let barrier=0;const waiting=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://x');requests.push(url.pathname+url.search);
 if(barrier&&!url.searchParams.get('page_token')){waiting.push(()=>answer(url,res));if(waiting.length>=barrier)waiting.splice(0).forEach(go=>go());return;}
 answer(url,res);
});
function answer(url,res){
 if(status!==200){res.statusCode=status;res.end('{}');return;}
 res.setHeader('content-type','application/json');
 const one=url.pathname.match(/\/messages\/([^/]+)$/);
 if(one){res.end(JSON.stringify(MAILS.find(m=>m.message_id===one[1])||{}));return;}
 const from=url.searchParams.get('from')||'',after=Date.parse(url.searchParams.get('after')||'1970-01-01'),offset=Number(url.searchParams.get('page_token')||0);
 const all=MAILS.filter(m=>m.from.includes(from)&&Date.parse(m.timestamp)>=after),page=all.slice(offset,offset+2);
 res.end(JSON.stringify({messages:page,next_page_token:offset+2<all.length?String(offset+2):undefined}));
}
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-mail-home-'));
Object.assign(process.env,{GODSPEED_MAIL_AGENTMAIL_API:'http://127.0.0.1:'+server.address().port,GODSPEED_MAIL_AGENTMAIL_INBOX:'me@agentmail.example.invalid',AGENTMAIL_READ_KEY:'am_read_invented',GODSPEED_MAIL_HOME:home,GODSPEED_NOW:'2026-11-04T10:00:00Z'});
test.after(()=>{server.close();fs.rmSync(home,{recursive:true,force:true});});

// Async: the stand-in answers from this process, which a blocking spawn would stop.
const script=root=>promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/mail-count.mjs',import.meta.url))],{env:{...process.env,GODSPEED_WORKSPACE:root}}).then(r=>({status:0,...r}),e=>({status:e.code,stdout:e.stdout,stderr:e.stderr}));
const NOW=new Date('2026-11-04T10:00:00Z');
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-mail-trackers-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});requests.length=0;status=200;barrier=0;return {root,store,query,domains:new Domains(query)};};
const ORDERS={senders:['shop.example.invalid'],subjects:['new order','You made a sale'],mailbox:'godspeed'};
const APPLICATIONS={senders:['alpha.example.invalid','beta.example.invalid'],subjects:['application'],mailbox:'godspeed'};
// The sentence, their yes, and the saved card, the way the recipe runs them.
const setUp=async(domains,rule,{name,tracker}={})=>{
 const asked=await trackerOperation(domains,{type:'tracker-mail',action:'ask',...(tracker?{tracker}:{name}),...rule,words:'count my mails'});
 const made=trackerOperation(domains,{type:'tracker-create',proposal_id:asked.proposal_id,words:'yes'});
 return {asked,made};
};
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
const leaks=dir=>files(dir).filter(f=>fs.readFileSync(f).includes(MARKER));
const count=(store,name)=>entries(store,trackers(store).find(c=>c.name===name)).filter(i=>i.data.mail_id);

test('setup asks in one sentence with the 30-day number, saves the rule only on yes, and counts only what the rule names',async t=>{
 const {root,store,domains}=fixture(t);
 const before=trackers(store).length,asked=await trackerOperation(domains,{type:'tracker-mail',action:'ask',name:'Shop orders',...ORDERS,words:'count my mails'});
 assert.equal(asked.reply,'Count each mail from shop.example.invalid whose subject says "new order" or "You made a sale", in your mission control\'s own mailbox, as one in a new tracker called Shop orders? In the last 30 days that is 5 mails.');
 assert.equal(trackers(store).length,before,'nothing is saved by the question');
 assert.throws(()=>trackerOperation(domains,{type:'tracker-create',proposal_id:asked.proposal_id,words:'count my mails'}),/message that asked/);
 const p=store.get('tracker_proposals',asked.proposal_id);assert.equal(proposalState(store,p,NOW),'pending');
 assert.deepEqual(trackerOperation(domains,{type:'tracker-list'}).pending.map(x=>x.question),[asked.reply]);
 const made=trackerOperation(domains,{type:'tracker-create',proposal_id:asked.proposal_id,words:'yes'});
 assert.match(made.reply,/^Saved\. Shop orders now counts these mails every morning/);
 assert.equal(proposalState(store,store.get('tracker_proposals',p.id),NOW),'created');
 const [c]=trackers(store);assert.deepEqual({...c.tracker.mail,proposal_id:undefined},{...ORDERS,subjects:['new order','You made a sale'],proposal_id:undefined});
 const apps=await setUp(domains,APPLICATIONS,{name:'Applications'});assert.match(apps.asked.reply,/that is 2 mails\.$/);
 await runMailCount({root,now:NOW});
 assert.equal(count(store,'Shop orders').length,5);assert.equal(count(store,'Applications').length,2);
 assert.ok(count(store,'Shop orders').every(i=>i.data.value===1));
 assert.deepEqual(leaks(root),[],'no body or preview in any record');
 assert.ok(count(store,'Shop orders').every(i=>/^godspeed:[0-9a-f]{32}$/.test(i.data.mail_id)),'only a digest of the message id is kept');
 assert.ok(!requests.some(r=>/\/messages\/[^/?]+(\?|$)/.test(r)),'no message is fetched one by one');
});

test('an address and its domain named together count each mail once',async t=>{
 const {domains}=fixture(t);
 const asked=await trackerOperation(domains,{type:'tracker-mail',action:'ask',name:'Both',...ORDERS,senders:['shop.example.invalid','orders@shop.example.invalid'],words:'count my mails'});
 assert.match(asked.reply,/that is 5 mails\.$/);
});
test('a second run adds nothing, and neither does a window that overlaps the last',async t=>{
 const {root,store,domains}=fixture(t);await setUp(domains,ORDERS,{name:'Shop orders'});
 assert.deepEqual(await runMailCount({root,now:NOW}),{added:5});
 assert.deepEqual(await runMailCount({root,now:NOW}),{added:0});
 const file=path.join(root,'.godspeed','mail-counts.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const r of Object.values(state.rules))r.last_day='2026-10-24';
 fs.writeFileSync(file,JSON.stringify(state));
 assert.deepEqual(await runMailCount({root,now:NOW}),{added:0});
 assert.equal(count(store,'Shop orders').length,5);
 assert.match(requests.find(r=>r.includes('after='))||'',/after=2026-10-04/,'the first run reaches back 30 days, a day early for the zone');
});

// The script finishes its header search at a barrier while another process holds the workspace and, inside it, does `inside`.
async function overlapped(t,inside){
 const {root,domains}=fixture(t);await setUp(domains,ORDERS,{name:'Shop orders'});
 // The script runs on the real clock, so one mail is made an hour old now.
 const live=mail('live','Shop <orders@shop.example.invalid>','New order #live',new Date(Date.now()-3600e3).toISOString());MAILS.push(live);t.after(()=>MAILS.splice(MAILS.indexOf(live),1));
 const c=trackers(new Store(root)).find(x=>x.name==='Shop orders'),liveId=mailId('godspeed','live');
 const other=`import {Store} from ${JSON.stringify(new URL('../core/records/store.mjs',import.meta.url).href)};import {QueryService} from ${JSON.stringify(new URL('../core/query.mjs',import.meta.url).href)};
const store=new Store(${JSON.stringify(root)}),query=new QueryService(store),card=${JSON.stringify(c)},execute=args=>query.execute({...args,holdingLock:true});
store.withLock(()=>{console.log('held');${inside(liveId,c)};Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);});`;
 barrier=99;
 const ran=script(root);while(!waiting.length)await new Promise(r=>setTimeout(r,20));
 const holder=execFile(process.execPath,['--input-type=module','-e',other]);
 await new Promise(r=>holder.stdout.on('data',r));
 waiting.splice(0).forEach(go=>go());
 assert.equal((await ran).status,0);
 const file=path.join(new Store(root).state,'mail-counts.json');
 return {ids:count(new Store(root),'Shop orders').map(i=>i.data.mail_id),liveId,saved:fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).rules?.[c.id]:undefined};
}
const insertLive=liveId=>`execute({table:'collection_items',operation:'insert',values:{collection_id:card.id,data:{when:'2026-11-05 00:00',value:1,mail_id:${JSON.stringify(liveId)}}}})`;
const updateRule=mail=>`{const {mail:_,...rest}=card.tracker;execute({table:'collections',operation:'update',values:{tracker:${mail?`{...rest,mail:{...card.tracker.mail,senders:['other.example.invalid']}}`:'rest'}},filters:[['eq','id',card.id]]});}`;

test('a run whose search finished while another process writes waits for it and counts each mail once',async t=>{
 const {ids,liveId}=await overlapped(t,insertLive);
 assert.equal(ids.filter(id=>id===liveId).length,1);assert.equal(new Set(ids).size,ids.length);
});

test('a run that waited while the rule was removed or changed adds nothing',async t=>{
 for(const mail of [false,true]){
  const {ids,saved}=await overlapped(t,()=>updateRule(mail));
  assert.deepEqual(ids,[],mail?'changed rule':'removed rule');
  assert.equal(saved,undefined,'the old rule keeps no cursor');
 }
});

test('a mail is entered on its local date, with its own minute',async t=>{
 const {root,store,domains}=fixture(t);await setUp(domains,ORDERS,{name:'Shop orders'});await runMailCount({root,now:NOW});
 assert.deepEqual(count(store,'Shop orders').map(i=>i.data.when),['2026-10-05 01:30','2026-10-25 11:00','2026-10-31 00:30','2026-11-02 09:00','2026-11-03 10:00']);
});

test('how many this week: the entries are the tracker\'s, as any tracker\'s',async t=>{
 const {root,domains}=fixture(t);await setUp(domains,ORDERS,{name:'Shop orders'});await runMailCount({root,now:NOW});
 const list=trackerOperation(domains,{type:'tracker-list',days:7}),shop=list.trackers.find(x=>x.name==='Shop orders');
 assert.equal(shop.recent.length,3);assert.deepEqual(shop.mail.senders,['shop.example.invalid']);
});

test('no rule: no mail call at all, from the script too',async t=>{
 const {root,store}=fixture(t);
 store.save('collections',{name:'Belly',field_schema:[],tracker:{names:['Belly'],cadence:'daily',talks:[],specialist:null}});
 assert.deepEqual(await runMailCount({root,now:NOW}),{added:0});
 const ran=await script(root);
 assert.equal(ran.status,0);assert.equal(ran.stdout+ran.stderr,'');assert.deepEqual(requests,[]);
});

test('a connection that does not answer counts nothing, says nothing and keeps its place',async t=>{
 const {root,store,domains}=fixture(t);await setUp(domains,ORDERS,{name:'Shop orders'});
 status=401;
 const ran=await script(root);
 assert.equal(ran.status,0);assert.equal(ran.stdout+ran.stderr,'');
 assert.equal(count(store,'Shop orders').length,0);assert.ok(!fs.existsSync(path.join(root,'.godspeed','notices.json')));
 assert.ok(!fs.existsSync(path.join(root,'.godspeed','mail-counts.json'))||!Object.keys(JSON.parse(fs.readFileSync(path.join(root,'.godspeed','mail-counts.json'),'utf8')).rules).length);
 status=200;assert.deepEqual(await runMailCount({root,now:NOW}),{added:5},'the next morning counts the whole window');
 status=401;
 const asked=await trackerOperation(domains,{type:'tracker-mail',action:'ask',name:'Apps',...APPLICATIONS,words:'count'});
 assert.equal(asked.proposal_id,undefined);assert.match(asked.reply,/nothing was saved/);assert.ok(!asked.reply.includes(MARKER));
});

test('a tracker that keeps one entry a day cannot take a rule, and an existing counting tracker can',async t=>{
 const {root,store,domains}=fixture(t);
 trackerOperation(domains,{type:'tracker-create',fields:[{label:'Sales',type:'number'}],name:'Sales',cadence:'daily'});
 await assert.rejects(async()=>trackerOperation(domains,{type:'tracker-mail',action:'ask',tracker:'Sales',...ORDERS,words:'x'}),/one entry a day/);
 trackerOperation(domains,{type:'tracker-create',name:'Orders',cadence:'any',fields:[]});
 const orders=trackers(store).find(c=>c.name==='Orders');store.save('collection_items',{collection_id:orders.id,data:{when:'2026-10-01 10:00'}});
 const {asked}=await setUp(domains,ORDERS,{tracker:'Orders'});assert.match(asked.reply,/as one in Orders\? In the last 30 days that is 5 mails\.$/);
 await runMailCount({root,now:NOW});
 assert.equal(entries(store,store.get('collections',orders.id)).length,6);assert.deepEqual(entries(store,store.get('collections',orders.id))[0].data,{when:'2026-10-01 10:00'});
 assert.ok(entries(store,store.get('collections',orders.id)).slice(1).every(i=>i.data.value===1),'a counting tracker with no column of its own still gets 1 for each mail');
});

test('changing and removing a rule: the old question is dropped, and the counted entries stay',async t=>{
 const {root,store,domains}=fixture(t);const {asked}=await setUp(domains,ORDERS,{name:'Shop orders'});await runMailCount({root,now:NOW});
 const again=await trackerOperation(domains,{type:'tracker-mail',action:'ask',tracker:'Shop orders',senders:['orders@shop.example.invalid'],subjects:['sale'],mailbox:'godspeed',words:'only sales'});
 assert.match(again.reply,/that is 0 mails\.$/,'what the tracker has already counted is not counted again');
 const hash=trackers(store)[0]._hash;
 trackerOperation(domains,{type:'tracker-create',proposal_id:again.proposal_id,words:'yes',expected:{[trackers(store)[0].id]:hash}});
 assert.deepEqual(trackers(store)[0].tracker.mail.subjects,['sale']);assert.equal(proposalState(store,store.get('tracker_proposals',asked.proposal_id),NOW),'created');
 const removed=trackerOperation(domains,{type:'tracker-mail',action:'remove',tracker:'Shop orders',expected:{[trackers(store)[0].id]:trackers(store)[0]._hash}});
 assert.match(removed.reply,/no longer counts mails\. The 5 mails it counted stay\.$/);assert.equal(trackers(store)[0].tracker.mail,undefined);assert.equal(count(store,'Shop orders').length,5);
 requests.length=0;assert.deepEqual(await runMailCount({root,now:NOW}),{added:0});assert.deepEqual(requests,[]);
});

test('a Gmail rule previews and counts the Gmail mailbox, and a godspeed rule the other',async t=>{
 const {root,store,domains}=fixture(t);
 const accounts=[],search=async a=>{accounts.push(a.account);return {account:a.account,messages:a.account==='gmail'?[{message_id:'g1',sender:'shop@gmail-shop.example.invalid',subject:'New order #7',date:'2026-11-02T08:00:00Z'}]:[]};};
 domains.mailSearch=search;
 const rule={senders:['gmail-shop.example.invalid'],subjects:['new order'],mailbox:'gmail'};
 const {asked}=await setUp(domains,rule,{name:'Gmail orders'});
 assert.match(asked.reply,/in your Gmail, as one.*In the last 30 days that is 1 mail/);
 assert.deepEqual(accounts,['gmail']);
 await setUp(domains,ORDERS,{name:'Shop orders'});
 accounts.length=0;
 assert.deepEqual(await runMailCount({root,now:NOW,search}),{added:1});
 assert.deepEqual([...accounts].sort(),['gmail','godspeed']);
 assert.equal(count(store,'Gmail orders').length,1);assert.equal(count(store,'Shop orders').length,0);
 assert.match(count(store,'Gmail orders')[0].data.mail_id,/^gmail:/);
});

test('no sender, shop or phrase is built into the code',()=>{
 for(const file of ['core/mail-trackers.mjs','scripts/mail-count.mjs'])assert.doesNotMatch(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),/etsy|amazon|shopify|gumroad|bewerbung/i,file);
});
