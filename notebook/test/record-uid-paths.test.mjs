import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {mcp} from '../server/mcp.mjs';

// A record's earlier versions are kept under a name made from its uid. Until
// 7 October 2026 the uid was taken as the caller gave it, so a uid with "../"
// in it put that copy in rules/ or profile/, outside the notebook, where every
// machine syncs it and every session reads it.
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-uid-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const files=(dir,rel='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='.godspeed'?[]:e.isDirectory()?files(path.join(dir,e.name),rel+e.name+'/'):[rel+e.name]);
const unsafe='abcdefgh/../../../../rules/fictional-rule';

test('an assistant cannot choose a uid that names a file outside the notebook',async t=>{
 const root=temporary(t),store=new Store(root,{device:'fixture'}),query=new QueryService(store),domains=new Domains(query);
 const save=args=>mcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'save_record',arguments:args}},{store,query,domains,scopes:['notes'],delegated:true});
 const refused=await save({type:'notes',value:{title:'Fictional list',content:'milk',uid:unsafe}});
 assert.equal(refused.result.isError,true);assert.match(refused.result.content[0].text,/Invalid record path/);
 assert.deepEqual(files(root).filter(f=>!f.startsWith('notebook/')),[]);
 assert.equal(store.list('notes').length,0);
 // An ordinary note and its edit still work, and its earlier version stays in the notebook.
 const created=JSON.parse((await save({type:'notes',value:{title:'Fictional list',content:'milk'}})).result.content[0].text)[0];
 const edited=await save({type:'notes',value:{id:created.id,content:'milk and bread'},expected_hash:store.get('notes',created.id)._hash});
 assert.equal(edited.result.isError,undefined,edited.result.content[0].text);
 assert.deepEqual(files(root).filter(f=>!f.startsWith('notebook/')),[]);
 assert.equal(store.list('record_history').length,1);
});

test('a record that never went through prepare is checked before anything is written',t=>{
 const root=temporary(t),store=new Store(root,{device:'fixture'});
 const record={...store.prepare('notes',{title:'Fictional note',content:'text'}),uid:unsafe};
 assert.throws(()=>store.withLock(()=>store.commit([record])),/Invalid record path/);
 assert.deepEqual(files(root),[]);
});

test('a page whose uid names a path is reported and never read as a record',t=>{
 const root=temporary(t);fs.mkdirSync(path.join(root,'notebook'),{recursive:true});
 fs.writeFileSync(path.join(root,'notebook','Fictional.md'),'---\nid: fictional\ntype: note\ntitle: Fictional\nuid: "'+unsafe+'"\nformat: 1\n---\nBody\n');
 const store=new Store(root,{device:'fixture'});
 assert.equal(store.list('notes').length,0);
 assert.ok(store.problems.some(p=>/Invalid record path/.test(p.error)),JSON.stringify(store.problems));
});
