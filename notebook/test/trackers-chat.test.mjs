import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {chatContext} from '../core/chat-context.mjs';

// The chat's model must see every tracker and every open question to name them,
// and the answer is the server's computed line, not the model's guess (D-321).
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-track-chat-'))),query=new QueryService(store),domains=new Domains(query);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});return {store,query,domains};};

test('the chat is given the trackers and the open question, and the reply is the computed one',async()=>{
  const {query,domains}=fixture();
  domains.provider=async()=>({reply:'Sure thing!',operations:[{type:'tracker-hold',name:'Belly',unit:'cm',value:92,source_quote:'track belly 92'}]});
  const r=await domains.invoke('conversation-chat',{message:'track belly 92',conversation_id:'c1'});
  assert.match(r.reply,/^Start a new tracker called Belly/);
  const context=chatContext(query,{message:'yes',conversation_id:'c1'});
  assert.equal(context.personal.tracker_questions.length,1);assert.equal(context.personal.tracker_questions[0].name,'Belly');
  assert.ok(context.personal.tracker_questions[0].id);
  assert.deepEqual(context.personal.trackers,[]);
  // The question is what the conversation shows, so the "yes" that follows has it in view.
  assert.equal(context.messages.at(-1).content,r.reply);
});

test('after the yes the chat sees the tracker without its entries, and a mixed request keeps the model\'s other words',async()=>{
  const {store,query,domains}=fixture();
  domains.provider=async()=>({reply:'ok',operations:[{type:'tracker-hold',name:'Belly',unit:'cm',value:92,talk:'health',source_quote:'track belly 92'}]});
  await domains.invoke('conversation-chat',{message:'track belly 92',conversation_id:'c1'});
  const [p]=store.list('tracker_proposals');
  domains.provider=async()=>({reply:'ok',operations:[{type:'tracker-create',proposal_id:p.id,source_quote:'yes'}]});
  await domains.invoke('conversation-chat',{message:'yes',conversation_id:'c1'});
  const context=chatContext(query,{message:'track belly 91',conversation_id:'c1'});
  assert.equal(context.personal.trackers.length,1);assert.equal(context.personal.trackers[0].name,'Belly');assert.equal(context.personal.trackers[0].recent,undefined);
  assert.deepEqual(context.personal.tracker_questions,[]);
  const id=context.personal.trackers[0].id;
  domains.provider=async()=>({reply:'I will remind you about the doctor.',operations:[
    {type:'track',tracker:id,value:91,source_quote:'track belly 91 and remind me to call the doctor on 2099-01-01T09:00:00Z'},
    {type:'obligation-add',title:'Call the doctor',due_at:'2099-01-01T09:00:00Z',source_quote:'track belly 91 and remind me to call the doctor on 2099-01-01T09:00:00Z'}]});
  const r=await domains.invoke('conversation-chat',{message:'track belly 91 and remind me to call the doctor on 2099-01-01T09:00:00Z',conversation_id:'c1'});
  assert.equal(r.reply,"Today's 92 cm is now 91 cm. I will remind you about the doctor.");
});
