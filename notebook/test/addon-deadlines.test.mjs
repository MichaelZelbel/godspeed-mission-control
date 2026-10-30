import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {remind} from '../core/deadline-reminders.mjs';
import {addonDeadlines} from '../core/addon-deadlines.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// AN ADD-ON MAKES DEADLINES THAT GODSPEED REMINDS ABOUT (discussion #27, 23 October 2026). A
// documents add-on reads "pay by 20 November" in a letter and makes a deadline through the
// notebook's local door. It is an ordinary reminder, a page under notebook/Deadlines/ like every
// other since 30 October 2026 (#90), so the reminders, the morning brief and the deadline list read
// it. The add-on's key makes it once; once the person changed or closed it, the add-on can no longer
// change it. Everything here is made up.
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-addon-due-'))),query=new QueryService(store);store.save('settings',{id:'installation',timezone:'UTC'});return {store,query,domains:new Domains(query)};};
const dayFrom=n=>new Date(Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const bill=(over={})=>({addon:'an-addon',action:'create',key:'a1b2c3#1',title:'Pay the invented water bill',due:dayFrom(2),done_when:'Paid',cost:'A reminder fee',link:'http://127.0.0.1:8000/documents/7/details',...over});
// The page of one reminder, which is what a person opens and edits.
const pageOf=(store,slug)=>store.list('deadlines').find(r=>r.native_slug===slug);
const pageFile=(store,slug)=>store.file(pageOf(store,slug));

test('an add-on deadline is a page the reminders read',()=>{
 const {store,query}=fixture();
 const made=addonDeadlines(store,bill());
 assert.equal(made.created,true);
 assert.equal(made.deadline.key,'a1b2c3#1');assert.equal(made.deadline.due,dayFrom(2));assert.equal(made.deadline.state,'open');assert.equal(made.deadline.touched,false);
 assert.equal(made.deadline.link,'http://127.0.0.1:8000/documents/7/details');
 assert.match(fs.readFileSync(pageFile(store,made.deadline.slug),'utf8'),/^addon: an-addon$/m);
 const row=query.rows('deadlines').find(d=>d.native_slug===made.deadline.slug);
 assert.equal(row.title,'Pay the invented water bill');assert.equal(row.due_at,dayFrom(2)+'T23:59:59Z');
 const said=remind({},{store,query});
 assert.equal(said.silent,false);assert.match(store.get('notes',said.record_id).content,/Pay the invented water bill/);
});

test('create twice with one key makes one deadline',()=>{
 const {store}=fixture();
 const first=addonDeadlines(store,bill());
 const again=addonDeadlines(store,bill({title:'Something else',due:dayFrom(9)}));
 assert.equal(again.created,false);assert.equal(again.deadline.slug,first.deadline.slug);assert.equal(again.deadline.due,dayFrom(2));
 assert.equal(store.list('deadlines').filter(r=>r.native_slug).length,1);
 // Two requests of one letter with the same words get two deadlines under two names.
 const second=addonDeadlines(store,bill({key:'a1b2c3#2'}));
 assert.equal(second.created,true);assert.notEqual(second.deadline.slug,first.deadline.slug);
});

test('an add-on sees only its own deadlines',async()=>{
 const {store,domains}=fixture();
 addonDeadlines(store,bill());
 addonDeadlines(store,bill({addon:'other-addon',title:'Another add-on\'s invented deadline'}));
 await domains.invoke('personal-operation',{type:'due-command',args:['add','own-thing','--title','My own invented thing','--to',dayFrom(5),'--done-when','done','--cost','a fee']});
 const mine=addonDeadlines(store,{addon:'an-addon',action:'list'}).deadlines;
 assert.deepEqual(mine.map(d=>d.title),['Pay the invented water bill']);
 const theirs=addonDeadlines(store,{addon:'other-addon',action:'list'}).deadlines;
 assert.deepEqual(theirs.map(d=>d.key),['a1b2c3#1']);
 assert.equal(addonDeadlines(store,{addon:'an-addon',action:'update',key:'a1b2c3#1',due:dayFrom(4)}).updated,true);
 assert.equal(addonDeadlines(store,{addon:'other-addon',action:'list'}).deadlines[0].due,dayFrom(2),'the other add-on\'s deadline with the same key is not changed');
});

test('update moves an untouched one, and renames it',()=>{
 const {store}=fixture();
 addonDeadlines(store,bill());
 const moved=addonDeadlines(store,{addon:'an-addon',action:'update',key:'a1b2c3#1',due:dayFrom(6),title:'Pay the invented water bill of 40 EUR'});
 assert.equal(moved.updated,true);assert.equal(moved.deadline.due,dayFrom(6));assert.equal(moved.deadline.title,'Pay the invented water bill of 40 EUR');assert.equal(moved.deadline.touched,false);
 assert.throws(()=>addonDeadlines(store,{addon:'an-addon',action:'update',key:'nothing#9',due:dayFrom(6)}),/No deadline of this add-on has that key/);
});

test('an add-on deadline the person changed or closed is never changed by the add-on',async()=>{
 const {store,domains}=fixture(),run=args=>domains.invoke('personal-operation',{type:'due-command',args});
 const cases={
  'by-hand':d=>{const f=pageFile(store,d.slug);fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('deadline: '+d.due,'deadline: '+dayFrom(12)));},
  'closed':d=>run(['done',d.slug,'--evidence','paid it']),
  'dropped':d=>run(['drop',d.slug,'--yes']),
  'target':d=>run(['target',d.slug,dayFrom(3)]),
 };
 for(const [key,change] of Object.entries(cases)){
  const {deadline}=addonDeadlines(store,bill({key,title:'Invented deadline '+key,due:dayFrom(8)}));
  await change(deadline);
  const file=pageFile(store,deadline.slug),before=fs.readFileSync(file,'utf8');
  const out=addonDeadlines(store,{addon:'an-addon',action:'update',key,due:dayFrom(20)});
  assert.deepEqual([out.updated,out.touched],[false,true],key);
  assert.equal(fs.readFileSync(file,'utf8'),before,key+': the file is as the person left it');
  assert.equal(addonDeadlines(store,{addon:'an-addon',action:'list'}).deadlines.find(d=>d.key===key).touched,true,key);
 }
 const states=Object.fromEntries(addonDeadlines(store,{addon:'an-addon',action:'list'}).deadlines.map(d=>[d.key,d.state]));
 assert.equal(states.closed,'closed');assert.equal(states.dropped,'dropped');assert.equal(states['by-hand'],'open');
});

test('bad input is refused in plain words',()=>{
 const {store}=fixture();
 const refused=[[{addon:'An Addon'},/add-on's name/],[{action:'forget'},/list, create or update/],[{title:''},/Say what needs doing/],[{title:'two\nlines'},/one line/],
  [{due:'2026-02-30'},/real day/],[{due:'next week'},/real day/],[{key:'two words'},/key/],[{link:'javascript:alert(1)'},/http/],[{done_when:''},/what is true when it is done/],[{cost:''},/what it costs/],
  [{start:dayFrom(9)},/start.*before/i]];
 for(const [over,why] of refused)assert.throws(()=>addonDeadlines(store,bill(over)),why,JSON.stringify(over));
 assert.equal(fs.existsSync(path.join(store.root,'due'))?fs.readdirSync(path.join(store.root,'due')).length:0,0,'nothing was made');
});

test('the function is reached on the local door',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-addon-door-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const {createService}=await import('../server/main.mjs');
 const service=await createService({root,port:0});
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});delete process.env.GODSPEED_ASSISTANT_CONFIG;});
 const call=async body=>{const r=await fetch('http://127.0.0.1:'+service.address.port+'/api/functions/addon-deadlines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,json:await r.json()};};
 const made=await call(bill());
 assert.equal(made.status,200);assert.equal(made.json.data.created,true);
 const listed=await call({addon:'an-addon',action:'list'});
 assert.deepEqual(listed.json.data.deadlines.map(d=>[d.key,d.due]),[['a1b2c3#1',dayFrom(2)]]);
 const bad=await call(bill({due:'2026-02-30'}));
 assert.equal(bad.status,400);assert.match(bad.json.error,/real day/);
});
