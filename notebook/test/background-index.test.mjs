import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {Store,encode} from '../core/records/store.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {createService} from '../server/main.mjs';

const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-background-index-'));
test('background refresh reads changed bytes with restored timestamps, skips unchanged writes and retains exclusions',async()=>{
  const root=temporary(),store=new Store(root),note=store.save('notes',{id:'fictional-note',title:'Fictional',content:'Alpha'}),index=new SearchIndex(store);
  try{
    const file=store.file(note),stat=fs.statSync(file),before=index.db.prepare('SELECT total_changes() AS count').get().count;
    assert.equal(await index.rebuildBackground(),false);
    assert.equal(index.db.prepare('SELECT total_changes() AS count').get().count,before);
    fs.writeFileSync(file,encode({...note,content:'Bravo'}));fs.utimesSync(file,stat.atime,stat.mtime);
    fs.mkdirSync(path.join(root,'profile','.private'),{recursive:true});fs.writeFileSync(path.join(root,'profile','.private','hidden.md'),'excluded-marker');
    fs.writeFileSync(path.join(root,'profile','visible.md'),'visible-marker');
    assert.equal(await index.rebuildBackground(),true);assert.equal(index.search('Bravo').length,1);assert.equal(index.search('Alpha').length,0);
    assert.equal(index.search('excluded-marker').length,0);assert.equal(index.search('visible-marker').length,1);
    fs.writeFileSync(file,encode({...note,removed_at:new Date().toISOString()}));fs.unlinkSync(path.join(root,'profile','visible.md'));
    await index.rebuildBackground();assert.equal(index.search('Fictional').length,0);assert.equal(index.search('visible-marker').length,0);
    fs.writeFileSync(file,'invalid canonical record');await index.rebuildBackground();assert.equal(index.search('fictional-note').length,0);
  }finally{index.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('concurrent background refreshes coalesce and foreground rebuild cannot be overwritten',async()=>{
  const root=temporary(),store=new Store(root),note=store.save('notes',{id:'fictional-note',content:'before'}),index=new SearchIndex(store);
  try{
    const read=index.readBackground.bind(index);let release,entered;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});let calls=0;
    index.readBackground=async()=>{calls++;const docs=await read();if(calls===1){entered();await held;}return docs;};
    const first=index.rebuildBackground();assert.equal(index.rebuildBackground(),first);await started;
    fs.writeFileSync(store.file(note),encode({...note,content:'after'}));index.rebuild();release();await first;
    assert.equal(calls,2);assert.equal(index.search('after').length,1);assert.equal(index.search('before').length,0);
  }finally{index.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('actual file indexing leaves static and authentication requests responsive',async t=>{
  const root=temporary(),ui=path.join(root,'.fixture-ui');fs.mkdirSync(ui);fs.writeFileSync(path.join(ui,'index.html'),'<html>Fictional dashboard</html>');
  const folder=path.join(root,'notebook','notes');fs.mkdirSync(folder,{recursive:true});
  for(let i=0;i<1500;i++)fs.writeFileSync(path.join(folder,`fictional-${i}.md`),encode({format:1,type:'notes',id:`fictional-${i}`,uid:`fictional-${i}`,title:`Fictional ${i}`,content:'Fictional actual-byte fixture. '.repeat(100)}));
  const service=await createService({root,uiRoot:ui,port:0}),url=`http://127.0.0.1:${service.address.port}`;
  try{
    const syncStart=performance.now(),queuedRequest=fetch(url+'/api/auth/status');service.index.rebuild();const syncMs=performance.now()-syncStart;
    assert.equal((await queuedRequest).status,200);const syncRequestMs=performance.now()-syncStart;
    const changed=path.join(folder,'fictional-0.md');fs.writeFileSync(changed,fs.readFileSync(changed,'utf8')+'changed-background-marker');
    let finished=false,whileReading=0,maxMs=0;const start=performance.now();
    const refresh=service.index.rebuildBackground().finally(()=>{finished=true;});
    do{
      const sent=performance.now();const results=await Promise.all(['/api/auth/status','/dashboard/chat','/health'].map(route=>fetch(url+route).then(async response=>{assert.equal(response.status,200);await response.text();})));
      maxMs=Math.max(maxMs,performance.now()-sent);if(!finished)whileReading++;assert.equal(results.length,3);
    }while(!finished);
    await refresh;
    t.diagnostic(`1500 real files: unchanged synchronous refresh ${syncMs.toFixed(1)}ms, queued auth request ${syncRequestMs.toFixed(1)}ms; changed background ${ (performance.now()-start).toFixed(1)}ms; maximum static/auth/health request group ${maxMs.toFixed(1)}ms; ${whileReading} groups served during disk reads`);
    assert.equal(service.index.search('changed-background-marker').length,1);
    assert.ok(whileReading>=2,'requests must complete while actual disk indexing is still in progress');assert.ok(maxMs<1200,`request group stalled for ${maxMs}ms`);
  }finally{await service.close();fs.rmSync(root,{recursive:true,force:true});}
});
