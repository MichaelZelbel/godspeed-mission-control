import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createService} from '../server/main.mjs';import {toolScope} from '../core/api-keys.mjs';
test('the relationship topic recipe retains discussions, version conflicts, retries and exact undo through MCP',async()=>{
 const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-topic-recipe-')),port:0}),base='http://127.0.0.1:'+service.address.port;
 const call=async(name,args)=>{const response=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(response.status,200);return (await response.json()).result;};
 const value=async(name,args)=>{const r=await call(name,args);assert.equal(r.isError,undefined,r.content[0].text);return JSON.parse(r.content[0].text);};
 try{
  const person=service.store.save('contacts',{name:'Fictional garden reviewer'}),hidden=service.store.save('contacts',{name:'Hidden reviewer',ai_visibility:'hidden'});
  const request={contact_id:person.id,title:'Review the rain sensor',mode:'recurring',priority:'high',request_id:randomUUID()},created=await value('create_contact_topic',request);
  assert.equal((await value('create_contact_topic',request)).topic.id,created.topic.id);assert.equal(service.store.list('contact_topics').length,1);
  assert.equal((await value('list_contact_topics',{contact_id:person.id,status:'active'})).topics[0].id,created.topic.id);
  const discussed=await value('discuss_contact_topic',{topic_id:created.topic.id,expected_version:created.topic.version,request_id:randomUUID()});assert.equal(discussed.topic.status,'active');assert.ok(discussed.topic.last_discussed_at);
  const archived=await value('archive_contact_topic',{topic_id:created.topic.id,expected_version:discussed.topic.version,request_id:randomUUID()});assert.equal(archived.topic.status,'archived');
  const conflict=await call('update_contact_topic',{topic_id:created.topic.id,expected_version:created.topic.version,patch:{priority:'low'},request_id:randomUUID()});assert.equal(conflict.isError,true);
  const history=await value('get_contact_topic_history',{topic_id:created.topic.id,limit:1});assert.equal(history.events[0].id,archived.event_id);assert.ok(history.next_cursor);
  const undone=await value('undo_contact_topic_event',{topic_id:created.topic.id,event_id:archived.event_id,expected_version:archived.topic.version,request_id:randomUUID()});assert.equal(undone.topic.status,'active');assert.equal(undone.topic.last_discussed_at,discussed.topic.last_discussed_at);
  assert.equal((await call('create_contact_topic',{...request,contact_id:hidden.id,request_id:randomUUID()})).isError,true);
  assert.equal((await call('create_contact_topic',{...request,title:'x'.repeat(301),request_id:randomUUID()})).isError,true);
  assert.equal((await call('discuss_contact_topic',{topic_id:created.topic.id,expected_version:undone.topic.version,discussed_at:new Date(Date.now()+86400000).toISOString(),request_id:randomUUID()})).isError,true);
  for(const name of ['list_contact_topics','get_contact_topic_history','create_contact_topic','update_contact_topic','discuss_contact_topic','archive_contact_topic','reopen_contact_topic','undo_contact_topic_event'])assert.equal(toolScope(name,{}),'contacts');
 }finally{await service.close();}
});
