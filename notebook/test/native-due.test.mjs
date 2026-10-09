import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {remind} from '../core/goal-loop.mjs';
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-due-'))),query=new QueryService(store);return {store,query,domains:new Domains(query)};};
test('installed obligation help and calendar bookkeeping share the canonical plan without calendar access',async()=>{
 const {store,domains}=fixture(),run=args=>domains.invoke('personal-operation',{type:'due-command',args});
 assert.match((await run(['help'])).result,/mc-due/);
 await run(['add','fictional-marker','--title','Fictional inspection','--from','2026-10-03','--target','2026-10-12','--to','2026-10-15','--done-when','Inspection recorded','--cost','Fictional missed inspection']);
 assert.match((await run(['marker','--needed'])).result,/fictional-marker\t2026-10-12\t2026-10-15/);
 await run(['marker','fictional-marker','--set','fictional-event-id']);
 assert.equal((await run(['marker','--needed'])).result,'');
 await run(['target','fictional-marker','2026-10-13']);
 assert.match((await run(['marker','--needed'])).result,/2026-10-13/);
 await run(['marker','fictional-marker','--set','fictional-new-event']);
 await run(['done','fictional-marker','--evidence','Fictional inspection recorded']);
 assert.match((await run(['marker','--stale'])).result,/fictional-new-event\t2026-10-13/);
 await run(['marker','fictional-marker','--clear']);
 assert.equal((await run(['marker','--stale'])).result,'');
 assert.equal(store.list('deadlines').length,0);
 await assert.rejects(run(['done','../../outside','--evidence','fictional']),/slug|inside/i);
 await assert.rejects(run(['marker','fictional-marker','--set','id\nTITLE: changed']),/single line/i);
});
test('original due files are canonical, recurring closures keep evidence and repeated reminder is quiet',async()=>{
 const {store,query,domains}=fixture(),today=new Date().toISOString().slice(0,10),command=message=>domains.invoke('conversation-chat',{message,conversation_id:'due-test',request_id:message});
 await command('/due add fictional --title "Fictional practice" --from '+today+' --to '+today+' --done-when "Practice recorded" --cost "Fictional missed practice" --repeats "every 7 days"');assert.equal(query.rows('deadlines').length,1);assert.equal(store.list('deadlines').length,0);
 assert.equal(remind({}, {store,query}).silent,false);assert.equal(remind({}, {store,query}).silent,true);
 const row=query.rows('deadlines')[0];await domains.invoke('personal-operation',{type:'obligation-complete',id:row.id,evidence:'Fictional diary records practice'});assert.ok(fs.readdirSync(path.join(store.root,'world/events')).length);assert.equal(query.rows('deadlines').length,1);assert.notEqual(query.rows('deadlines')[0].start_at,row.start_at);
 assert.throws(()=>query.execute({table:'deadlines',operation:'update',values:{status:'closed'},filters:[['eq','id',row.id]]}),/read-only/);
});
test('safe completion check rolls exactly once and does not reuse old proof for the next occurrence',async()=>{
 const {store,query,domains}=fixture(),note=store.save('notes',{title:'Fictional receipt',content:'Not ready'});
 const d=await domains.invoke('personal-operation',{type:'obligation-add',title:'Practice',start_at:'2020-01-01T00:00:00Z',due_at:'2020-01-02T00:00:00Z',recurrence:{days:7},completion_check:{type:'note-contains',note_id:note.id,text:'Practice complete'}});
 store.save('notes',{id:note.id,content:'Practice complete'});remind({}, {store,query});assert.equal(store.get('deadlines',d.id).status,'closed');assert.equal(store.list('deadlines').length,2);remind({}, {store,query});assert.equal(store.list('deadlines').length,2);
});
// 9 October 2026: an assistant wrote a deadline by hand (KIND:, TARGET-DATE:, no STRIP line) and the
// notebook showed it as closed. A due file the plan cannot be read from needs a look, by its file
// name, is said in the reminders, and is never rewritten.
test('a due file without readable dates needs a look and is never closed',()=>{
 const {store,query}=fixture(),file=path.join(store.root,'due','present.md');fs.mkdirSync(path.dirname(file),{recursive:true});
 const text='ID: present\nKIND: target (not costly deadline)\nTITLE: Fictional present, bought and wrapped\nTARGET-DATE: 2026-10-08\nSELF-CHECK: none\n';fs.writeFileSync(file,text);
 const [row]=query.rows('deadlines');
 assert.equal(row.status,'needs-a-look');assert.notEqual(row.status,'closed');
 assert.match(row.problem,/no STRIP line/);assert.equal(row.native_file,'due/present.md');
 assert.match(row.sentence,/^due\/present\.md \(Fictional present, bought and wrapped\): it has no STRIP line/);
 const reminded=remind({}, {store,query});assert.equal(reminded.silent,false);
 assert.match(store.get('notes',reminded.record_id).content,/due\/present\.md/);
 assert.equal(fs.readFileSync(file,'utf8'),text,'the hand-written file is left as it was');
});
