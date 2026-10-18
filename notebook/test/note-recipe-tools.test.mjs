import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {toolScope} from '../core/api-keys.mjs';

test('the included note recipe discovers folders, finds visible sources, files once and edits with a retained revision',async()=>{
 const service=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-note-recipe-')),port:0});
 const base='http://127.0.0.1:'+service.address.port;
 const call=async(name,args={})=>{const response=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(response.status,200);const result=(await response.json()).result;assert.equal(result.isError,undefined,result.content[0].text);return JSON.parse(result.content[0].text);};
 try{
  service.store.save('notes',{title:'Fictional rain rule',content:'Stop watering when wet.',folder_path:'Home/Garden'});
  service.store.save('notes',{title:'Hidden rain rule',content:'Hidden.',folder_path:'Private',ai_visibility:'hidden'});
  const folders=await call('list_note_folders');assert.equal(folders.some(f=>f.folder_path==='Home/Garden'&&f.note_count===1),true);assert.equal(folders.some(f=>f.folder_path==='Private'),false);
  const matches=await call('search_notes',{query:'rain',source:'native'});assert.equal(matches.length,1);
  const {note}=await call('capture_note',{title:'Fictional inspection',folder_path:'Home/Garden',tags:['garden','inspection'],content:'Inspect tomorrow.\nRelated: [[Fictional rain rule]]'});
  const saved=service.store.get('notes',note.id);assert.equal(saved.folder_path,'Home/Garden');assert.deepEqual(saved.tags,['garden','inspection']);assert.match(saved.content,/Related: \[\[Fictional rain rule\]\]/);
  const read=await call('get_note',{id:note.id});assert.equal(read._hash,saved._hash);
  await call('update_note',{id:note.id,expected_hash:read._hash,folder_path:'Work',title:'Fictional revised inspection'});
  assert.equal(service.store.get('notes',note.id).folder_path,'Work');assert.equal(service.store.list('notes').length,3);
  for(const name of ['list_note_folders','search_notes','get_note','update_note'])assert.equal(toolScope(name,{}),'notes');
 }finally{await service.close();}
});
