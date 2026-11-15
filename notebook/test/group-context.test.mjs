import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

// A group briefing sent every person and the whole text of every note; on
// the real notebook (1,372 notes) the model refused it with HTTP 400.
test('a group briefing is given its members, their topics and the notes that name them, within a budget',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-group-ctx-'))),query=new QueryService(store),domains=new Domains(query);
  const group=store.save('contact_groups',{name:'Fictional climbing circle',stages:[{id:'new',label:'New'}]});
  const ana=store.save('contacts',{name:'Fictional Ana'}),out=store.save('contacts',{name:'Fictional Outsider'});
  store.save('contact_group_memberships',{group_id:group.id,contact_id:ana.id,status:'new'});
  store.save('contact_topics',{title:'Ask about the bouldering trip',contact_id:ana.id,status:'active'});
  store.save('notes',{title:'Bouldering',content:'Fictional Ana climbed the red route. '+'x'.repeat(5000)});
  for(let i=0;i<300;i++)store.save('notes',{title:'Unrelated '+i,content:'filler '.repeat(2000)});
  let sent;domains.provider=async input=>{sent=input;return {briefing_markdown:'Ana is progressing.'};};
  const saved=await domains.invoke('generate-group-briefing',{group_id:group.id});
  assert.equal(saved.briefing_markdown,'Ana is progressing.');
  const size=JSON.stringify(sent).length;assert.ok(size<120000,'sent '+size+' characters');
  assert.deepEqual(sent.people.map(p=>p.name),['Fictional Ana']);
  assert.deepEqual(sent.notes.map(n=>n.title),['Bouldering']);assert.ok(sent.notes[0].text.length<=1501);
  assert.deepEqual(sent.topics.map(t=>t.title),['Ask about the bouldering trip']);
  assert.ok(!JSON.stringify(sent).includes('Fictional Outsider'),'people outside the group are not sent for a briefing');
});
