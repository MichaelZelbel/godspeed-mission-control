import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {remind} from '../core/goal-loop.mjs';
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-due-'))),query=new QueryService(store);return {store,query,domains:new Domains(query)};};
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
