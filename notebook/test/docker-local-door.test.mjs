import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createService} from '../server/main.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

function request(port,route,input,headers={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:route,method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(text)}));
    });
    req.on('error',reject);if(input!==undefined)req.write(JSON.stringify(input));req.end();
  });
}

test('a Docker add-on uses a separate loopback door while every web API still needs sign-in',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-docker-local-'));
  process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,host:'0.0.0.0',port:0,localPort:0,webPort:0,token:'fictional-setup-code'});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  assert.equal(service.localAddress?.address,'127.0.0.1');
  const local=service.localAddress.port,remote=service.address.port,web=service.webAddress.port;
  assert.notEqual(local,remote);assert.notEqual(local,web);
  const read={table:'notes',operation:'select'};
  for(const port of [remote,web])assert.equal((await request(port,'/api/query',read)).status,401);
  assert.equal((await request(local,'/api/query',read)).status,200);
  assert.equal((await request(local,'/api/query',read,{Host:'outside.example'})).status,403);
  assert.equal((await request(local,'/api/query',read,{Origin:'https://outside.example'})).status,403);
  const note=await request(local,'/api/query',{table:'notes',operation:'insert',values:{title:'An invented letter',content:'Pay the invented bill.',source_app:'paperwork-test',skip_processing:true}});
  assert.equal(note.status,200,JSON.stringify(note.json));
  assert.equal(service.query.rows('notes')[0].skip_processing,true);
  const due=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const made=await request(local,'/api/functions/addon-deadlines',{addon:'paperwork-test',action:'create',key:'letter-1',title:'Pay the invented bill',due,done_when:'Paid',cost:'A reminder fee'});
  assert.equal(made.status,200,JSON.stringify(made.json));assert.equal(made.json.data.created,true);
  assert.equal((await request(local,'/api/functions/addon-deadlines',{addon:'paperwork-test',action:'list'})).json.data.deadlines.length,1);
  assert.equal((await request(remote,'/api/functions/addon-deadlines',{addon:'paperwork-test',action:'list'})).status,401);
});

test('a native service keeps its usual local door without creating another listener',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-native-local-'));
  process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,port:0});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  assert.equal(service.localAddress,null);
  assert.equal((await request(service.address.port,'/api/query',{table:'notes',operation:'select'})).status,200);
});
