import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

const fixture=(t,provider)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-tags-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store);return {store,query,domains:new Domains(query,{provider})};};
const long='A long project log. '.repeat(2000);

// The prompt copy of a long note is cut, and it was cut before its tags: the
// model never saw them. Asked to add a tag, it answered with the one tag it
// knew of, and the merge read every real tag as removed. A 40,000-character
// note lost all its tags (7 October 2026).
test('adding a tag to a long note keeps the tags it had',async t=>{
  let shown;
  const {store,query,domains}=fixture(t,async request=>{if(request.kind!=='note-chat')return {terms:[]};shown=request.context.notes[0];return {reply:'Added the tag.',note_changes:{tags:[...(shown.tags||[]),'urgent']}};});
  const note=query.execute({table:'notes',operation:'insert',values:{title:'Project log',content:long,tags:['work','project-x']}}).data[0];
  await domains.invoke('note-chat',{note_id:note.id,message:'Add the tag urgent'});
  assert.ok(shown.context_truncated,'the model saw only the beginning');
  assert.deepEqual(shown.tags,['work','project-x'],'the model is shown the tags of a long note');
  assert.deepEqual(store.get('notes',note.id).tags,['work','project-x','urgent']);
});

// Whatever the model was not shown, it cannot take away: a tag list from a
// prompt that held no tags only adds.
test('a model that was shown no tags can only add tags',async t=>{
  const {store,query,domains}=fixture(t,async request=>{if(request.kind!=='note-chat')return {terms:[]};delete request.context.notes[0].tags;return {reply:'Tagged.',note_changes:{tags:['urgent']}};});
  const note=query.execute({table:'notes',operation:'insert',values:{title:'Project log',content:long,tags:['work','project-x']}}).data[0];
  await domains.invoke('note-chat',{note_id:note.id,message:'Add the tag urgent'});
  assert.deepEqual(store.get('notes',note.id).tags,['work','project-x','urgent']);
});

// A tag the model was shown and left out is removed, as asked.
test('a tag the model saw and dropped is removed',async t=>{
  const {store,query,domains}=fixture(t,async request=>{if(request.kind!=='note-chat')return {terms:[]};return {reply:'Removed it.',note_changes:{tags:request.context.notes[0].tags.filter(tag=>tag!=='project-x')}};});
  const note=query.execute({table:'notes',operation:'insert',values:{title:'Project log',content:long,tags:['work','project-x']}}).data[0];
  await domains.invoke('note-chat',{note_id:note.id,message:'Remove the tag project-x'});
  assert.deepEqual(store.get('notes',note.id).tags,['work']);
});
