import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../core/records/store.mjs';
import {Telegram} from '../core/telegram.mjs';

function fixture(t,{photo,renderProgress=async()=>Buffer.from('fictional png')}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-photo-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),calls=[],habit={name:'Read a page',doneMeans:'Read one page.',progress:{version:1,today:'2026-10-13',currentRun:1,lifetimeCompletedDays:120,calendar:[]}};
 const domains={invoke:async()=>({reply:'Recorded. 120 completed days altogether.',operation_results:[{habit}]})};
 const transport=async(url,input)=>{
  const method=url.split('/').at(-1),body=input.body instanceof FormData?Object.fromEntries(input.body):JSON.parse(input.body);calls.push({method,body});
  if(method==='getUpdates')return {ok:true,json:async()=>({ok:true,result:body.offset>101?[]:[{update_id:101,message:{text:'I read a page.',chat:{id:42,type:'private'},from:{id:42,is_bot:false,language_code:'en'}}}]})};
  if(method==='sendPhoto'&&photo)return photo();
  return {ok:true,json:async()=>({ok:true,result:{message_id:99}})};
 };
 return {telegram:new Telegram({store,domains,token:'fictional',owner:42,transport,renderProgress}),calls,store};
}
test('habit reply sends exactly one photo with caption to the authenticated owner, and is not replayed',async t=>{
 const f=fixture(t);await f.telegram.tick();await f.telegram.tick();const sends=f.calls.filter(c=>c.method.startsWith('send'));
 assert.equal(sends.length,1);assert.equal(sends[0].method,'sendPhoto');assert.equal(sends[0].body.chat_id,'42');assert.match(sends[0].body.caption,/120 completed/);assert.equal(sends[0].body.photo.type,'image/png');
 assert.equal(f.store.get('command_receipts','telegram-101').state,'verified');
});
test('a rendering failure and an explicit unsupported-photo rejection each fall back to one text answer',async t=>{
 for(const options of [{renderProgress:async()=>{throw Error('Unavailable');}},{photo:async()=>({ok:false,json:async()=>({ok:false,error_code:400})})}]){
  const f=fixture(t,options);await f.telegram.tick();await f.telegram.tick();assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,1);assert.equal(f.store.get('command_receipts','telegram-101').state,'verified');
 }
});
test('an uncertain photo delivery neither duplicates the photo nor follows with a second answer',async t=>{
 const f=fixture(t,{photo:async()=>{throw Error('Connection lost after send');}});await f.telegram.tick();await f.telegram.tick();
 assert.equal(f.calls.filter(c=>c.method==='sendPhoto').length,1);assert.equal(f.calls.filter(c=>c.method==='sendMessage').length,0);assert.equal(f.store.get('command_receipts','telegram-101').state,'needs_review');
});
