import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';
import {SearchIndex} from '../core/index/search.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-mcp-versions-'));const store=new Store(root),query=new QueryService(store),domains=new Domains(query),index=new SearchIndex(store);t.after(()=>{index.close();fs.rmSync(root,{recursive:true,force:true});});return {store,query,domains,index};};
const call=async(env,name,args)=>{const r=await mcp({id:1,method:'tools/call',params:{name,arguments:args}},env);return {error:!!r.result.isError,text:r.result.content[0].text};};

test('update_note without a hash never overwrites an owner edit made after the assistant read the note',async t=>{
 const env=fixture(t),{store}=env,note=store.save('notes',{title:'Fictional plan',content:'v1 read by the assistant'});
 assert.equal((await call(env,'get_note',{id:note.id})).error,false);
 store.save('notes',{id:note.id,content:'v2 owner edit after the read'},store.get('notes',note.id)._hash);
 const stale=await call(env,'update_note',{id:note.id,content:'v1 plus an assistant addition'});
 assert.equal(stale.error,true);assert.match(stale.text,/changed/);
 assert.equal(store.get('notes',note.id).content,'v2 owner edit after the read');
 // Read again, then the same call goes through, and a second edit right after it too.
 await call(env,'get_note',{id:note.id});
 assert.equal((await call(env,'update_note',{note_id:note.id,content:'v2 plus an assistant addition'})).error,false);
 assert.equal((await call(env,'update_note',{note_id:note.id,title:'Fictional plan, revised'})).error,false);
 assert.equal(store.get('notes',note.id).content,'v2 plus an assistant addition');
 // A note this process never handed out keeps Menerio's behaviour: the current version is the one read.
 const other=store.save('notes',{title:'Fictional other',content:'never read here'});
 assert.equal((await call(env,'update_note',{note_id:other.id,content:'changed by a skill'})).error,false);
 // Found by search counts as read.
 const found=store.save('notes',{title:'Fictional zebrafinch',content:'zebrafinch sighting'});
 env.index.rebuild();
 assert.match((await call(env,'search_notes',{query:'zebrafinch'})).text,new RegExp(found.id));
 store.save('notes',{id:found.id,content:'zebrafinch sighting, owner corrected'},store.get('notes',found.id)._hash);
 assert.equal((await call(env,'update_note',{note_id:found.id,content:'zebrafinch sighting plus'})).error,true);
});

test('list_records leaves out hidden records before it counts the limit',async t=>{
 const env=fixture(t),{store}=env;
 for(let i=0;i<5;i++)store.save('notes',{id:'a-hidden-'+i,title:'Hidden '+i,content:'x',ai_visibility:'hidden'});
 for(let i=0;i<3;i++)store.save('notes',{id:'z-visible-'+i,title:'Visible '+i,content:'y'});
 const r=await call(env,'list_records',{type:'notes',limit:5});
 assert.deepEqual(JSON.parse(r.text).map(n=>n.title).sort(),['Visible 0','Visible 1','Visible 2']);
});
