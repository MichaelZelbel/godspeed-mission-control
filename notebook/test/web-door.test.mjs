import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {createService} from '../server/main.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// The HTTPS proxy in front of the web door passes the visitor's Host on; fetch cannot set one.
function request(port,route,{method='GET',host,headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:route,method,headers:{...(host?{Host:host}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});
    req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
  });
}

test('the web door asks every visitor to sign in, and the door on this machine stays open to it',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-web-door-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,port:0,webPort:0});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  const local=service.address.port,web=service.webAddress.port,host='notebook.example',origin='https://'+host;
  assert.notEqual(web,local);

  // Before anyone has an account: nothing behind the web door, and nothing typed there makes one.
  assert.equal((await request(local,'/api/status')).status,200);
  assert.equal((await request(web,'/api/status',{host})).status,401);
  assert.equal((await request(web,'/mcp',{host,method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).status,401);
  assert.deepEqual(JSON.parse((await request(web,'/api/auth/status',{host})).text),{configured:false,local:false,signed_in:false,session_expired:false});
  assert.equal((await request(web,'/api/auth/bootstrap',{host,method:'POST',body:{token:''}})).status,401);
  assert.equal((await request(web,'/api/login',{host,method:'POST',body:{username:'owner',password:'',token:''}})).status,401);
  assert.equal((await request(web,'/api/login-link',{host,method:'POST',body:{}})).status,401);
  // The local door still refuses a name that is not this machine's.
  assert.equal((await request(local,'/api/status',{host})).status,403);

  // The installer asks the local door for the private setup link; the owner opens it on the web address.
  const setup=JSON.parse((await request(local,'/api/login-link',{method:'POST',body:{}})).text);
  assert.match(setup.path,/^\/setup#invite=[a-f0-9]{64}$/);
  const invite=setup.path.split('=')[1];
  const made=await request(web,'/api/auth/setup',{host,method:'POST',headers:{Origin:origin},body:{username:'owner-test',password:'correct horse battery staple',invite}});
  assert.equal(made.status,200,made.text);
  assert.match(JSON.parse(made.text).recovery_code,/^[0-9A-F]{8}(-[0-9A-F]{8}){5}$/);
  const cookie=made.headers['set-cookie'][0];
  assert.match(cookie,/; Secure/,'the web address is HTTPS, so its session cookie says so');
  const session=cookie.split(';')[0];
  assert.equal((await request(web,'/api/status',{host,headers:{Cookie:session}})).status,200);
  assert.equal((await request(web,'/api/auth/setup',{host,method:'POST',body:{username:'someone-else',password:'another long password',invite}})).status,409);

  // After the account: a one-time sign-in link from this machine (what a bot sends) opens the web address.
  const link=JSON.parse((await request(local,'/api/login-link',{method:'POST',body:{}})).text).path;
  assert.match(link,/^\/login\/[a-f0-9]{64}$/);
  const used=await request(web,link,{host,method:'POST',headers:{Origin:origin}});
  assert.equal(used.status,303);
  assert.equal((await request(web,'/api/status',{host,headers:{Cookie:used.headers['set-cookie'][0].split(';')[0]}})).status,200);

  // Signing out on the web address ends that session only there; this machine's door needs none.
  assert.equal((await request(web,'/api/logout',{host,method:'POST',headers:{Cookie:session,Origin:origin},body:{}})).status,200);
  assert.equal((await request(web,'/api/status',{host,headers:{Cookie:session}})).status,401);
  assert.equal((await request(local,'/api/status')).status,200);
  assert.equal((await request(local,'/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).status,200);
});

test('a web door whose port is taken leaves the notebook running on this machine',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-web-door-taken-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const holder=net.createServer();await new Promise(resolve=>holder.listen(0,'127.0.0.1',resolve));
  const errors=[],logged=console.error;console.error=(...args)=>errors.push(args.join(' '));
  let service;
  try{service=await createService({root,port:0,webPort:holder.address().port});}finally{console.error=logged;}
  t.after(async()=>{await service.close();holder.close();fs.rmSync(root,{recursive:true,force:true});});
  assert.equal(service.webAddress,null);
  assert.ok(errors.some(line=>/web address's door on port \d+ could not open/.test(line)),errors.join('\n'));
  assert.equal((await request(service.address.port,'/api/status')).status,200);
});

test('without a web port there is no second door',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-web-door-none-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,port:0});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  assert.equal(service.webAddress,null);
});
