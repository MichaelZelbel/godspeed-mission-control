import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,atomic} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {procedure} from '../core/procedures.mjs';
import http from 'node:http';import {createService} from '../server/main.mjs';
test('normal connection recheck uses the real configured endpoint, hides credentials and rejects an unauthenticated remote caller',async()=>{
 let calls=0,status=200;const endpoint=http.createServer((req,res)=>{calls++;res.writeHead(status,{'Content-Type':'application/json'});res.end('{}');});await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-recheck-http-')),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port,remote=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-auth-')),host:'0.0.0.0',port:0,token:'fictional-private-token'});
 try{
  atomic(path.join(service.store.state,'connectors/fictional.json'),JSON.stringify({origin:'http://127.0.0.1:'+endpoint.address().port,token:'fictional-secret-not-for-status'}));
  const response=await fetch(base+'/api/connections/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);const data=await response.json();assert.equal(data.connections[0].ok,true);assert.equal(data.connections[0].status,200);assert.equal(calls,1);assert.ok(!JSON.stringify(data).includes('fictional-secret'));
  assert.equal((await fetch('http://127.0.0.1:'+remote.address.port+'/api/connections/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);assert.equal(calls,1);
 }finally{await service.close();await remote.close();await new Promise(resolve=>endpoint.close(resolve));}
});
test('automatic transient retries obey the saved backoff and cap, and an explicit recheck can verify recovery',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-cap-'))),query=new QueryService(store);atomic(path.join(store.state,'connectors','fictional.json'),JSON.stringify({origin:'https://example.invalid'}));
 const original=globalThis.fetch;let calls=0,status=503;globalThis.fetch=async()=>{calls++;return new Response('{}',{status});};
 try{
  await procedure({kind:'connection-check'},{store,query});let repair=query.rows('work_items')[0];assert.equal(repair.attempts,1);assert.equal((await procedure({kind:'connection-check'},{store,query})).silent,true);assert.equal(calls,1);
  for(let n=0;n<2;n++){store.save('work_items',{id:repair.id,retry_after:new Date(Date.now()-1).toISOString()});await procedure({kind:'connection-check'},{store,query});}
  assert.equal(calls,3);assert.equal(store.get('work_items',repair.id).state,'needs_review');status=200;await procedure({kind:'connection-check'},{store,query});assert.equal(calls,3);
  await procedure({kind:'connection-check',manual:true},{store,query});assert.equal(calls,4);assert.equal(store.get('work_items',repair.id).state,'verified');assert.equal((await procedure({kind:'connection-check'},{store,query})).silent,true);
  status=503;await procedure({kind:'connection-check'},{store,query});assert.equal(store.get('work_items',repair.id).state,'pending');assert.equal(store.get('work_items',repair.id).attempts,1);
  store.save('work_items',{id:repair.id,retry_after:new Date(Date.now()-1).toISOString()});status=401;await procedure({kind:'connection-check'},{store,query});assert.equal(store.get('work_items',repair.id).state,'awaiting_login');assert.equal(query.rows('deadlines')[0].status,'open');status=200;await procedure({kind:'connection-check'},{store,query});assert.equal(store.get('work_items',repair.id).state,'verified');assert.equal(query.rows('deadlines')[0].status,'closed');
 }finally{globalThis.fetch=original;}
});
test('expired fictional connection creates one login obligation; successful recheck closes it',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-connection-'))),query=new QueryService(store);
 atomic(path.join(store.state,'connectors','fictional.json'),JSON.stringify({origin:'https://example.invalid',test_url:'https://example.invalid/check'}));
 const original=globalThis.fetch;let status=401;globalThis.fetch=async()=>new Response('{}',{status});
 try{await procedure({kind:'connection-check',id:'connections'},{store,query});await procedure({kind:'connection-check',id:'connections'},{store,query});assert.equal(query.rows('deadlines').length,1);assert.equal(query.rows('deadlines')[0].status,'open');status=200;await procedure({kind:'connection-check',id:'connections'},{store,query});assert.equal(query.rows('deadlines')[0].status,'closed');assert.ok(query.rows('deadlines')[0].completion_evidence);}finally{globalThis.fetch=original;}
});
test('configured Drive refresh repairs an expired access token before requiring login',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-refresh-'))),query=new QueryService(store);atomic(path.join(store.state,'connectors','gdrive.json'),JSON.stringify({origin:'https://www.googleapis.com',token:'fictional-old',refresh_token:'fictional-refresh',client_id:'fictional-client'}));
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async url=>{calls++;return String(url).includes('oauth2.googleapis.com')?new Response(JSON.stringify({access_token:'fictional-new'})):new Response('{}',{status:calls===1?401:200});};
 try{assert.equal((await procedure({kind:'connection-check'},{store,query})).silent,true);assert.equal(calls,3);assert.equal(query.rows('deadlines').length,0);assert.equal(JSON.parse(fs.readFileSync(path.join(store.state,'connectors','gdrive.json'))).token,'fictional-new');}finally{globalThis.fetch=original;}
});
