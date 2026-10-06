import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TelegramConnection} from '../server/telegram-connect.mjs';
import {createService} from '../server/main.mjs';

// Telegram connected from the web page on the one-click server: the key is checked with
// Telegram (a stand-in here), kept only on this server, and the page offers a one-time link.
const KEY='123456789:AAHfictionalKeyForTestsOnly_0123456789';
function standIn({bots={[KEY]:{id:4242,is_bot:true,first_name:'Fictional Godspeed',username:'fictional_godspeed_bot'}},webhook='',offline=false}={}){
 const calls=[];
 return {calls,fetcher:async(url,init)=>{
  calls.push(url);if(offline)throw new TypeError('fetch failed');
  const [,token,method]=/\/bot([^/]+)\/(\w+)$/.exec(url);const bot=bots[token];
  if(!bot)return new Response(JSON.stringify({ok:false,error_code:401,description:'Unauthorized'}),{status:401});
  return new Response(JSON.stringify({ok:true,result:method==='getMe'?bot:{url:webhook,pending_update_count:0}}),{status:200});
 }};
}
function fixture(options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-telegram-connect-')),dir=path.join(root,'telegram'),hermesHome=path.join(root,'hermes');
 fs.mkdirSync(hermesHome);const telegram=standIn(options);
 const connection=new TelegramConnection({dir,mode:'web',environmentBot:false,originalRuntime:true,hermesHome,api:'https://telegram.invalid',fetcher:telegram.fetcher});
 return {root,dir,hermesHome,connection,telegram,setup:value=>fs.writeFileSync(path.join(dir,'setup.json'),JSON.stringify(value))};
}

test('a key Telegram knows is kept on this server only, and the page gets a one-time link',async()=>{
 const f=fixture();
 assert.deepEqual(f.connection.status(),{available:true,managed:'web',connected:false,phase:'none'});
 const result=await f.connection.connect('  '+KEY+'\n');
 assert.equal(result.phase,'waiting');assert.equal(result.bot.username,'fictional_godspeed_bot');
 const saved=JSON.parse(fs.readFileSync(path.join(f.dir,'connection.json'),'utf8'));
 assert.equal(saved.token,KEY);assert.match(saved.start_code,/^[A-Za-z0-9_-]{32}$/);
 assert.equal(result.link,'https://t.me/fictional_godspeed_bot?start='+saved.start_code);
 assert.equal(JSON.stringify(result).includes(KEY),false,'the key never goes back to a browser');
 if(process.platform!=='win32')assert.equal(fs.statSync(path.join(f.dir,'connection.json')).mode&0o777,0o600);
 assert.deepEqual(f.telegram.calls.map(url=>url.split('/').pop()),['getMe','getWebhookInfo']);
});

test('a wrong key, a key-shaped typo and an unreachable Telegram each say what to do, and keep nothing',async()=>{
 const f=fixture();
 await assert.rejects(f.connection.connect('123456789:AAHsomebodyElsesKeyThatTelegramRefuses_01'),{message:/Telegram does not know this key/});
 await assert.rejects(f.connection.connect('not a key'),{message:/That is not a bot key/});
 assert.equal(f.telegram.calls.length,1,'a malformed key is not even sent to Telegram');
 const offline=fixture({offline:true});
 await assert.rejects(offline.connection.connect(KEY),{message:/could not reach Telegram/});
 const hooked=fixture({webhook:'https://elsewhere.invalid/hook'});
 await assert.rejects(hooked.connection.connect(KEY),{message:/still connected to another service/});
 for(const x of [f,offline,hooked])assert.equal(fs.existsSync(path.join(x.dir,'connection.json')),false);
});

test('the page follows the chat: waiting for Start, setting up, ready; a refused key is said',async()=>{
 const f=fixture();await f.connection.connect(KEY);
 f.setup({bot_id:999,owner_id:1,done:true});
 assert.equal(f.connection.status().phase,'waiting','a finished chat of another bot does not count');
 f.setup({bot_id:4242});assert.equal(f.connection.status().phase,'waiting');
 f.setup({bot_id:4242,owner_id:111,chat_id:111,owner_name:'Anna'});
 let status=f.connection.status();assert.equal(status.phase,'setting-up');assert.equal(status.owner,'Anna');assert.equal(status.link,undefined,'the link is gone once used');
 f.setup({bot_id:4242,owner_id:111,chat_id:111,owner_name:'Anna',done:true});assert.equal(f.connection.status().phase,'ready');
 f.setup({bot_id:4242,problem:'refused'});assert.equal(f.connection.status().phase,'refused');
});

test('another bot starts over; the same bot keeps its owner; a revoked key reaches Hermes; disconnect removes it all',async()=>{
 const other='987654321:AAHanotherFictionalKeyForTests_9876543210',revoked='123456789:AAHtheSameBotAfterRevokeInBotFather_012';
 const f=fixture({bots:{[KEY]:{id:4242,is_bot:true,username:'fictional_godspeed_bot'},[revoked]:{id:4242,is_bot:true,username:'fictional_godspeed_bot'},[other]:{id:77,is_bot:true,username:'other_fictional_bot'}}});
 await f.connection.connect(KEY);f.setup({bot_id:4242,owner_id:111,chat_id:111,done:true});
 fs.writeFileSync(path.join(f.hermesHome,'.env'),`OPENAI_KEY=kept\nTELEGRAM_BOT_TOKEN=${KEY}\nTELEGRAM_ALLOWED_USERS=111\nTELEGRAM_HOME_CHANNEL=111\n`);
 assert.equal((await f.connection.connect(revoked)).phase,'ready');
 assert.match(fs.readFileSync(path.join(f.hermesHome,'.env'),'utf8'),new RegExp('TELEGRAM_BOT_TOKEN='+revoked+'\nTELEGRAM_ALLOWED_USERS=111'));
 const result=await f.connection.connect(other);
 assert.equal(result.phase,'waiting');assert.equal(fs.existsSync(path.join(f.dir,'setup.json')),false,'a new bot needs its owner again');
 assert.equal(fs.readFileSync(path.join(f.hermesHome,'.env'),'utf8'),'OPENAI_KEY=kept\n');
 fs.writeFileSync(path.join(f.hermesHome,'.env'),`TELEGRAM_BOT_TOKEN=${other}\n`);
 assert.deepEqual(f.connection.disconnect(),{available:true,managed:'web',connected:false,phase:'none'});
 assert.equal(fs.existsSync(path.join(f.dir,'connection.json')),false);assert.equal(fs.readFileSync(path.join(f.hermesHome,'.env'),'utf8'),'');
});

test('servers that do not connect Telegram from the page say so and refuse a key',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-telegram-off-'));
 const environment=new TelegramConnection({dir:root,mode:'on',environmentBot:true,originalRuntime:true});
 assert.deepEqual(environment.status(),{available:false,managed:'environment',connected:true,phase:'ready'});
 await assert.rejects(environment.connect(KEY),{status:409});
 for(const options of [{dir:root,mode:'off',originalRuntime:true},{dir:undefined,mode:'web',originalRuntime:true},{dir:root,mode:'web',originalRuntime:false}])
  assert.equal(new TelegramConnection(options).status().available,false);
});

test('the notebook works without Telegram, and on a public server the routes need the signed-in owner',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-telegram-route-')),saved={...process.env};
 Object.assign(process.env,{GODSPEED_TELEGRAM_DIR:path.join(root,'telegram'),GODSPEED_TELEGRAM:'web',GODSPEED_TELEGRAM_API:'http://127.0.0.1:9'});delete process.env.GODSPEED_ORIGINAL_RUNTIME;
 const service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
 const remote=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-telegram-remote-')),host:'0.0.0.0',port:0,token:'f'.repeat(64)}),outside='http://127.0.0.1:'+remote.address.port;
 try{
  const status=await(await fetch(base+'/api/telegram')).json();
  assert.deepEqual(status,{available:false,managed:null,connected:false,phase:'none'},'without Hermes there is nothing to connect, and nothing breaks');
  const refused=await fetch(base+'/api/telegram/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:KEY})});
  assert.equal(refused.status,409);assert.match((await refused.json()).error,/not connected from this page/);
  assert.equal((await fetch(base+'/api/status')).status,200);
  assert.equal((await fetch(outside+'/api/telegram')).status,401);
  assert.equal((await fetch(outside+'/api/telegram/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:KEY})})).status,401);
 }finally{await service.close();await remote.close();process.env=saved;}
});
