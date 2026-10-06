import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../server/main.mjs';
import { safeReturn } from '../server/web-auth.mjs';

test('public setup ownership, password login, durable sessions, expiry, recovery and logout', async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-auth-'));
  let now=Date.now();
  const options={root,host:'0.0.0.0',port:0,token:'private-installation-proof-not-a-password',authNow:()=>now};
  let service=await createService(options),base='http://127.0.0.1:'+service.address.port;
  async function request(route,input,cookie){const r=await fetch(base+route,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:input===undefined?undefined:JSON.stringify(input)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};}
  const credentials={username:'owner-test',password:'twelve words are not necessary'};
  try{
    assert.equal((await request('/api/auth/status')).data.configured,false);
    assert.equal((await request('/api/auth/setup',credentials)).status,403);
    assert.equal((await request('/api/auth/bootstrap',{token:'wrong'})).status,401);
    const invitation=(await request('/api/auth/bootstrap',{token:options.token})).data;
    const invite=new URLSearchParams(invitation.path.split('#')[1]).get('invite');
    assert.equal((await request('/api/auth/invite',{invite})).status,200);
    assert.equal((await request('/api/auth/setup',{...credentials,invite,password:'short'})).status,400);
    const races=await Promise.all([request('/api/auth/setup',{...credentials,invite}),request('/api/auth/setup',{...credentials,invite})]);
    const setup=races.find(r=>r.status===200);assert.ok(setup);assert.ok(races.some(r=>r.status===409));
    assert.ok(setup.data.recovery_code);assert.match(setup.cookie,/HttpOnly/);assert.match(setup.cookie,/Secure/);assert.match(setup.cookie,/SameSite=Lax/);
    assert.equal((await request('/api/auth/invite',{invite})).status,401);
    assert.equal((await request('/api/auth/setup',{...credentials,invite})).status,409);
    const cookie=setup.cookie.split(';')[0];
    assert.equal((await request('/api/session',undefined,cookie)).status,200);
    const disk=fs.readFileSync(path.join(root,'.godspeed/web-auth.json'),'utf8');
    assert.ok(!disk.includes(credentials.password));assert.ok(!disk.includes(setup.data.recovery_code));assert.ok(!disk.includes(cookie.split('=')[1]));
    await service.close();service=await createService(options);base='http://127.0.0.1:'+service.address.port;
    assert.equal((await request('/api/session',undefined,cookie)).status,200);
    now+=8*3600000+1;
    const expired=await request('/api/session',undefined,cookie);assert.equal(expired.status,401);assert.equal(expired.data.code,'SESSION_EXPIRED');
    assert.equal((await request('/api/login',{...credentials,password:'wrong password'})).status,401);
    assert.equal((await request('/api/login',{token:options.token})).status,401);
    const login=await request('/api/login',{...credentials,remember:true});assert.equal(login.status,200);assert.match(login.cookie,/Max-Age=2592000/);
    const remembered=login.cookie.split(';')[0];now+=29*86400000;
    assert.equal((await request('/api/session',undefined,remembered)).status,200);
    now+=86400000+1;
    assert.equal((await request('/api/session',undefined,remembered)).status,401);
    assert.equal((await request('/api/auth/recover',{...credentials,recovery_code:'wrong'})).status,401);
    const recovered=await request('/api/auth/recover',{username:'new-owner',password:'a different sufficiently long password',recovery_code:setup.data.recovery_code});
    assert.equal(recovered.status,200);assert.notEqual(recovered.data.recovery_code,setup.data.recovery_code);
    assert.equal((await request('/api/session',undefined,remembered)).status,401);
    assert.equal((await request('/api/auth/recover',{...credentials,recovery_code:setup.data.recovery_code})).status,401);
    const newCookie=recovered.cookie.split(';')[0];assert.equal((await request('/api/session',undefined,newCookie)).status,200);
    assert.equal((await request('/api/logout',{},newCookie)).status,200);
    assert.equal((await request('/api/session',undefined,newCookie)).status,401);
    assert.equal((await request('/api/logout')).status,405);
    assert.equal((await request('/api/auth/bootstrap',{token:options.token})).status,409);
    // One address's own failures make it wait, even with the right password (until 6 October 2026 everyone's counted together).
    const owner={username:'new-owner',password:'a different sufficiently long password'};
    now+=3600001;for(let i=0;i<5;i++)assert.equal((await request('/api/login',{username:'no',password:'wrong'})).status,401);
    assert.equal((await request('/api/login',{username:'no',password:'wrong'})).status,429);
    assert.equal((await request('/api/login',owner)).status,429);
    now+=1001;assert.equal((await request('/api/login',owner)).status,200);
    assert.equal(safeReturn('//unrelated.example'),'/dashboard');assert.equal(safeReturn('/\\unrelated.example'),'/dashboard');
    assert.equal(safeReturn('/dashboard/notes/one?tab=history#entry'),'/dashboard/notes/one?tab=history#entry');
  }finally{await service.close();}
});

test('setup invitations expire and cannot be reused after replacement',async()=>{
  const {WebAuth}=await import('../server/web-auth.mjs');const state=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-invite-'));let now=Date.now();
  const auth=new WebAuth(state,{remote:true,token:'setup-secret',now:()=>now});
  const first=auth.invite(),second=auth.invite();
  const readInvite=link=>new URLSearchParams(link.path.split('#')[1]).get('invite');
  assert.equal(auth.validInvite({invite:readInvite(first)}),false);assert.equal(auth.validInvite({invite:readInvite(second)}),true);
  now+=24*3600000+1;assert.equal(auth.validInvite({invite:readInvite(second)}),false);
});

test('failed sign-ins by a stranger never lock the owner out',async()=>{
  const {clientAddress,trustedProxies}=await import('../server/web-auth.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-limits-'));let now=Date.now();
  const token='private-installation-proof-not-a-password',service=await createService({root,host:'0.0.0.0',port:0,token,authNow:()=>now}),base='http://127.0.0.1:'+service.address.port;
  // Caddy, on this machine, names the client in X-Forwarded-For.
  async function request(route,input,from){const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':from},body:JSON.stringify(input)});return {status:r.status,data:await r.json()};}
  try{
    const invite=new URLSearchParams((await request('/api/auth/bootstrap',{token},'198.51.100.7')).data.path.split('#')[1]).get('invite');
    const owner={username:'owner-test',password:'correct horse battery staple'},setup=await request('/api/auth/setup',{...owner,invite},'198.51.100.7');assert.equal(setup.status,200);
    const stranger='203.0.113.5',statuses=[];
    for(let i=0;i<14;i++)statuses.push((await request('/api/login',{username:'owner-test',password:'wrong guess '+i},stranger)).status);
    assert.deepEqual(statuses,[401,401,401,401,401,...Array(9).fill(429)]);
    assert.equal((await request('/api/auth/recover',{recovery_code:'wrong',...owner},stranger)).status,429);
    assert.equal((await request('/api/auth/bootstrap',{token:'guess'},stranger)).status,429);
    assert.equal((await request('/api/login',owner,'198.51.100.7')).status,200);
    // The stranger's wait grows: one more check after a second, then two seconds.
    now+=1001;assert.equal((await request('/api/login',{username:'owner-test',password:'again'},stranger)).status,401);
    now+=1001;assert.equal((await request('/api/login',{username:'owner-test',password:'again'},stranger)).status,429);
    now+=1001;assert.equal((await request('/api/login',{username:'owner-test',password:'again'},stranger)).status,401);
    // Many addresses on one username: each failing address then waits; a clean one is still checked.
    for(let i=0;i<12;i++)assert.equal((await request('/api/login',{username:'owner-test',password:'spread '+i},'203.0.113.'+(100+i))).status,401);
    assert.equal((await request('/api/login',{username:'owner-test',password:'spread again'},'203.0.113.100')).status,429);
    assert.equal((await request('/api/login',owner,'192.0.2.44')).status,200);
    assert.equal((await request('/api/auth/recover',{recovery_code:setup.data.recovery_code,...owner},'192.0.2.45')).status,200);
  }finally{await service.close();}
  // A forwarded address is believed only from the proxy.
  const req=(peer,forwarded)=>({socket:{remoteAddress:peer},headers:forwarded?{'x-forwarded-for':forwarded}:{}});
  assert.equal(clientAddress(req('203.0.113.9','10.1.1.1')),'203.0.113.9');
  assert.equal(clientAddress(req('::ffff:127.0.0.1','198.51.100.1')),'198.51.100.1');
  assert.equal(clientAddress(req('172.18.0.3','6.6.6.6, 198.51.100.2, 172.18.0.2')),'198.51.100.2');
  assert.equal(clientAddress(req('127.0.0.1','not an address')),'127.0.0.1');
  assert.equal(clientAddress(req('127.0.0.1','198.51.100.1'),trustedProxies('none')),'127.0.0.1');
  assert.equal(clientAddress(req('203.0.113.9','198.51.100.1'),trustedProxies('203.0.113.0/24')),'198.51.100.1');
  assert.equal(clientAddress({headers:{}}),'unknown');
});
