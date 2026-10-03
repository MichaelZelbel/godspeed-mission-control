import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,atomic} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {procedure} from '../core/procedures.mjs';
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
