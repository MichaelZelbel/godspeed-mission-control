import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {Telegram} from '../core/telegram.mjs';

function fixture(t,invoke){
 const base=fileURLToPath(new URL('../../.test-tmp/',import.meta.url));fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'godspeed-telegram-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),sent=[],update={update_id:101,message:{text:'Fictional question',chat:{id:42,type:'private'},from:{id:42,is_bot:false}}};
 const transport=async(url,{body})=>{const input=JSON.parse(body);if(url.endsWith('/getUpdates'))return {ok:true,json:async()=>({ok:true,result:input.offset>101?[]:[update]})};sent.push(input.text);return {ok:true,json:async()=>({ok:true,result:{message_id:sent.length}})};};
 const telegram=new Telegram({store,domains:{invoke:()=>invoke(store)},token:'fixture',owner:42,transport});
 return {store,sent,telegram};
}
function busyBriefly(store){const file=path.join(store.state,'workspace.lock');fs.writeFileSync(file,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));setTimeout(()=>{if(fs.existsSync(file))fs.unlinkSync(file);},70);}

test('a background writer cannot swallow a failed conversation without a reply',async t=>{
 const f=fixture(t,store=>{busyBriefly(store);throw new Error('Workspace is still being written');});
 await f.telegram.tick();
 assert.equal(f.store.get('command_receipts','telegram-101').state,'needs_review');
 assert.equal(f.sent.length,1);assert.match(f.sent[0],/could not finish|did not finish/i);
 await f.telegram.tick();assert.equal(f.sent.length,1);
});
test('a background writer cannot discard a completed reply',async t=>{
 const f=fixture(t,store=>{busyBriefly(store);return {reply:'Fictional answer'};});
 await f.telegram.tick();
 assert.deepEqual(f.sent,['Fictional answer']);
 assert.equal(f.store.get('command_receipts','telegram-101').state,'verified');
 await f.telegram.tick();assert.equal(f.sent.length,1);
});
test('an interrupted request reports failure once and never repeats its actions',async t=>{
 const f=fixture(t,()=>assert.fail('Interrupted actions must not be replayed'));
 f.store.save('command_receipts',{id:'telegram-101',source:'telegram',state:'attempted'});
 await f.telegram.tick();
 assert.equal(f.sent.length,1);assert.match(f.sent[0],/did not finish/i);
 assert.equal(f.store.get('command_receipts','telegram-101').state,'needs_review');
 await f.telegram.tick();assert.equal(f.sent.length,1);
});
test('an uncertain Telegram send is not duplicated or followed by a misleading failure reply',async t=>{
 const f=fixture(t,()=>({reply:'Fictional answer'}));
 const transport=f.telegram.transport;
 f.telegram.transport=async(url,input)=>{const response=await transport(url,input);if(url.endsWith('/sendMessage'))throw new Error('Connection lost after send');return response;};
 await f.telegram.tick();assert.equal(f.store.get('command_receipts','telegram-101').state,'needs_review');
 assert.deepEqual(f.sent,['Fictional answer']);
 await f.telegram.tick();assert.equal(f.sent.length,1);
});
