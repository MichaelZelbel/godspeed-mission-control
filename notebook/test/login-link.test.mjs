import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {Store} from '../core/records/store.mjs';
import {Telegram} from '../core/telegram.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

test('a one-time sign-in link survives a link preview and is used only by the person who presses Continue',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-login-link-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const token='private-installation-proof-not-a-password',service=await createService({root,host:'0.0.0.0',port:0,token}),base='http://127.0.0.1:'+service.address.port;
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const json=async(route,input,cookie)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(input)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};};
 const invite=new URLSearchParams((await json('/api/auth/bootstrap',{token})).data.path.split('#')[1]).get('invite');
 const cookie=(await json('/api/auth/setup',{username:'owner-test',password:'correct horse battery staple',invite})).cookie.split(';')[0];
 const link=(await json('/api/login-link',{},cookie)).data.path;
 // Telegram's preview fetcher, twice: a page, no session, the link still unused.
 for(let i=0;i<2;i++){const preview=await fetch(base+link+'?next=/dashboard/chat',{redirect:'manual'});assert.equal(preview.status,200);assert.equal(preview.headers.get('set-cookie'),null);assert.match(preview.headers.get('content-type'),/text\/html/);assert.match(await preview.text(),/<form method="post"/);}
 const press=()=>fetch(base+link+'?next=/dashboard/chat',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:'',redirect:'manual'});
 const used=await press();assert.equal(used.status,303);assert.equal(used.headers.get('location'),'/dashboard/chat');
 const session=used.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'/api/session',{headers:{Cookie:session}})).status,200);
 assert.equal((await press()).status,401);
 const expired=await fetch(base+link);assert.equal(expired.status,401);await expired.text();
 // The destination stays on this server.
 const other=(await json('/api/login-link',{},cookie)).data.path;
 const away=await fetch(base+other+'?next='+encodeURIComponent('/.//evil.example/phish'),{method:'POST',headers:{Origin:base},redirect:'manual'});assert.equal(away.headers.get('location'),'/dashboard');
});

test('the bot sends sign-in links without a link preview',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-telegram-preview-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),sent=[];
 const transport=async(url,init)=>{const method=url.split('/').pop(),input=JSON.parse(init.body);if(method==='getUpdates')return new Response(JSON.stringify({ok:true,result:sent.length?[]:[{update_id:1,message:{text:'/notebook',chat:{id:42,type:'private'},from:{id:42,is_bot:false}}}]}));sent.push(input);return new Response(JSON.stringify({ok:true,result:{message_id:7}}));};
 const telegram=new Telegram({store,domains:{},token:'fictional',owner:'42',transport,loginLink:destination=>'https://notebook.example/login/abc?next='+encodeURIComponent(destination)});
 await telegram.tick();
 assert.equal(sent.length,1);assert.match(sent[0].text,/login\/abc/);assert.deepEqual(sent[0].link_preview_options,{is_disabled:true});
});
