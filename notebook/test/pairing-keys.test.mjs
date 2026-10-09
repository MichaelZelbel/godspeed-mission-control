import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

test('a media pairing key reaches only the media routes, and the owner can revoke it',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-pair-keys-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const token='private-installation-proof-not-a-password',service=await createService({root,host:'0.0.0.0',port:0,token,device:'vps'}),base='http://127.0.0.1:'+service.address.port;
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const call=async(route,{method='POST',input={},cookie,key}={})=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(key?{'X-Godspeed-Pair-Key':key}:{})},body:method==='GET'?undefined:JSON.stringify(input)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,cookie:r.headers.get('set-cookie')};};
 const invite=new URLSearchParams((await call('/api/auth/bootstrap',{input:{token}})).data.path.split('#')[1]).get('invite');
 const cookie=(await call('/api/auth/setup',{input:{username:'owner-test',password:'correct horse battery staple',invite}})).cookie.split(';')[0];
 const code=(await call('/api/pair/create',{cookie})).data.code,key=(await call('/api/pair/claim',{input:{code}})).data.key;assert.ok(key);
 assert.equal((await call('/api/media/manifest',{method:'GET',key})).status,200);
 for(const route of ['/api/query','/api/pair/create','/api/conflicts/resolve','/api/sync/configure','/api/sync/sign-in','/api/export','/api/functions/mc-api-keys','/api/backup'])assert.equal((await call(route,{key,input:{table:'notes'}})).status,401,route);
 const mcp=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json','X-Godspeed-Pair-Key':key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});assert.equal(mcp.status,401);
 const listed=(await call('/api/pair/keys',{method:'GET',cookie})).data.data;assert.equal(listed.length,1);assert.ok(!JSON.stringify(listed).includes(key));
 assert.equal((await call('/api/pair/keys',{method:'GET',key})).status,401);
 assert.equal((await call('/api/pair/revoke',{cookie,input:{id:listed[0].id}})).status,200);
 assert.equal((await call('/api/media/manifest',{method:'GET',key})).status,401);
 assert.ok((await call('/api/pair/keys',{method:'GET',cookie})).data.data[0].revoked_at);
});
