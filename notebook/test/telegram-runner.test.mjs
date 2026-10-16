import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {TelegramRunner,notebookLink} from '../../docker/full-candidate/telegram-runner.mjs';

// The one-click container's Telegram: the setup chat while the owner answers it, then Hermes'
// gateway, never both, started again after a pause when one stops, all without a redeploy.
function fixture({webAddress}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-telegram-runner-'));let clock=1_000_000,pid=0;
 const started=[],signals=[];
 const runner=new TelegramRunner({dir,env:{PATH:'/usr/bin',HOME:'/fictional',GODSPEED_ACCESS_TOKEN:'fictional-sign-in-code',GODSPEED_CANDIDATE_BOT_TOKEN:'fictional-other-bot',...(webAddress?{GODSPEED_WEB_ADDRESS:webAddress}:{})},now:()=>clock,python:'/fictional/python3',hermes:'/fictional/hermes',
  address:({env})=>env.GODSPEED_WEB_ADDRESS?{link:env.GODSPEED_WEB_ADDRESS+'/dashboard'}:{link:null},
  setup:'/kit/godspeed-telegram-setup',finish:'/kit/telegram-setup-finish.mjs',
  spawnProcess:(command,args,options)=>{const child=new EventEmitter();child.pid=++pid;child.kill=()=>{};Object.assign(child,{command,args,options});started.push(child);return child;},
  kill:(id,signal)=>{signals.push([id,signal]);const child=started.find(c=>c.pid===id);setImmediate(()=>child.emit('exit',null));}});
 const write=(name,value)=>value===null?fs.rmSync(path.join(dir,name),{force:true}):fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
 return {dir,runner,started,signals,write,advance:ms=>{clock+=ms;},state:()=>JSON.parse(fs.readFileSync(path.join(dir,'runner.json'),'utf8'))};
}
const tick=async runner=>{runner.tick();await new Promise(r=>setImmediate(r));};
const connection={token:'123456789:AAHfictionalKeyForTestsOnly_0123456789',bot_id:4242,username:'fictional_godspeed_bot',start_code:'fictionalStartCode0123456789abcd'};

test('nothing runs until a key is saved; then the setup chat runs with the key and the one-time code',async()=>{
 const f=fixture();
 await tick(f.runner);assert.equal(f.started.length,0);assert.equal(f.state().state,'idle');
 f.write('connection.json',connection);await tick(f.runner);
 assert.equal(f.started.length,1);const [setup]=f.started;
 assert.deepEqual([setup.command,setup.args],['/fictional/python3',['/kit/godspeed-telegram-setup']]);
 const env=setup.options.env;
 assert.equal(env.GODSPEED_TELEGRAM_TOKEN,connection.token);assert.equal(env.GODSPEED_TELEGRAM_START_CODE,connection.start_code);
 assert.equal(env.GODSPEED_TG_FLOW,'notebook');assert.equal(env.GODSPEED_TG_STATE,path.join(f.dir,'setup.json'));
 assert.match(env.GODSPEED_TG_FINISH,/telegram-setup-finish\.mjs"$/);assert.equal(env.TELEGRAM_BOT_TOKEN,undefined,'Hermes does not get the bot during setup');
 assert.ok(env.PATH.startsWith('/fictional'+path.delimiter),'hermes_cli is importable for the provider list');
 await tick(f.runner);assert.equal(f.started.length,1,'one chat at a time');
});

test('the chat is told the browser\'s time zone and where the notebook opens, the server\'s own address first',async()=>{
 const f=fixture({webAddress:'https://203-0-113-7.sslip.io'});f.write('connection.json',{...connection,timezone:'Europe/Vienna',web_address:'https://seen-in-the-browser.example'});await tick(f.runner);
 assert.equal(f.started[0].options.env.GODSPEED_TG_BROWSER_TZ,'Europe/Vienna');
 assert.equal(f.started[0].options.env.GODSPEED_TG_NOTEBOOK_URL,'https://203-0-113-7.sslip.io/dashboard');
 const g=fixture();g.write('connection.json',{...connection,web_address:'https://seen-in-the-browser.example'});await tick(g.runner);
 assert.equal(g.started[0].options.env.GODSPEED_TG_NOTEBOOK_URL,'https://seen-in-the-browser.example/dashboard','the page\'s address when the server knows none');
 assert.equal(g.started[0].options.env.GODSPEED_TG_BROWSER_TZ,'','no zone known, none made up');
 // An address that opens only on the server itself is no use on a phone.
 assert.equal(notebookLink({},{web_address:'http://127.0.0.1:47832'},()=>({link:'http://127.0.0.1:47831/dashboard'})),'');
 assert.equal(notebookLink({},null,()=>{throw Error('unreadable');}),'');
});

test('a chat that stops is started again after a pause; once done, the gateway takes the bot at once',async()=>{
 const f=fixture();f.write('connection.json',connection);await tick(f.runner);
 f.started[0].emit('exit',1);await tick(f.runner);assert.equal(f.started.length,1,'not at once after a failure');assert.equal(f.state().state,'waiting-to-retry');
 f.advance(5001);await tick(f.runner);assert.equal(f.started.length,2);
 f.write('setup.json',{bot_id:4242,owner_id:111,chat_id:111,done:true});f.started[1].emit('exit',0);await tick(f.runner);
 assert.equal(f.started.length,3);const gateway=f.started[2];
 assert.deepEqual([gateway.command,gateway.args],['/fictional/hermes',['gateway','run']]);
 assert.equal(gateway.options.env.TELEGRAM_BOT_TOKEN,connection.token);assert.equal(gateway.options.env.TELEGRAM_ALLOWED_USERS,'111');assert.equal(gateway.options.env.TELEGRAM_HOME_CHANNEL,'111');
 assert.equal(gateway.options.env.GODSPEED_TELEGRAM_TOKEN,undefined);
 // The assistant with tools never holds the web sign-in code or another bot's key.
 assert.equal(gateway.options.env.GODSPEED_ACCESS_TOKEN,undefined);assert.equal(gateway.options.env.GODSPEED_CANDIDATE_BOT_TOKEN,undefined);assert.equal(gateway.options.env.HOME,'/fictional');
 gateway.emit('exit',1);await tick(f.runner);assert.equal(f.started.length,3);f.advance(5001);await tick(f.runner);
 assert.equal(f.started.length,4,'a gateway that stopped comes back, and nothing else stops with it');
});

test('a new key or a disconnect stops what runs; a finished chat of another bot does not count',async()=>{
 const f=fixture();f.write('connection.json',connection);f.write('setup.json',{bot_id:9999,owner_id:5,chat_id:5,done:true});
 await tick(f.runner);assert.deepEqual(f.started[0].args,['/kit/godspeed-telegram-setup']);
 f.write('connection.json',{...connection,token:'123456789:AAHtheSameBotAfterRevokeInBotFather_012'});await tick(f.runner);
 assert.deepEqual(f.signals,[[1,'SIGTERM']]);await tick(f.runner);
 assert.equal(f.started.length,2,'started again at once with the new key');assert.equal(f.started[1].options.env.GODSPEED_TELEGRAM_TOKEN,'123456789:AAHtheSameBotAfterRevokeInBotFather_012');
 f.write('connection.json',null);await tick(f.runner);await tick(f.runner);
 assert.deepEqual(f.signals.at(-1),[2,'SIGTERM']);assert.equal(f.started.length,2);assert.equal(f.state().state,'idle');
});

test('a city named later in the chat restarts the gateway, once that chat is not mid-answer',async()=>{
 const f=fixture(),home=path.join(f.dir,'hermes'),workspace=path.join(f.dir,'workspace');fs.mkdirSync(home);fs.mkdirSync(path.join(workspace,'.godspeed'),{recursive:true});
 const config=path.join(home,'config.yaml'),chat=path.join(workspace,'.godspeed','context-setup.json'),past=new Date(Date.now()-120000);
 fs.writeFileSync(config,'model:\n  provider: openrouter\ntimezone: "UTC"\n');fs.utimesSync(config,past,past);
 Object.assign(f.runner.env,{HERMES_HOME:home,GODSPEED_WORKSPACE:workspace});
 f.write('connection.json',connection);f.write('setup.json',{bot_id:4242,owner_id:111,chat_id:111,done:true});
 await tick(f.runner);assert.equal(f.started.length,1);assert.equal(f.runner.child.zone,'UTC');
 await tick(f.runner);assert.deepEqual(f.signals,[],'the same clock: nothing to do');
 fs.writeFileSync(config,'model:\n  provider: openrouter\ntimezone: "Europe/Vienna"\n');
 await tick(f.runner);assert.deepEqual(f.signals,[],'not in the half minute after the change');
 fs.utimesSync(config,past,past);fs.writeFileSync(chat,JSON.stringify({state:'started',updated_at:new Date().toISOString()}));
 await tick(f.runner);assert.deepEqual(f.signals,[],'not while the chat that changed it is answering');
 fs.writeFileSync(chat,JSON.stringify({state:'started',updated_at:past.toISOString()}));
 await tick(f.runner);assert.deepEqual(f.signals,[[1,'SIGTERM']]);
 await tick(f.runner);await tick(f.runner);assert.equal(f.started.length,2,'started again at once, with the new clock');assert.equal(f.runner.child.zone,'Europe/Vienna');
});
