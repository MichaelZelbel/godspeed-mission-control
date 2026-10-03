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
    const login=await request('/api/login',{...credentials,remember:true});assert.equal(login.status,200);assert.match(login.cookie,/Max-Age=604800/);
    const remembered=login.cookie.split(';')[0];now+=6*86400000;
    assert.equal((await request('/api/session',undefined,remembered)).status,200);
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
    now+=60001;for(let i=0;i<12;i++)assert.equal((await request('/api/login',{username:'no',password:'wrong'})).status,401);
    assert.equal((await request('/api/login',credentials)).status,429);
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
