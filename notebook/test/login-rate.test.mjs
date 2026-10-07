import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {WebAuth} from '../server/web-auth.mjs';

// The sign-in limiter must count an attempt whose check is still running, so a
// burst of guesses fired at once from one address does not all get checked
// before any failure is recorded. Until 7 October 2026 it checked the wait,
// then awaited scrypt, then recorded the failure, so 40 at once were all run.
const setup=t=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-loginrate-'));t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
 const auth=new WebAuth(state,{token:'synthetic-setup-code',remote:true});
 return auth;
};
const req=address=>({method:'POST',headers:{},socket:{remoteAddress:address}});
const tally=async(auth,n,address,password=i=>'wrong '+i)=>{
 const results=await Promise.allSettled(Array.from({length:n},(_,i)=>auth.handle('/api/login',req(address),{username:'owner',password:password(i)})));
 const out={};for(const r of results){const k=r.status==='fulfilled'?'ok':String(r.reason.status);out[k]=(out[k]||0)+1;}return out;
};

test('concurrent guesses from one address are mostly refused, and a correct password elsewhere still works',async t=>{
 const auth=setup(t);
 const invite=(await auth.handle('/api/auth/bootstrap',req('203.0.113.9'),{token:'synthetic-setup-code'})).path.split('#invite=')[1];
 await auth.handle('/api/auth/setup',req('203.0.113.9'),{invite,username:'owner',password:'correct horse battery staple'});
 const burst=await tally(auth,40,'198.51.100.2');
 assert.equal(burst['401']||0,5,'exactly the free allowance is checked');
 assert.equal(burst['429']||0,35,'the rest are refused without a password check');
 assert.equal(burst.ok||undefined,undefined);
 // The owner, from a different address, is not blocked by the attacker's burst.
 const owner=await auth.handle('/api/login',req('198.51.100.3'),{username:'owner',password:'correct horse battery staple'});
 assert.equal(owner.ok,true);
});

test('sequential guesses from one address get the free allowance, then wait',async t=>{
 const auth=setup(t);
 const invite=(await auth.handle('/api/auth/bootstrap',req('203.0.113.9'),{token:'synthetic-setup-code'})).path.split('#invite=')[1];
 await auth.handle('/api/auth/setup',req('203.0.113.9'),{invite,username:'owner',password:'correct horse battery staple'});
 const seen={};
 for(let i=0;i<8;i++){try{await auth.handle('/api/login',req('198.51.100.1'),{username:'owner',password:'seq '+i});}catch(e){seen[e.status]=(seen[e.status]||0)+1;}}
 assert.equal(seen['401'],5);assert.equal(seen['429'],3);
});
