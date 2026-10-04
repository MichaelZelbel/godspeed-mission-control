import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {chatContext} from '../core/chat-context.mjs';import {retrieveNoteWindows,noteWindows} from '../core/retrieval-windows.mjs';import {mcp} from '../server/mcp.mjs';import {toolScope} from '../core/api-keys.mjs';

const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-retrieval-window-'));return {root,store:new Store(root)};};
test('ten fictional source comparisons retain exact passages and broad fallback',()=>{
 const {root,store}=fixture(),query=new QueryService(store),rows=[],comparisons=[];
 const facts=['Rain sensor stops watering','Battery cabinet is blue','Workshop begins Thursday','Parcel code is autumn','Tea timer is seven minutes','Bicycle lock stays upstairs','Orchid needs filtered light','Draft review follows lunch','Backup disk lives downstairs','Robot turns left at gate'];
 for(let i=0;i<facts.length;i++){
  const note=store.save('notes',{title:'Fictional retained source '+i,content:'Unrelated opening. '.repeat(500)+'\n\nUser: '+facts[i]+'\nAssistant: Fictional commentary is not a user statement.\n\nUser: This is software acceptance only.'});
  rows.push({question:'What did I remember about '+facts[i].split(' ').slice(0,2).join(' ')+'?',note});
 }
 for(const {question,note} of rows){
  const result=retrieveNoteWindows(query,question),window=result.windows.find(w=>w.note_id===note.id);
  assert.ok(window,question);assert.equal(window.kind,'marked-user-turn');assert.ok(window.start>5000);
  assert.equal(window.content,note.content.slice(window.start,window.end));assert.equal(window.source_hash,store.get('notes',note.id)._hash);
  assert.ok(!window.content.includes('Assistant:'));assert.ok(result.broad.some(n=>n.note_id===note.id));
  const context=chatContext(query,{message:question});assert.ok(context.note_windows.some(w=>w.note_id===note.id));assert.ok(context.retrieval.window_search.broad.some(n=>n.note_id===note.id));
  comparisons.push({question,expected_note_id:note.id,narrow:window,broad:result.broad,source_bytes_verified:true,broad_fallback_retained:true});
 }
 fs.writeFileSync(path.join(root,'ten-query-comparison.json'),JSON.stringify({fictional_software_acceptance:true,at:new Date().toISOString(),comparisons},null,2),{flag:'wx'});
});
test('privacy and explicit note selection exclude unrelated and hidden passages',()=>{
 const {store}=fixture(),query=new QueryService(store);
 const note=store.save('notes',{title:'Visible orchid',content:'Orchid needs filtered light.'});
 for(const patch of [{ai_visibility:'hidden'},{is_sensitive:true},{is_trashed:true},{removed_at:new Date().toISOString()},{visibility_scope:'private'}])store.save('notes',{title:'Hidden orchid',content:'Orchid secret',...patch});
 const other=store.save('notes',{title:'Other orchid',content:'Orchid grows in the garden.'});
 const result=retrieveNoteWindows(query,'What orchid light?');assert.deepEqual(new Set(result.broad.map(r=>r.note_id)),new Set([note.id,other.id]));
 assert.ok(result.windows.every(w=>[note.id,other.id].includes(w.note_id)));
 const context=chatContext(query,{message:'What orchid?',note_id:note.id});assert.ok(context.note_windows.every(w=>w.note_id===note.id));
 assert.equal(noteWindows(note)[0].kind,'paragraph');
});
test('MCP, domains and empty narrow matches preserve truthful results',async()=>{
 const {store}=fixture(),query=new QueryService(store),domains=new Domains(query);const n=store.save('notes',{title:'Unique title cobalt',content:'No matching body phrase.'});
 const result=await domains.invoke('retrieve-memory',{query:'cobalt'});assert.equal(result.windows.length,0);assert.equal(result.broad[0].note_id,n.id);
 const rpc=await mcp({id:1,method:'tools/call',params:{name:'retrieve_memory',arguments:{query:'cobalt'}}},{store,query,domains});assert.equal(rpc.result.isError,undefined);assert.deepEqual(JSON.parse(rpc.result.content[0].text),result);assert.equal(toolScope('retrieve_memory',{}),'notes');
 assert.equal(retrieveNoteWindows(query,'the and what').broad.length,0);
});
