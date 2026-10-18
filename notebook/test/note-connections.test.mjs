import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {SearchIndex} from '../core/index/search.mjs';

// "Find connections" on one note compared every person with every note and
// filed a review item per name it found, one save at a time: on the real
// notebook the server stopped answering for minutes and 1,190 items were
// filed, and the panel could not read the answer (6 October 2026).
const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connections-'))),query=new QueryService(store),domains=new Domains(query);
  store.save('user_self_aliases',{alias:'Fictional Owner',is_active:true});
  const ana=store.save('contacts',{name:'Fictional Ana',aliases:['Ana F']}),ben=store.save('contacts',{name:'Fictional Ben'});
  const note=store.save('notes',{title:'Knee rehabilitation plan',content:'Fictional Owner talked with Fictional Ana about knee rehabilitation exercises and physiotherapy.'});
  const close=store.save('notes',{title:'Physiotherapy exercises for the knee',content:'Knee rehabilitation: physiotherapy exercises three times a week.'});
  store.save('notes',{title:'Groceries',content:'milk and bread'});
  for(let i=0;i<30;i++)store.save('notes',{title:'Fictional Ben note '+i,content:'Fictional Ben and Fictional Ana '+i});
  store.save('action_items',{content:'Book physiotherapy',source_note_id:note.id,status:'open'});
  return {store,query,domains,note,close,ana,ben};};

test('a note\'s connections are its related notes, the people it names and its actions, and nothing is filed',async()=>{
  for(const withIndex of [false,true]){
    const {store,domains,note,close,ana}=setup();let index=null;if(withIndex){index=new SearchIndex(store);domains.index=index;}
    try{
      const before=store.list('review_queue').length;
      const result=await domains.invoke('find-connections',{note_id:note.id});
      assert.equal(result.connections[0].id,close.id,'the physiotherapy note is the closest ('+(withIndex?'index':'no index')+')');
      assert.ok(result.connections.every(c=>c.similarity>0&&c.similarity<=1));
      assert.deepEqual(result.related_contacts.map(p=>p.id),[ana.id],'the person the note names, not the owner, not everyone');
      assert.deepEqual(result.related_actions.map(a=>a.content),['Book physiotherapy']);
      assert.equal(store.list('review_queue').length,before,'nothing filed');
      const links=await domains.invoke('suggest-connections',{note_id:note.id});
      assert.equal(links.suggestions[0].note_id,close.id);assert.match(links.suggestions[0].reason,/knee|physiotherapy|rehabilitation|exercises/);
    }finally{index?.close();}
  }
});
test('the daily card asks without a note and gets the newest note\'s connections',async()=>{
  const {domains}=setup();const result=await domains.invoke('find-connections',{mode:'daily'});
  assert.ok(Array.isArray(result.connections));assert.ok(result.note_id);
  assert.deepEqual(await domains.invoke('suggest-connections',{mode:'daily'}),{discoveries:[]});
});
