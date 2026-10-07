import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {copyAccount,stageAccount} from '../core/migration.mjs';
import {planMerge,applyMerge,workspaceDigest} from '../core/migration-merge.mjs';
import {Store,hash,atomic} from '../core/records/store.mjs';
import {createService} from '../server/main.mjs';
const user='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
async function fixture({profile=null,ownName='Keep my account'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-merge-'));
 const rows={...profile?{profiles:[{id:user,...profile}]}:{},notes:[{id:'matching',user_id:user,title:'Original',content:'Original Menerio version'},{id:'new-note',user_id:user,title:'New note',content:'Full content',is_trashed:true}],contacts:[{id:'new-person',user_id:user,name:'A saved person'}],note_conversations:[{id:'conversation',user_id:user,note_id:'matching'}],jobs:[{id:'imported-job',user_id:user,paused:false,owner:'local',next_run:'2020-01-01'}],unsupported:[{id:'legacy',user_id:user,content:'Keep privately'}]};
 const source={project:'synthetic',user,catalog:async()=>Object.keys(rows).map(name=>({name,columns:['id','user_id'],primaryKey:['id'],foreignKeys:[]})),fingerprint:async t=>({count:rows[t.name].length,digest:hash(rows[t.name])}),page:async(t,w,o,n)=>rows[t.name].slice(o,o+n),media:async()=>[{bucket:'files',name:'file.txt',size:5}],download:async()=>Buffer.from('hello')};
 const bundle=path.join(dir,'bundle');await copyAccount(source,bundle);
 const staged=path.join(dir,'stage');stageAccount(bundle,staged);
 const root=path.join(dir,'live'),store=new Store(root);store.save('notes',{id:'matching',title:'Edited in Godspeed',content:'Keep this current content'});
 store.save('profiles',{id:'owner',display_name:ownName});
 fs.writeFileSync(path.join(store.state,'assistant.json'),'{"verified":false,"testMarker":"private existing provider config"}');
 const mediaRoot=path.join(store.state,'media'),jobRoot=path.join(store.state,'job-one');fs.mkdirSync(jobRoot);
 return {dir,root,store,bundle,staged,mediaRoot,jobRoot};
}
test('merge preserves current edits and provider, repairs matching references, backs up media, and remains repeatable',async()=>{
 const f=await fixture(),old=f.store.get('notes','matching'),before=workspaceDigest(f.store),plan=planMerge(f.store,f.staged,f.mediaRoot);
 assert.equal(workspaceDigest(f.store),before);assert.equal(plan.summary.trashedNotes,1);assert.equal(plan.summary.contacts,1);assert.equal(plan.summary.keptExisting,1);
 const receipt=applyMerge({...f,digest:plan.digest});assert.ok(receipt.backupSaved);
 assert.equal(f.store.get('notes','matching')._hash,old._hash);
 assert.equal(f.store.get('notes','new-note').content,'Full content');assert.ok(f.store.get('notes','new-note').is_trashed);
 const conversation=f.store.get('note_conversations','conversation');assert.equal(conversation.references.find(r=>r.type==='notes').uid,old.uid);
 assert.equal(f.store.get('jobs','imported-job').paused,true);
 assert.equal(fs.readFileSync(path.join(f.store.state,'assistant.json'),'utf8'),'{"verified":false,"testMarker":"private existing provider config"}');
 assert.equal(f.store.problems.length,0);assert.ok(fs.existsSync(path.join(f.jobRoot,'backup',path.relative(f.store.root,f.store.file(f.store.get('notes','matching'))))));
 const repeat=planMerge(f.store,f.staged,f.mediaRoot);assert.equal(repeat.records.length,0);assert.equal(repeat.media.length,0);
 assert.ok(fs.existsSync(path.join(f.staged,'.godspeed/migration-source/source/unsupported.json')));
});
test('stale previews and conflicting attachments cannot overwrite current content',async()=>{
 const f=await fixture(),plan=planMerge(f.store,f.staged,f.mediaRoot);
 f.store.save('notes',{id:'new-note',title:'Concurrent change',content:'Keep'});
 assert.throws(()=>applyMerge({...f,digest:plan.digest}),/changed since the preview/);
 assert.equal(f.store.get('notes','new-note').content,'Keep');
 fs.mkdirSync(f.mediaRoot);const name=fs.readdirSync(path.join(f.staged,'.godspeed/media')).find(n=>n.endsWith('.mapping.json'));
 fs.writeFileSync(path.join(f.mediaRoot,name),'existing mapping');
 assert.throws(()=>planMerge(f.store,f.staged,f.mediaRoot),/attachment conflicts/);
 assert.equal(f.store.get('notes','matching').content,'Keep this current content');
});
test('import API requires ownership, previews without changes and executes a real verified copy',async()=>{
 const f=await fixture(),service=await createService({root:f.root,host:'0.0.0.0',port:0,token:'test-installation-proof'});
 const base='http://127.0.0.1:'+service.address.port;
 const call=async(route,input,cookie)=>{const r=await fetch(base+route,{method:input?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:input?JSON.stringify(input):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const until=async(cookie,state)=>{for(let n=0;n<100;n++){const r=await call('/api/menerio/import',null,cookie);if(r.data.job?.state===state)return r.data.job;if(r.data.job?.state==='failed')throw new Error(r.data.job.error);await new Promise(r=>setTimeout(r,50));}throw new Error('Import did not finish');};
 try{
  assert.equal((await call('/api/menerio/import')).status,401);
  const login=await call('/api/login',{token:'test-installation-proof'}),cookie=login.cookie;
  const config=path.join(f.store.state,'menerio-import/config.json');atomic(config,JSON.stringify({bundle:f.bundle}));
  assert.equal((await call('/api/menerio/import',{action:'apply',id:'../../escape'},cookie)).status,409);
  assert.equal((await call('/api/menerio/import',{action:'preview',source:'account',project:'http://localhost',token:'secret',apiKey:'secret'},cookie)).status,400);
  const before=workspaceDigest(f.store),start=await call('/api/menerio/import',{action:'preview',source:'prepared'},cookie);assert.equal(start.status,202);
  const ready=await until(cookie,'ready');assert.equal(workspaceDigest(f.store),before);assert.equal(ready.summary.trashedNotes,1);
  assert.ok(!JSON.stringify(ready).includes(f.bundle));
  assert.equal((await call('/api/menerio/import',{action:'apply',id:ready.id},cookie)).status,202);
  const result=await until(cookie,'complete');assert.ok(result.summary.backupSaved);
  assert.equal(f.store.get('notes','matching').content,'Keep this current content');assert.equal(f.store.get('notes','new-note').content,'Full content');
  assert.equal((await call('/api/menerio/import',{action:'apply',id:ready.id},cookie)).status,409);
  assert.equal((await call('/api/session',null,cookie)).status,200);
 }finally{await service.close();}
});
test('the owner name from the import fills the placeholder "Owner", never a name the owner chose',async()=>{
 const imported={display_name:'Fictional Owner',website:'https://example.org',bio:''};
 const a=await fixture({profile:imported,ownName:'Owner'}),plan=planMerge(a.store,a.staged,a.mediaRoot);applyMerge({...a,digest:plan.digest});
 assert.equal(a.store.get('profiles','owner').display_name,'Fictional Owner');assert.equal(a.store.get('profiles','owner').website,'https://example.org');
 assert.equal(planMerge(a.store,a.staged,a.mediaRoot).records.length,0,'a second import changes nothing');
 const b=await fixture({profile:imported}),second=planMerge(b.store,b.staged,b.mediaRoot);applyMerge({...b,digest:second.digest});
 assert.equal(b.store.get('profiles','owner').display_name,'Keep my account');
});
