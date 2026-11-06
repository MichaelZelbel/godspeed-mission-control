import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {currentHealth} from '../core/health-inputs.mjs';
import {healthFeedId,phoneFeedId} from '../core/health-feed-id.mjs';
import {backup} from '../core/archives.mjs';
import {createService} from '../server/main.mjs';
import {tokenState,tokenDamaged,isUploadShape,appendRaw,encodeRawLine,parseRawLine,readRaw,acceptUpload,importFolder,buildDays,instantOf,pruneRaw,rawFolder,tokenFile,ensureToken,renewToken,tokenMatches,SOURCE} from '../core/phone-health.mjs';
import {checkConnections,phoneProbe} from '../core/connection-check.mjs';
import {addonDeadlines} from '../core/addon-deadlines.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// Every upload here is made up; no real health data.
const tmp=prefix=>fs.mkdtempSync(path.join(os.tmpdir(),prefix));
const setup=()=>{const store=new Store(tmp('godspeed-phone-health-'));store.save('settings',{id:'installation',owner:'local',timezone:'Europe/Berlin'});return store;};
const at=text=>new Date(text);
const metric=(name,units,...points)=>({name,units,data:points.map(([date,qty,extra={}])=>({date,qty,source:'Fictional Phone',...extra}))});
const upload=(metrics=[],workouts=[])=>({metrics,workouts});
const days=store=>Object.fromEntries(store.list('health_observations').map(r=>[r.observed_on+' '+r.metric,r.value]));
const D='2026-11-04';

test('overlapping windows count each point once, and kJ becomes kcal',()=>{
 const store=setup(),steps=[[D+' 08:00:00 +0100',100],[D+' 09:00:00 +0100',200],[D+' 10:00:00 +0100',300]];
 acceptUpload(store,upload([metric('step_count','count',steps[0],steps[1]),metric('active_energy','kJ',[D+' 08:00:00 +0100',418.4])]),{now:at('2026-11-04T09:30:00Z')});
 acceptUpload(store,upload([metric('step_count','count',steps[1],steps[2])]),{now:at('2026-11-04T10:30:00Z')});
 acceptUpload(store,upload([metric('step_count','count',steps[0],steps[2]),metric('active_energy','kJ',[D+' 08:00:00 +0100',418.4])]),{now:at('2026-11-04T11:30:00Z')});
 assert.equal(days(store)[D+' steps'],600);
 assert.equal(days(store)[D+' active_kcal'],100);
});

test('a day re-sent the next morning adds only its new points and rewrites nothing unchanged',()=>{
 const store=setup();
 acceptUpload(store,upload([metric('step_count','count',[D+' 08:00:00 +0100',100]),metric('flights_climbed','count',[D+' 08:00:00 +0100',3])]),{now:at('2026-11-04T20:00:00Z')});
 const before=Object.fromEntries(store.list('health_observations').map(r=>[r.metric,r]));
 const result=acceptUpload(store,upload([metric('step_count','count',[D+' 08:00:00 +0100',100],[D+' 23:30:00 +0100',50])]),{now:at('2026-11-05T07:00:00Z')});
 assert.equal(result.written,2);
 const after=Object.fromEntries(store.list('health_observations').map(r=>[r.metric,r]));
 assert.equal(after.steps.value,150);
 assert.equal(after.steps.data_until,'23:30:00');
 assert.equal(after.flights.data_until,'23:30:00');
 assert.equal(after.flights.revision,before.flights.revision+1);
});

test('a phone day keeps the latest quantitative point time, not its upload time or sleep',()=>{
 const short=buildDays([{received_at:'2026-11-05T07:00:00Z',data:upload([metric('step_count','count',[D+' 19:55:00 +0100',100]),metric('sleep_analysis','hr',[D+' 23:59:00 +0100',8])])}]);
 assert.equal(short.dataUntil.get(D),'19:55:00');
 for(const [time,expected] of [['19:55','19:55:00'],['21:00:00','21:00:00'],['21:00:30','21:00:30']]){
  const built=buildDays([{received_at:'2026-11-05T08:00:00Z',data:upload([metric('step_count','count',[D+' '+time+' +0100',100])])}]);assert.equal(built.dataUntil.get(D),expected);
 }
 const store=setup();acceptUpload(store,upload([metric('step_count','count',[D+' 19:55:00 +0100',100])]),{now:at('2026-11-05T08:00:00Z')});
 assert.equal(store.list('health_observations')[0].data_until,'19:55:00');
});

test('invalid point timestamps are ignored by every phone metric and cannot create a complete day',()=>{
 const metrics=['step_count','walking_running_distance','active_energy','basal_energy_burned','dietary_energy','protein','carbohydrates','total_fat','flights_climbed','weight_body_mass','body_fat_percentage','lean_body_mass','waist_circumference'];
 const invalid=['2026-11-04 24:00:00 +0100','2026-11-04 12:60:00 +0100','2026-11-04 12:00:60 +0100','2026-11-04 12:00:00 +24:00','2026-02-29 12:00:00 +0100'];
 for(const timestamp of invalid){
  assert.ok(Number.isNaN(instantOf(timestamp)),timestamp);
  const data=upload(metrics.map(name=>metric(name,'count',[timestamp,1]))),built=buildDays([{received_at:'2026-11-05T08:00:00Z',data}]);
  assert.equal(built.size,0,timestamp);assert.equal(built.dataUntil.size,0,timestamp);
  const store=setup();acceptUpload(store,data,{now:at('2026-11-05T08:00:00Z')});assert.deepEqual(currentHealth(new QueryService(store),{now:Date.parse('2026-11-06T08:00:00Z')}).days,[],timestamp);
 }
});

test('a numeric weight later than the steps sets the day\'s data time, and a still later sleep point does not',()=>{
const upload1=upload([metric('step_count','count',[D+' 19:55:00 +0100',100]),metric('weight_body_mass','kg',[D+' 21:30:00 +0100',79.5]),metric('sleep_analysis','hr',[D+' 23:59:00 +0100',8])]);
 assert.equal(buildDays([{received_at:'2026-11-05T07:00:00Z',data:upload1}]).dataUntil.get(D),'21:30:00','the weight point, not the steps or the sleep');
 const store=setup();acceptUpload(store,upload1,{now:at('2026-11-05T08:00:00Z')});
 const rows=Object.fromEntries(store.list('health_observations').map(r=>[r.metric,r]));
 assert.equal(rows.steps.data_until,'21:30:00','the emitted day record carries the weight time');
 assert.equal(rows.weight_kg.data_until,'21:30:00');
 assert.equal(rows.weight_kg.value,79.5);
});

test('records are day records in the CSV feed\'s id scheme, on the date in the point\'s own string',()=>{
 const store=setup();
 acceptUpload(store,upload([metric('step_count','count',['2026-11-04 00:09:00 +0100',40])]),{now:at('2026-11-03T23:30:00Z')});
 const [row]=store.list('health_observations');
 assert.equal(row.id,phoneFeedId(SOURCE,D,'steps'));
 assert.deepEqual([row.source,row.date_precision,row.observed_on,row.value],['Health Auto Export','day',D,40]);
});

test('the last value is the latest moment, not the latest text, and a tie goes to the later upload',()=>{
 assert.ok(instantOf('2026-10-25 02:30:00 +0200')<instantOf('2026-10-25 02:10:00 +0100'));
 const dst=[['2026-10-25 02:30:00 +0200',80],['2026-10-25 02:10:00 +0100',81]];
 assert.equal(buildDays([{received_at:'2026-10-25T03:00:00Z',data:upload([metric('weight_body_mass','kg',...dst)])}]).get('2026-10-25').get('weight_kg'),81);
 const tie=value=>({received_at:'2026-10-25T0'+value+':00:00Z',data:upload([metric('weight_body_mass','kg',['2026-10-25 08:00:00.250 +0100',70+value])])});
 const point=buildDays([tie(1),tie(2)]);
 assert.equal(point.get('2026-10-25').get('weight_kg'),72);
 assert.equal(buildDays([tie(2),tie(1)].sort((a,b)=>a.received_at.localeCompare(b.received_at))).get('2026-10-25').get('weight_kg'),72);
});

test('a point of one metric is not dropped because another metric of the day reached later',()=>{
 const built=buildDays([{received_at:'2026-11-04T20:00:00Z',data:upload([metric('weight_body_mass','kg',[D+' 07:00:00 +0100',80]),metric('lean_body_mass','kg',[D+' 07:00:00 +0100',60],[D+' 21:00:00 +0100',61]),metric('body_fat_percentage','%',[D+' 22:00:00 +0100',18])])}]).get(D);
 assert.deepEqual([built.get('weight_kg'),built.get('lean_kg'),built.get('body_fat_pct')],[80,61,18]);
});

test('the longest sleep record wins with its times, and a plain total counts only without one',()=>{
 const sleep=(total,start,end,extra={})=>({date:D+' 00:00:00 +0100',source:'Fictional Phone',totalSleep:total,inBed:total+0.5,deep:1,rem:2,sleepStart:start,sleepEnd:end,...extra});
 const built=buildDays([{received_at:'2026-11-04T07:00:00Z',data:upload([{name:'sleep_analysis',units:'hr',data:[sleep(3,'2026-11-03 23:10:00 +0100','2026-11-04 02:10:00 +0100'),sleep(7.5,'2026-11-04 03:00:00 +0100','2026-11-04 10:30:00 +0100',{date:D+' 01:00:00 +0100'})]}])}]).get(D);
 assert.deepEqual([built.get('sleep_total_h'),built.get('sleep_in_bed_h'),built.get('sleep_start'),built.get('sleep_end')],[7.5,8,'03:00','10:30']);
 const plain=buildDays([{received_at:'2026-11-04T07:00:00Z',data:upload([metric('sleep_analysis','hr',[D+' 00:00:00 +0100',2],[D+' 01:00:00 +0100',6])])}]).get(D);
 assert.equal(plain.get('sleep_total_h'),6);
});

test('runs, walks and gym workouts land in their columns, and a workout sent twice counts once as its last copy',()=>{
 const workout=(name,minutes,km,extra={})=>({name,start:D+' 07:00:00 +0100',end:D+' 08:00:00 +0100',duration:minutes*60,...(km===null?{}:{distance:{qty:km,units:'km'}}),...extra});
 const build=(...workouts)=>buildDays(workouts.map((w,i)=>({received_at:'2026-11-04T1'+i+':00:00Z',data:upload([],[w])}))).get(D);
 const run=build(workout('Running',30,5));
 assert.deepEqual([run.get('run_km'),run.get('run_min'),run.has('walk_km')],[5,30,false]);
 const walk=build(workout('Run',30,3));
 assert.deepEqual([walk.get('walk_km'),walk.get('walk_min'),walk.has('run_km')],[3,30,false]);
 const bare=build(workout('Outdoor Run',20,null));
 assert.deepEqual([bare.get('run_km'),bare.get('run_min')],[0,20]);
 const gym=build(workout('Traditional Strength Training',45,null),workout('Yoga',15,null,{start:D+' 18:00:00 +0100'}));
 assert.deepEqual([gym.get('workout_min'),gym.get('workout_types')],[60,'Traditional Strength Training+Yoga']);
 const twice=build(workout('Running',30,5,{id:'w1'}),workout('Running',33,5.5,{id:'w1'}));
 assert.deepEqual([twice.get('run_km'),twice.get('run_min')],[5.5,33]);
 const sameStart=build(workout('Running',30,5),workout('Running',40,6,{end:D+' 09:00:00 +0100'}));
 assert.equal(sameStart.get('run_km'),6);
 const metres=build({name:'Running',start:D+' 07:00:00 +0100',duration:{qty:30,units:'min'},distance:{qty:5000,units:'m'}});
 assert.deepEqual([metres.get('run_km'),metres.get('run_min')],[5,30]);
});

test('metrics that are not listed are kept raw and make no record',()=>{
 const store=setup();
 acceptUpload(store,upload([metric('heart_rate_variability','ms',[D+' 08:00:00 +0100',55])]),{now:at('2026-11-04T09:00:00Z')});
 assert.equal(store.list('health_observations').length,0);
 assert.match(fs.readFileSync(path.join(rawFolder(store.state),'2026-11-04.jsonl'),'utf8'),/heart_rate_variability/);
});

test('an expired raw file leaves its day\'s records as they were, and only a new metric is added',()=>{
 const store=setup();
 acceptUpload(store,upload([metric('step_count','count',[D+' 08:00:00 +0100',100])]),{now:at('2026-11-04T09:00:00Z')});
 const before=store.list('health_observations')[0];
 const later=at('2026-12-05T09:00:00Z');
 acceptUpload(store,upload([metric('step_count','count',[D+' 08:00:00 +0100',100],[D+' 09:00:00 +0100',999]),metric('flights_climbed','count',[D+' 09:00:00 +0100',4])]),{now:later});
 assert.equal(fs.existsSync(path.join(rawFolder(store.state),'2026-11-04.jsonl')),false);
 const after=days(store);
 assert.equal(after[D+' steps'],before.value);
 assert.equal(after[D+' flights'],4);
 assert.equal(pruneRaw(store.state,later),0);
});

test('the import builds the same days from the same lines as the receiver, and never stores the sender',()=>{
 const lines=[
  {received_at:'2026-11-04T09:00:00Z',remote:'203.0.113.9',data:upload([metric('step_count','count',[D+' 08:00:00 +0100',100]),metric('active_energy','kJ',[D+' 08:00:00 +0100',836.8])],[{name:'Running',start:D+' 07:00:00 +0100',duration:1800,distance:{qty:5,units:'km'}}])},
  {received_at:'2026-11-04T10:00:00Z',remote:'203.0.113.9',data:upload([metric('step_count','count',[D+' 08:00:00 +0100',100],[D+' 09:30:00 +0100',60]),metric('weight_body_mass','kg',[D+' 07:30:00 +0100',79.5])])},
 ];
 const a=setup(),b=setup(),folder=tmp('godspeed-phone-import-');
 for(const line of lines)acceptUpload(a,line.data,{now:at(line.received_at)});
 fs.writeFileSync(path.join(folder,'old.jsonl'),lines.map(l=>JSON.stringify(l)).join('\n')+'\nnot json\n');
 const result=importFolder(b,folder,{now:at('2026-11-05T08:00:00Z')});
 assert.deepEqual([result.lines,result.skipped,result.days],[3,1,1]);
 assert.deepEqual(days(b),days(a));
 for(const file of fs.readdirSync(rawFolder(b.state)))assert.doesNotMatch(fs.readFileSync(path.join(rawFolder(b.state),file),'utf8'),/remote|203\.0\.113/);
 assert.equal(importFolder(b,folder,{now:at('2026-11-05T08:00:00Z')}).written,0);
});

test('a phone value and a CSV value for one day and metric: the one written last wins, the rest are untouched',()=>{
 const store=setup(),query=new QueryService(store),now=Date.parse('2026-11-04T12:00:00Z');
 const row=(id,source,metric,value)=>store.save('health_observations',{id,source,...(source==='Health Auto Export'?{via:'phone-receiver'}:{}),metric,value,observed_on:D,date_precision:'day',observed_at:'2026-11-03T23:00:00.000Z'});
 row('csv-steps','Selected CSV','steps',1000);row('csv-weight','Selected CSV','weight_kg',80);
 row('health-feed-phone','Health Auto Export','steps',2000);
 let seen=Object.fromEntries(currentHealth(query,{now}).observations.map(r=>[r.metric,r.value]));
 assert.deepEqual(seen,{steps:2000,weight_kg:80});
 store.save('health_observations',{id:'csv-steps',value:1500});
 seen=Object.fromEntries(currentHealth(query,{now}).observations.map(r=>[r.metric,r.value]));
 assert.deepEqual(seen,{steps:1500,weight_kg:80});
 assert.equal(store.get('health_observations','health-feed-phone').value,2000);
});

test('an upload that cannot be published is not kept in the raw files either',()=>{
 const store=setup();
 acceptUpload(store,upload([metric('step_count','count',[D+' 08:00:00 +0100',100])]),{now:at('2026-11-04T09:00:00Z')});
 const file=path.join(rawFolder(store.state),'2026-11-04.jsonl'),kept=fs.readFileSync(file,'utf8'),commit=store.commit;
 store.commit=()=>{throw new Error('disk full');};
 assert.throws(()=>acceptUpload(store,upload([metric('step_count','count',[D+' 08:00:00 +0100',100],[D+' 09:00:00 +0100',50])]),{now:at('2026-11-04T10:00:00Z')}),/disk full/);
 assert.equal(fs.readFileSync(file,'utf8'),kept);
 store.commit=commit;
 const fresh=setup();fresh.commit=()=>{throw new Error('disk full');};
 assert.throws(()=>acceptUpload(fresh,upload([metric('step_count','count',[D+' 08:00:00 +0100',1])]),{now:at('2026-11-04T09:00:00Z')}));
 assert.deepEqual(fs.readdirSync(rawFolder(fresh.state)),[]);
});

test('an upload whose rollback also fails is kept and answered as pending, not as not kept',async t=>{
 const root=serverRoot('godspeed-phone-rollback-'),service=await createService({root,port:0,webPort:0}),logged=[],error=console.error;
 console.error=(...args)=>logged.push(args.join(' '));
 t.after(async()=>{console.error=error;await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const token=fs.readFileSync(tokenFile(service.store.state),'utf8').trim(),dir=rawFolder(service.store.state),truncate=fs.truncateSync;
 const send=value=>request(service.address.port,'/ingest/'+token,{method:'POST',body:{data:upload([metric('step_count','count',['2026-11-04 08:00:00 +0100',value])])}});
 assert.equal((await send(48151)).status,200);
 const file=path.join(dir,fs.readdirSync(dir)[0]),before=fs.readFileSync(file,'utf8');
 service.store.commit=()=>{throw new Error('disk full');};
 fs.truncateSync=()=>{throw new Error('read-only');};
 let second;try{second=await send(62342);}finally{fs.truncateSync=truncate;}
 assert.equal(second.status,202);
 assert.equal(JSON.parse(second.text).pending,true);
 assert.ok(fs.readFileSync(file,'utf8').length>before.length);
 assert.ok(logged.some(l=>l.includes('read-only')&&l.includes('disk full')));
 assert.ok(!logged.some(l=>l.includes(token)||l.includes('62342')||l.includes('48151')),logged.join('\n'));
});

test('an upload that is not kept answers 500 and logs neither its value nor the token',async t=>{
 const root=serverRoot('godspeed-phone-notkept-'),service=await createService({root,port:0,webPort:0}),logged=[],error=console.error;
 console.error=(...args)=>logged.push(args.join(' '));
 t.after(async()=>{console.error=error;await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const token=fs.readFileSync(tokenFile(service.store.state),'utf8').trim();
 service.store.commit=()=>{throw new Error('disk full');};
 const sent=await request(service.address.port,'/ingest/'+token,{method:'POST',body:{data:upload([metric('step_count','count',['2026-11-04 08:00:00 +0100',73519])])}});
 assert.equal(sent.status,500);
 assert.ok(logged.some(l=>l.includes('disk full')));
 assert.ok(!logged.some(l=>l.includes(token)||l.includes('73519')),logged.join('\n'));
 assert.ok(!sent.text.includes('73519')&&!sent.text.includes(token));
});

test('Personal Settings shows one value per day and metric when a phone and a CSV both gave one',async t=>{
 const root=serverRoot('godspeed-phone-personal-'),service=await createService({root,port:0,webPort:0});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const row=(id,source,value)=>service.store.save('health_observations',{id,source,...(source==='Health Auto Export'?{via:'phone-receiver'}:{}),metric:'steps',value,observed_on:D,date_precision:'day',observed_at:'2026-11-03T23:00:00.000Z'});
 row('csv-steps','Selected CSV',1000);row('health-feed-phone','Health Auto Export',2000);
 const shown=JSON.parse((await request(service.address.port,'/api/personal')).text).health;
 assert.deepEqual(shown.map(r=>r.value),[2000]);
});

test('the token is random, private to its file, replaced by renew, and compared exactly',()=>{
 const store=setup(),token=ensureToken(store.state);
 assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(ensureToken(store.state),token);
 assert.ok(tokenMatches(store.state,token));assert.ok(!tokenMatches(store.state,token+'x'));assert.ok(!tokenMatches(store.state,''));
 const next=renewToken(store.state);
 assert.notEqual(next,token);assert.ok(!tokenMatches(store.state,token));
 if(process.platform!=='win32')assert.equal(fs.statSync(tokenFile(store.state)).mode&0o777,0o600);
});

function request(port,route,{method='GET',body,raw}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:route,method,headers:body||raw?{'Content-Type':'application/json'}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text}));});
  req.on('error',error=>error.code==='EPIPE'||error.code==='ECONNRESET'?resolve({status:413,text:''}):reject(error));
  if(body||raw)req.write(raw??JSON.stringify(body));req.end();
 });
}
const serverRoot=prefix=>{const root=tmp(prefix);process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');return root;};

// Settings reaches the phone address only through the signed-in web door. The service is made with a setup code, which
// signs the test in on that door; the plain local door is open, so it must never be asked for the token.
const SETUP_CODE='fictional-setup-code';
async function webDoor(service){
 const base='http://127.0.0.1:'+service.webAddress.port;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:SETUP_CODE})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 return async(route,{method='GET',body,signedIn=true}={})=>{
  const answer=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(signedIn?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:answer.status,text:await answer.text()};
 };
}

test('the receiver on a server: a wrong token stores nothing, the right one keeps the day, nothing logs the token or the sender',async t=>{
 const root=serverRoot('godspeed-phone-server-'),service=await createService({root,port:0,webPort:0}),logged=[];
 const originals={error:console.error,log:console.log,warn:console.warn};
 for(const name of Object.keys(originals))console[name]=(...args)=>logged.push(args.join(' '));
 t.after(async()=>{Object.assign(console,originals);await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const port=service.address.port,token=fs.readFileSync(tokenFile(service.store.state),'utf8').trim(),raw=rawFolder(service.store.state);
 assert.equal((await request(port,'/ingest/health')).status,200);
 for(const route of ['/ingest/'+token.slice(1),'/ingest/','/ingest','/ingest/'+token+'/x'])assert.equal((await request(port,route,{method:'POST',body:{data:{}}})).status,404,route);
 assert.equal((await request(port,'/ingest/'+token)).status,404);
 assert.equal(fs.existsSync(raw),false);
 const body={data:upload([metric('step_count','count',['2026-11-04 08:00:00 +0100',123])])};
 assert.equal((await request(port,'/ingest/'+token,{method:'POST',body})).status,200);
 assert.equal(days(service.store)['2026-11-04 steps'],123);
 if(process.platform!=='win32'){
  assert.equal(fs.statSync(raw).mode&0o777,0o700);
  for(const file of fs.readdirSync(raw))assert.equal(fs.statSync(path.join(raw,file)).mode&0o777,0o600);
 }
 assert.equal((await request(port,'/ingest/'+token,{method:'POST',raw:'{not json'})).status,400);
 assert.equal((await request(port,'/ingest/'+token,{method:'POST',body:{data:{metrics:'x'}}})).status,400);
 const before=fs.readdirSync(raw).map(f=>fs.readFileSync(path.join(raw,f),'utf8'));
 assert.equal((await request(port,'/ingest/'+token,{method:'POST',raw:'{"data":{"pad":"'+'x'.repeat(21*1024*1024)+'"}}'})).status,413);
 assert.deepEqual(fs.readdirSync(raw).map(f=>fs.readFileSync(path.join(raw,f),'utf8')),before);
 assert.ok(!logged.some(line=>line.includes(token)||line.includes('127.0.0.1')||line.includes('123')),logged.join('\n'));
});

test('the next accepted upload closes the quiet-phone deadline before another daily check',async t=>{
 const root=serverRoot('godspeed-phone-recovery-'),service=await createService({root,port:0,webPort:0}),now='2026-11-05T23:00:00Z';process.env.GODSPEED_NOW=now;
 t.after(async()=>{delete process.env.GODSPEED_NOW;await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const store=service.store,working=async()=>({set_up:true,ok:true}),phone=phoneProbe({store}),probes={ai:working,telegram:working,github:working,mail:working,agentmail:working,phone};
 acceptUpload(store,upload(),{now:at('2026-11-04T10:00:00Z')});
 await checkConnections({store,day:'2026-11-05',probes,now:()=>new Date(now)});
 const [deadline]=addonDeadlines(store,{addon:'connection-check',action:'list'}).deadlines;assert.equal(deadline.state,'open');
 const token=fs.readFileSync(tokenFile(store.state),'utf8').trim();
 assert.equal((await request(service.address.port,'/ingest/'+token,{method:'POST',body:{data:upload()}})).status,200);
 assert.equal(addonDeadlines(store,{addon:'connection-check',action:'list'}).deadlines[0].state,'closed');
});

test('Settings shows an https address only, through the signed-in web door; a new address replaces the old one at once, and a computer offers nothing',async t=>{
 const root=serverRoot('godspeed-phone-settings-'),service=await createService({root,port:0,webPort:0,token:SETUP_CODE}),computerRoot=serverRoot('godspeed-phone-computer-'),computer=await createService({root:computerRoot,port:0});
 t.after(async()=>{delete process.env.GODSPEED_WEB_ADDRESS;await service.close();await computer.close();fs.rmSync(root,{recursive:true,force:true});fs.rmSync(computerRoot,{recursive:true,force:true});});
 const port=service.address.port,token=fs.readFileSync(tokenFile(service.store.state),'utf8').trim(),web=await webDoor(service);
 process.env.GODSPEED_WEB_ADDRESS='https://notes.example.test';
 // The ordinary local door is open to anything on this machine: it shows nothing and renews nothing, whatever the web address is.
 for(const [route,method] of [['/api/phone-health','GET'],['/api/phone-health/renew','POST']]){
  const local=await request(port,route,{method,body:method==='POST'?{}:undefined});
  assert.ok(!local.text.includes(token)&&!local.text.includes('/ingest/'),'no token on the local door: '+route);
  assert.equal(local.status,route.endsWith('renew')?404:200,route);
 }
 assert.deepEqual(JSON.parse((await request(port,'/api/phone-health')).text),{available:false});
 assert.equal(fs.readFileSync(tokenFile(service.store.state),'utf8').trim(),token,'renew on the local door changed nothing');
 // The web door asks for a signed-in session first.
 assert.equal((await web('/api/phone-health',{signedIn:false})).status,401);
 assert.equal((await web('/api/phone-health/renew',{method:'POST',body:{},signedIn:false})).status,401);
 assert.equal(fs.readFileSync(tokenFile(service.store.state),'utf8').trim(),token,'an unsigned renew changed nothing');
 const first=JSON.parse((await web('/api/phone-health')).text);
 assert.equal(first.address,'https://notes.example.test/ingest/'+token);
 const second=JSON.parse((await web('/api/phone-health/renew',{method:'POST',body:{}})).text);
 assert.notEqual(second.address,first.address);
 const route=address=>new URL(address).pathname;
 assert.equal((await request(port,route(first.address),{method:'POST',body:{data:{}}})).status,404);
 assert.equal((await request(port,route(second.address),{method:'POST',body:{data:{}}})).status,200);
 delete process.env.GODSPEED_WEB_ADDRESS;
 assert.deepEqual(JSON.parse((await web('/api/phone-health')).text),{available:true,address:null},'without an https address the web door shows none');

 assert.deepEqual(JSON.parse((await request(computer.address.port,'/api/phone-health')).text),{available:false});
 assert.equal((await request(computer.address.port,'/api/phone-health/renew',{method:'POST',body:{}})).status,404);
 assert.equal(fs.existsSync(tokenFile(computer.store.state)),false);
});

test('Settings and the server share one protocol: every answer, from every branch, has exactly the declared shape, and the panel reads the same fields',async t=>{
 const {PHONE_HEALTH_STATUS,PHONE_HEALTH_RENEW,PHONE_HEALTH_FIELDS,PHONE_HEALTH_SHAPE,phoneHealthAnswer}=await import('../core/phone-health-protocol.mjs');
 const panel=fs.readFileSync(new URL('../ui/src/local/PhoneHealth.tsx',import.meta.url),'utf8'),server=fs.readFileSync(new URL('../server/main.mjs',import.meta.url),'utf8');
 assert.ok(panel.includes("call('"+PHONE_HEALTH_STATUS+"')"),'the panel asks for the status route');
 assert.ok(panel.includes("call('"+PHONE_HEALTH_RENEW+"',"),'the panel renews on the renew route');
 const status=panel.match(/type Status=\{([^}]*)\}/)[1].split(';').map(f=>f.split(/[?:]/)[0].trim()).filter(Boolean);
 assert.deepEqual(status.sort(),[...PHONE_HEALTH_FIELDS].sort(),'the panel reads exactly the declared fields');
 for(const [key,rule] of Object.entries(PHONE_HEALTH_SHAPE)){
  const declared=panel.match(new RegExp('type Status=\\{[^}]*\\b'+key+'(\\??):([^;}]*)'));
  assert.ok(declared,key+' is in the panel type');
  assert.equal(declared[1]==='',!!rule.required,key+(rule.required?' is required':' is optional')+' in the panel too');
  assert.ok(declared[2].includes(rule.type),key+' has the declared type in the panel');
  assert.equal(declared[2].includes('null'),!!rule.nullable,key+' nullability agrees');
 }
 assert.ok(server.includes('PHONE_HEALTH_STATUS')&&server.includes('PHONE_HEALTH_RENEW')&&!/'\/api\/phone-health/.test(server),'the server routes come from the declaration');
 // The checker itself refuses what drifts.
 for(const bad of [{},{available:'yes'},{available:true,address:5},{available:true,damaged:'x'},{available:true,extra:1},null,[]])assert.throws(()=>phoneHealthAnswer(bad),JSON.stringify(bad));
 // Every branch of the server, with exact keys and value types.
 const exact=(text,keys,what)=>{
  const answer=JSON.parse(text);
  assert.deepEqual(Object.keys(answer).sort(),[...keys].sort(),what+': exact keys');
  phoneHealthAnswer(answer);
  for(const [key,rule] of Object.entries(PHONE_HEALTH_SHAPE))if(key in answer)assert.ok(answer[key]===null&&rule.nullable||typeof answer[key]===rule.type,what+': '+key+' is a '+rule.type);
  return answer;
 };
 const root=serverRoot('godspeed-phone-protocol-'),service=await createService({root,port:0,webPort:0,token:SETUP_CODE}),computerRoot=serverRoot('godspeed-phone-protocol-computer-'),computer=await createService({root:computerRoot,port:0});
 t.after(async()=>{delete process.env.GODSPEED_WEB_ADDRESS;await service.close();await computer.close();fs.rmSync(root,{recursive:true,force:true});fs.rmSync(computerRoot,{recursive:true,force:true});});
 const web=await webDoor(service),state=service.store.state;
 exact((await request(computer.address.port,'/api/'+PHONE_HEALTH_STATUS)).text,['available'],'a computer');
 exact((await request(service.address.port,'/api/'+PHONE_HEALTH_STATUS)).text,['available'],'the local door of a server');
 const noHttps=exact((await web('/api/'+PHONE_HEALTH_STATUS)).text,['available','address'],'a server without an https address');
 assert.deepEqual([noHttps.available,noHttps.address],[true,null]);
 process.env.GODSPEED_WEB_ADDRESS='https://notes.example.test';
 const shown=exact((await web('/api/'+PHONE_HEALTH_STATUS)).text,['available','address'],'a server with an https address');
 assert.equal(shown.available,true);assert.match(shown.address,/^https:\/\/notes\.example\.test\/ingest\/[A-Za-z0-9_-]{43}$/);
 const renewed=exact((await web('/api/'+PHONE_HEALTH_RENEW,{method:'POST',body:{}})).text,['available','address'],'a renewal');
 assert.notEqual(renewed.address,shown.address);
 fs.rmSync(tokenFile(state),{force:true});fs.mkdirSync(tokenFile(state));
 const damaged=exact((await web('/api/'+PHONE_HEALTH_STATUS)).text,['available','address','damaged'],'a damaged token');
 assert.deepEqual([damaged.available,damaged.address,damaged.damaged],[true,null,true]);
});

test('the command line imports a folder of legacy uploads: godspeed health import FOLDER prints the result and fills the notebook',()=>{
 const root=tmp('godspeed-phone-cli-'),folder=tmp('godspeed-phone-cli-import-'),store=new Store(root);
 store.save('settings',{id:'installation',owner:'local',timezone:'Europe/Berlin'});
 fs.writeFileSync(path.join(folder,'old.jsonl'),JSON.stringify({received_at:'2026-11-04T09:00:00Z',data:upload([metric('step_count','count',[D+' 08:00:00 +0100',321])])})+'\n');
 const run=args=>spawnSync(process.execPath,[fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url)),...args],{encoding:'utf8',env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_NOW:'2026-11-05T08:00:00Z'}});
 const done=run(['health','import',folder]);
 assert.equal(done.status,0,done.stderr);
 const result=JSON.parse(done.stdout);
 assert.equal(result.lines,1);assert.ok(result.written>=1);
 assert.equal(days(new Store(root))[D+' steps'],321);
 assert.notEqual(run(['health','import']).status,0,'a missing folder is an error');
});

test('a day of raw uploads is kept for 30 UTC calendar days after receipt and removed one day later',()=>{
 const store=setup(),received=at('2026-10-01T12:00:00Z');
 acceptUpload(store,upload([metric('step_count','count',['2026-10-01 08:00:00 +0000',10])]),{now:received});
 const files=()=>fs.readdirSync(rawFolder(store.state));
 assert.equal(files().length,1);
 assert.equal(pruneRaw(store.state,at('2026-10-31T23:59:59Z')),0,'day 30 after receipt: still kept');
 assert.equal(files().length,1);
 assert.equal(pruneRaw(store.state,at('2026-11-01T00:00:00Z')),1,'day 31 after receipt: removed');
 assert.equal(files().length,0);
});

test('equal metric and date points from two sources are both counted in a summed metric',()=>{
 const point=(qty,source)=>({date:D+' 08:00:00 +0100',qty,source});
 const built=buildDays([{received_at:'2026-11-04T09:00:00Z',data:upload([{name:'step_count',units:'count',data:[point(100,'Fictional Phone'),point(200,'Fictional Watch')]}])}]);
 assert.equal(built.get(D).get('steps'),300);
 const again=buildDays([{received_at:'2026-11-04T09:00:00Z',data:upload([{name:'step_count',units:'count',data:[point(100,'Fictional Phone'),point(200,'Fictional Watch')]}])},{received_at:'2026-11-04T10:00:00Z',data:upload([{name:'step_count',units:'count',data:[point(100,'Fictional Phone')]}])}]);
 assert.equal(again.get(D).get('steps'),300,'a re-sent point of one source still counts once');
});

test('an import whose records cannot be written keeps none of its raw lines, and leaves the lines it found alone',()=>{
 const store=setup(),folder=tmp('godspeed-phone-import-fail-'),line=(received_at,qty)=>({received_at,data:upload([metric('step_count','count',[D+' 08:00:00 +0100',qty])])});
 acceptUpload(store,line('2026-11-04T08:00:00Z',1).data,{now:at('2026-11-04T08:00:00Z')});
 const files=()=>Object.fromEntries(fs.readdirSync(rawFolder(store.state)).map(f=>[f,fs.readFileSync(path.join(rawFolder(store.state),f),'utf8')]));
 const before=files();
 fs.writeFileSync(path.join(folder,'old.jsonl'),[line('2026-11-04T09:00:00Z',2),line('2026-11-05T09:00:00Z',3)].map(l=>JSON.stringify(l)).join('\n')+'\n');
 const commit=store.commit;store.commit=()=>{throw new Error('disk full');};
 try{assert.throws(()=>importFolder(store,folder,{now:at('2026-11-05T10:00:00Z')}),/disk full/);}finally{store.commit=commit;}
 assert.deepEqual(files(),before,'the raw folder is exactly as it was');
 assert.equal(importFolder(store,folder,{now:at('2026-11-05T10:00:00Z')}).lines,2,'the same folder imports once the failure is gone');
});

test('an address renewed while its upload is still arriving stores nothing',async t=>{
 const root=serverRoot('godspeed-phone-inflight-'),service=await createService({root,port:0,webPort:0});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const token=fs.readFileSync(tokenFile(service.store.state),'utf8').trim(),body=JSON.stringify({data:upload([metric('step_count','count',[D+' 08:00:00 +0100',123])])}),half=Math.floor(body.length/2);
 const outcome=new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:service.address.port,path:'/ingest/'+token,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',reject);
  req.write(body.slice(0,half));
  setTimeout(()=>{renewToken(service.store.state);req.end(body.slice(half));},200);
 });
 assert.equal(await outcome,404);
 assert.deepEqual(days(service.store),{});
 assert.equal(fs.existsSync(rawFolder(service.store.state)),false,'nothing was kept in the raw files either');
});

test('starting the service removes raw uploads that are past their 30 days, before any upload arrives',async t=>{
 const root=serverRoot('godspeed-phone-startup-'),state=new Store(root).state,folder=rawFolder(state);
 fs.mkdirSync(folder,{recursive:true});
 const old=path.join(folder,'2020-01-01.jsonl'),recent=path.join(folder,new Date().toISOString().slice(0,10)+'.jsonl');
 for(const file of [old,recent])fs.writeFileSync(file,JSON.stringify({received_at:'2020-01-01T10:00:00Z',data:upload([])})+'\n');
 const service=await createService({root,port:0,webPort:0});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 assert.equal(fs.existsSync(old),false,'the expired file is gone at startup');
 assert.equal(fs.existsSync(recent),true,'a current file stays');
});

test('a stored raw line parses back to exactly what was written, a legacy receiver line loses its sender, and anything unreadable is null',()=>{
 const stored={received_at:'2026-11-04T09:00:00Z',data:upload([metric('step_count','count',[D+' 08:00:00 +0100',100])])};
 assert.deepEqual(parseRawLine(encodeRawLine(stored)),stored);
 assert.deepEqual(parseRawLine(encodeRawLine({...stored,remote:'203.0.113.9',extra:1})),stored,'only the two fields are stored');
 assert.deepEqual(parseRawLine(JSON.stringify({...stored,remote:'203.0.113.9'})),stored,'a legacy line keeps no sender');
 for(const bad of ['not json','null','[]',JSON.stringify({data:{}}),JSON.stringify({received_at:'yesterday',data:{}}),JSON.stringify({received_at:stored.received_at}),JSON.stringify({received_at:stored.received_at,data:[]}),JSON.stringify({received_at:stored.received_at,data:'x'})])assert.equal(parseRawLine(bad),null,bad);
 const store=setup();acceptUpload(store,stored.data,{now:at(stored.received_at)});
 assert.deepEqual(readRaw(store.state,'0000-00-00'),[{...stored,received_at:'2026-11-04T09:00:00.000Z'}],'what the receiver wrote is what the reader returns');
});

// ---- the arithmetic and the choices of buildDays, each pinned by a value that a nearby constant would change
const build=(...uploads)=>buildDays(uploads.map((data,i)=>({received_at:'2026-11-04T0'+(i+1)+':00:00Z',data})));
const workout=(name,minutes,km,extra={})=>({name,start:D+' 07:00:00 +0100',duration:minutes*60,distance:{qty:km,units:'km'},...extra});

test('a run at exactly 9 minutes per kilometre is a walk, a faster one is a run, and the numbers are kept to two decimals',()=>{
 const day=(...w)=>build(upload([],w)).get(D);
 const fast=day(workout('Running',40,5));assert.equal(fast.get('run_km'),5);assert.equal(fast.get('run_min'),40);assert.equal(fast.has('walk_km'),false);
 const edge=day(workout('Running',45,5));assert.equal(edge.get('walk_km'),5);assert.equal(edge.get('walk_min'),45);assert.equal(edge.has('run_km'),false);
 const slow=day(workout('Running',50,5));assert.equal(slow.get('walk_km'),5);
 const nodistance=day(workout('Running',30,0));assert.equal(nodistance.get('run_min'),30,'no distance is a run, never a walk');
 assert.equal(build(upload([metric('walking_running_distance','km',[D+' 08:00:00 +0100',1.2345])])).get(D).get('distance_km'),1.23);
});

test('workout durations count in minutes whatever unit they come in, and metres count as kilometres',()=>{
 const minutes=duration=>build(upload([],[{name:'Yoga',start:D+' 07:00:00 +0100',duration}])).get(D).get('workout_min');
 assert.equal(minutes(1800),30,'a plain number is seconds');
 assert.equal(minutes({qty:1800,units:'sec'}),30);
 assert.equal(minutes({qty:90,units:'min'}),90);
 assert.equal(minutes({qty:1.5,units:'hr'}),90);
 assert.equal(minutes({qty:45}),45,'no unit is minutes');
 assert.equal(build(upload([],[{name:'Running',start:D+' 07:00:00 +0100',duration:2400,distance:{qty:5000,units:'m'}}])).get(D).get('run_km'),5);
 const types=build(upload([],[workout('Yoga',30,0),workout('Swim',20,1,{start:D+' 09:00:00 +0100'}),workout('Yoga',10,0,{start:D+' 10:00:00 +0100'})])).get(D);
 assert.equal(types.get('workout_types'),'Yoga+Swim');assert.equal(types.get('workout_min'),60);
});

test('of two sources at one instant the later upload wins, and uploads read from the files come back in the order they were received',()=>{
 const at1=(qty,source)=>upload([{name:'weight_body_mass',units:'kg',data:[{date:D+' 08:00:00 +0100',qty,source}]}]);
 assert.equal(buildDays([{received_at:'2026-11-04T09:00:00Z',data:at1(70,'Fictional scale')},{received_at:'2026-11-04T10:00:00Z',data:at1(72,'Fictional watch')}]).get(D).get('weight_kg'),72);
 const store=setup(),folder=rawFolder(store.state);fs.mkdirSync(folder,{recursive:true});
 const line=(received_at,qty)=>JSON.stringify({received_at,data:at1(qty,'Fictional scale')});
 fs.writeFileSync(path.join(folder,D+'.jsonl'),[line('2026-11-04T12:00:00Z',3),line('2026-11-04T09:00:00Z',1),line('2026-11-04T09:00:00Z',2)].join('\n')+'\n');
 assert.deepEqual(readRaw(store.state,'0000-00-00').map(l=>l.data.metrics[0].data[0].qty),[1,2,3],'by receive time, and file order within one instant');
});

test('a removed day record is written again, and the boundary of the days whose raw files may be gone is the 29th day back',()=>{
 const store=setup(),now=at('2026-11-30T12:00:00Z');
 const record=(day,value)=>store.save('health_observations',{id:phoneFeedId(SOURCE,day,'steps'),metric:'steps',value,source:SOURCE,observed_on:day,date_precision:'day',observed_at:day+'T00:00:00.000Z'});
 const send=(day,qty)=>acceptUpload(store,upload([metric('step_count','count',[day+' 08:00:00 +0100',qty])]),{now});
 // 2026-11-01 is the oldest day whose raw files still exist; 2026-10-31 may already have lost some.
 record('2026-11-01',1);record('2026-10-31',1);
 assert.equal(send('2026-11-01',10).written,1,'the oldest covered day is rebuilt');
 assert.equal(send('2026-10-31',10).written,0,'the day before it keeps what it has');
 const stored=day=>store.get('health_observations',phoneFeedId(SOURCE,day,'steps')).value;
 assert.deepEqual([stored('2026-11-01'),stored('2026-10-31')],[10,1]);
 {const id=phoneFeedId(SOURCE,'2026-11-01','steps');store.commit([store.prepare('health_observations',{removed_at:new Date().toISOString()},store.get('health_observations',id))]);}
 assert.equal(send('2026-11-01',10).written,1,'a removed record with the same value is written again');
 assert.ok(store.list('health_observations').some(r=>r.id===phoneFeedId(SOURCE,'2026-11-01','steps')),'and it is no longer removed');
 assert.equal(send('2026-11-01',10).written,0,'and then left alone');
});

test('an upload that changes nothing commits nothing, and an upload leaves the other days that the raw files hold alone',()=>{
 const store=setup(),now=at('2026-11-04T12:00:00Z'),A='2026-11-04',B='2026-11-03';
 acceptUpload(store,upload([metric('step_count','count',[A+' 08:00:00 +0100',5])]),{now});
 const commit=store.commit;store.commit=()=>{throw new Error('nothing should be committed');};
 try{assert.equal(acceptUpload(store,upload([metric('step_count','count',[A+' 08:00:00 +0100',5])]),{now}).written,0);}finally{store.commit=commit;}
 // The raw files hold a point for another day B; the person's own value for B must not be rebuilt by an upload about A.
 appendRaw(store.state,{received_at:'2026-11-03T20:00:00.000Z',data:upload([metric('step_count','count',[B+' 08:00:00 +0100',3])])});
 store.save('health_observations',{id:phoneFeedId(SOURCE,B,'steps'),metric:'steps',value:9,source:SOURCE,observed_on:B,date_precision:'day',observed_at:B+'T00:00:00.000Z'});
 acceptUpload(store,upload([metric('step_count','count',[A+' 09:00:00 +0100',1])]),{now});
 assert.equal(store.get('health_observations',phoneFeedId(SOURCE,B,'steps')).value,9);
});

test('every listed metric lands under its own name, and a structured sleep record keeps every part',()=>{
 const one=(name,units,qty)=>metric(name,units,[D+' 08:00:00 +0100',qty]);
 const got=build(upload([one('step_count','count',10),one('walking_running_distance','km',2),one('active_energy','kcal',300),one('basal_energy_burned','kcal',1500),one('dietary_energy','kcal',2000),one('protein','g',90),one('carbohydrates','g',200),one('total_fat','g',70),one('flights_climbed','count',4),
  one('weight_body_mass','kg',80),one('body_fat_percentage','%',20),one('lean_body_mass','kg',64),one('waist_circumference','cm',90)])).get(D);
 assert.deepEqual(Object.fromEntries(got),{steps:10,distance_km:2,active_kcal:300,basal_kcal:1500,food_kcal:2000,protein_g:90,carbs_g:200,fat_g:70,flights:4,weight_kg:80,body_fat_pct:20,lean_kg:64,waist_cm:90});
 const sleep=build(upload([metric('sleep_analysis','hr',[D+' 06:00:00 +0100',null,{totalSleep:7.5,inBed:8,deep:1.5,rem:2,sleepStart:D+' 23:10:00 +0100',sleepEnd:D+' 06:40:00 +0100'}])])).get(D);
 assert.deepEqual(Object.fromEntries(sleep),{sleep_in_bed_h:8,sleep_total_h:7.5,sleep_deep_h:1.5,sleep_rem_h:2,sleep_start:'23:10',sleep_end:'06:40'});
 const plain=build(upload([metric('sleep_analysis','hr',[D+' 06:00:00 +0100',6],[D+' 07:00:00 +0100',7.5])])).get(D);
 assert.deepEqual(Object.fromEntries(plain),{sleep_total_h:7.5});
 const longest=build(upload([metric('sleep_analysis','hr',[D+' 06:00:00 +0100',null,{totalSleep:7,sleepStart:'x',sleepEnd:'y'}],[D+' 07:00:00 +0100',null,{totalSleep:5,deep:9}])])).get(D);
 assert.deepEqual(Object.fromEntries(longest),{sleep_total_h:7},'the longest record wins whole, and a time that is not hh:mm is left out');
});

test('what is not a Health Auto Export upload is refused with 400 and kept nowhere, and a renewal needs POST',async t=>{
 const root=serverRoot('godspeed-phone-shape-'),service=await createService({root,port:0,webPort:0,token:SETUP_CODE});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const port=service.address.port,token=fs.readFileSync(tokenFile(service.store.state),'utf8').trim();
 for(const raw of ['{}','null','[]','{"data":[]}','{"data":"x"}','{"data":null}','{"data":{"metrics":"x"}}','{"data":{"metrics":{}}}','{"data":{"workouts":{}}}'])
  assert.equal((await request(port,'/ingest/'+token,{method:'POST',raw})).status,400,raw);
 assert.equal(fs.existsSync(rawFolder(service.store.state)),false);
 assert.equal((await request(port,'/ingest/health',{method:'POST',body:{data:{}}})).status,404,'the status word is not a token');
 process.env.GODSPEED_WEB_ADDRESS='https://notes.example.test';
 assert.equal((await (await webDoor(service))('/api/phone-health/renew')).status,405);
 delete process.env.GODSPEED_WEB_ADDRESS;
 assert.equal((await request(port,'/ingest/'+token,{method:'POST',body:{data:{metrics:[],workouts:[]}}})).status,200,'an upload with nothing in it is still an upload');
});

test('a startup cleanup that fails is logged without the service stopping',async t=>{
 const root=serverRoot('godspeed-phone-prunefail-'),state=new Store(root).state,logged=[],original=console.error;
 fs.mkdirSync(state,{recursive:true});fs.writeFileSync(rawFolder(state),'not a folder');
 console.error=(...args)=>logged.push(args.join(' '));
 let service;try{service=await createService({root,port:0,webPort:0});}finally{console.error=original;}
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 assert.ok(logged.some(line=>line.includes('expired phone health uploads could not be removed')),logged.join('|'));
 assert.equal((await request(service.address.port,'/ingest/health')).status,200);
});

test('a point with no usable number makes no summed metric, a tie in sleep goes to the later upload, and an import keeps only lines inside the 30 days',()=>{
 for(const qty of [null,'x',' ',''])assert.equal(build(upload([metric('step_count','count',[D+' 08:00:00 +0100',qty])])).has(D),false,JSON.stringify(qty));
 const sleep=(total,source)=>upload([metric('sleep_analysis','hr',[D+' 06:00:00 +0100',null,{totalSleep:7,deep:total,source}])]);
 assert.equal(build(sleep(1,'Fictional ring'),sleep(2,'Fictional watch')).get(D).get('sleep_deep_h'),2);
 const store=setup(),folder=tmp('godspeed-phone-edge-import-'),now=at('2026-11-30T12:00:00Z');
 const line=received_at=>JSON.stringify({received_at,data:upload([metric('step_count','count',['2026-11-01 08:00:00 +0100',1])])});
 fs.writeFileSync(path.join(folder,'old.jsonl'),[line('2026-10-31T12:00:00Z'),line('2026-10-30T12:00:00Z')].join('\n')+'\n');
 importFolder(store,folder,{now});
 assert.deepEqual(fs.readdirSync(rawFolder(store.state)),['2026-10-31.jsonl'],'day 30 back is kept, day 31 back is not');
});

test('the raw uploads stay on this machine: a backup holds neither a metric nobody lists nor a raw upload file',()=>{
 const store=setup(),media=tmp('godspeed-phone-backup-media-'),destination=path.join(tmp('godspeed-phone-backup-'),'copy');
 const unlisted='987654.321';
 acceptUpload(store,upload([metric('step_count','count',[D+' 08:00:00 +0100',11]),metric('fictional_unlisted_metric','x',[D+' 08:00:00 +0100',Number(unlisted)])]),{now:at('2026-11-04T09:00:00Z')});
 const raw=fs.readdirSync(rawFolder(store.state));
 assert.equal(raw.length,1);assert.match(fs.readFileSync(path.join(rawFolder(store.state),raw[0]),'utf8'),/987654\.321/,'the raw file does hold it');
 assert.equal(days(store)[D+' steps'],11);
 backup(store,media,destination);
 const files=[];const walk=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,entry.name);if(entry.isDirectory())walk(full);else files.push(full);}};walk(destination);
 assert.ok(files.length>0);
 for(const file of files){assert.ok(!file.includes('health-uploads')&&!/\.jsonl$/.test(file)&&!path.basename(file).includes(raw[0]),file);assert.ok(!fs.readFileSync(file).includes(unlisted),'the unlisted value is in '+file);}
});

test('one shape decides what an upload may be: the receiver and the importer keep the same lines',()=>{
 for(const good of [{},{metrics:[]},{workouts:[]},{metrics:[],workouts:[]}])assert.equal(isUploadShape(good),true,JSON.stringify(good));
 for(const bad of [null,undefined,'x',5,[],{metrics:{}},{metrics:'x'},{workouts:{}},{metrics:null},{workouts:null}])assert.equal(isUploadShape(bad),false,JSON.stringify(bad));
 const store=setup(),folder=tmp('godspeed-phone-shape-import-'),line=(data,received_at='2026-11-04T10:00:00Z')=>JSON.stringify({received_at,data});
 fs.writeFileSync(path.join(folder,'old.jsonl'),[line({metrics:{}}),line({workouts:'x'}),line([]),line({metrics:[]}),'not json'].join('\n')+'\n');
 const result=importFolder(store,folder,{now:at('2026-11-05T08:00:00Z')});
 assert.deepEqual([result.lines,result.skipped],[5,4],'the malformed legacy lines are skipped and counted');
 const kept=fs.readdirSync(rawFolder(store.state)).flatMap(f=>fs.readFileSync(path.join(rawFolder(store.state),f),'utf8').trim().split('\n'));
 assert.deepEqual(kept.map(l=>JSON.parse(l).data),[{metrics:[]}],'only the well-formed one is retained');
 assert.equal(parseRawLine(line({metrics:{}})),null);
});

test('a damaged ingest token: the server still starts and answers the monitor, uploads get 404 and write nothing, and a renewal replaces it',async t=>{
 const cases=[['a folder in place of the file',state=>fs.mkdirSync(tokenFile(state),{recursive:true})],['an empty file',state=>fs.writeFileSync(tokenFile(state),'',{mode:0o600})]];
 if(process.platform!=='win32')cases.push(['a file other users can read',state=>{fs.writeFileSync(tokenFile(state),'madeUpTokenLongEnoughToLookReal');fs.chmodSync(tokenFile(state),0o644);}]);
 process.env.GODSPEED_WEB_ADDRESS='https://notes.example.test';
 t.after(()=>{delete process.env.GODSPEED_WEB_ADDRESS;});
 for(const [what,damage] of cases){
  const root=serverRoot('godspeed-phone-damaged-'),state=new Store(root).state;fs.mkdirSync(state,{recursive:true});damage(state);
  const service=await createService({root,port:0,webPort:0,token:SETUP_CODE});
  try{
   const port=service.address.port,web=await webDoor(service);
   assert.equal((await request(port,'/ingest/health')).status,200,what+': the monitor answers');
   assert.equal((await request(port,'/ingest/madeUpTokenLongEnoughToLookReal',{method:'POST',body:{data:{}}})).status,404,what+': no upload');
   assert.equal(fs.existsSync(rawFolder(state)),false,what+': nothing written');
   assert.deepEqual(JSON.parse((await web('/api/phone-health')).text),{available:true,address:null,damaged:true},what);
   const renewed=JSON.parse((await web('/api/phone-health/renew',{method:'POST',body:{}})).text);
   assert.match(renewed.address,/^https:\/\/notes\.example\.test\/ingest\/[A-Za-z0-9_-]{43}$/,what);
   assert.equal((await request(port,new URL(renewed.address).pathname,{method:'POST',body:{data:upload([metric('step_count','count',[D+' 08:00:00 +0100',5])])}})).status,200,what+': the new address works');
   assert.deepEqual(JSON.parse((await web('/api/phone-health')).text).damaged,undefined);
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
 }
});

test('the token is read in one place: ensureToken leaves a damaged token alone, and only a private regular file authenticates',()=>{
 const store=setup(),state=store.state;
 assert.deepEqual(tokenState(state),{token:null,damaged:false});
 const token=ensureToken(state);assert.equal(tokenState(state).token,token);assert.equal(tokenMatches(state,token),true);
 if(process.platform!=='win32'){
  fs.chmodSync(tokenFile(state),0o644);
  assert.deepEqual(tokenState(state),{token:null,damaged:true});assert.equal(tokenMatches(state,token),false,'a readable-by-others token authenticates nothing');
  assert.equal(ensureToken(state),null);assert.equal(fs.statSync(tokenFile(state)).mode&0o777,0o644,'it is not rewritten behind the owner');
 }
 const next=renewToken(state);assert.notEqual(next,token);assert.equal(tokenMatches(state,next),true);assert.equal(tokenDamaged(state),false);
});

// Writes a chunk; when the socket is full, waits for room or for the socket to close, whichever comes first. A closed
// socket never drains, so a drain-only wait would never end when the peer answers and closes while this is waiting.
const writeOrClose=(socket,chunk)=>socket.write(chunk)?Promise.resolve():new Promise(resolve=>{
 // One handler for both events, and neither listener outlives the wait.
 const done=()=>{socket.off('drain',done);socket.off('close',done);resolve();};
 socket.on('drain',done);socket.on('close',done);
});
// true when the promise settles within ms, false when the time is up first; the timer never outlives the call.
const within=async(promise,ms)=>{let timer;try{return await Promise.race([promise.then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),ms);})]);}finally{clearTimeout(timer);}};

test('a write that backpressures and then sees the socket close without draining ends the wait',async()=>{
 const fake=new EventEmitter();fake.write=()=>false;
 setImmediate(()=>fake.emit('close'));
 assert.equal(await within(writeOrClose(fake,Buffer.alloc(1)),2000),true,'close ends the wait');
 const roomy=new EventEmitter();roomy.write=()=>true;
 assert.equal(await within(writeOrClose(roomy,Buffer.alloc(1)),2000),true,'no wait when there is room');
 const slow=new EventEmitter();slow.write=()=>false;
 setImmediate(()=>slow.emit('drain'));
 assert.equal(await within(writeOrClose(slow,Buffer.alloc(1)),2000),true,'drain still ends it');
 // Repeated waits leave no listener behind, whichever event ended them.
 const again=new EventEmitter();again.write=()=>false;
 for(let i=0;i<5;i++){setImmediate(()=>again.emit('drain'));assert.equal(await within(writeOrClose(again,Buffer.alloc(1)),2000),true);}
 assert.deepEqual([again.listenerCount('drain'),again.listenerCount('close')],[0,0],'no listener left after five drains');
 setImmediate(()=>again.emit('close'));
 assert.equal(await within(writeOrClose(again,Buffer.alloc(1)),2000),true);
 assert.deepEqual([again.listenerCount('drain'),again.listenerCount('close')],[0,0],'none left after a close either');
 assert.deepEqual([fake.listenerCount('drain'),fake.listenerCount('close')],[0,0]);
});

test('against a real local peer that stops reading and then closes, a writer that fills its buffer is not left waiting',async t=>{
 const peer=net.createServer(socket=>{socket.pause();setTimeout(()=>socket.destroy(),150);});
 await new Promise(r=>peer.listen(0,'127.0.0.1',r));
 const client=net.connect(peer.address().port,'127.0.0.1');
 client.on('error',()=>{});
 t.after(()=>{client.destroy();peer.close();});
 await new Promise(r=>client.once('connect',r));
 const chunk=Buffer.alloc(256*1024,'x');
 const writer=(async()=>{let blocked=false;for(let i=0;i<4000&&!client.destroyed;i++){const wait=writeOrClose(client,chunk);if(client.writableNeedDrain)blocked=true;await wait;}return blocked;})();
 let blocked;
 assert.equal(await within(writer.then(b=>{blocked=b;}),8000),true,'the writer finished: the close ended its wait');
 assert.equal(blocked,true,'it really did backpressure first');
});

test('an oversized upload whose body never ends gets a real 413 with Connection: close, the peer is closed, and the service shuts down',async t=>{
 const root=serverRoot('godspeed-phone-oversize-'),service=await createService({root,port:0,webPort:0});
 const token=fs.readFileSync(tokenFile(service.store.state),'utf8').trim(),socket=net.connect(service.address.port,'127.0.0.1');
 let received='',closed=false,closedService=false;
 socket.on('data',chunk=>{received+=chunk.toString('latin1');});socket.on('close',()=>{closed=true;});socket.on('error',()=>{});
 const until=async(condition,what,ms=15000)=>{const end=Date.now()+ms;while(!condition()){if(Date.now()>end)throw new Error('timed out waiting for '+what);await new Promise(r=>setTimeout(r,20));}};
 try{
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  // Valid headers that promise more than the limit, then a little over the limit, and never the rest.
  socket.write('POST /ingest/'+token+' HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: '+(40*1024*1024)+'\r\n\r\n');
  const chunk=Buffer.alloc(64*1024,'x');
  let sent=0;
  while(!received.includes('\r\n\r\n')&&sent<22*1024*1024&&!closed){
   await writeOrClose(socket,chunk);
   sent+=chunk.length;
  }
  await until(()=>received.includes('\r\n\r\n'),'the answer to the oversized upload');
  const [head]=received.split('\r\n\r\n');
  assert.match(head,/^HTTP\/1\.1 413 /,'a real 413 answer, not a reset');
  assert.match(head,/^connection: close$/mi,'the answer says the connection ends');
  await until(()=>/"error":"Too large"/.test(received),'the answer body');
  assert.ok(sent>=20*1024*1024&&sent<40*1024*1024,'it answered after the limit and before the body was complete');
  await until(()=>closed,'the server to close its side');
  assert.equal(service.store.list('health_observations').length,0);
  assert.equal(fs.existsSync(rawFolder(service.store.state)),false,'nothing was kept');
  const stopped=await within(service.close(),5000);
  closedService=stopped;
  assert.equal(stopped,true,'the service shuts down: no connection is left open');
 }finally{
  socket.destroy();
  if(!closedService)await within(service.close().catch(()=>{}),3000);
  fs.rmSync(root,{recursive:true,force:true});
 }
});
