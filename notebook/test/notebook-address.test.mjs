import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {notebookAddress,hostingerAddress} from '../core/notebook-address.mjs';
import {createService} from '../server/main.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// "Send me the link to my notebook" (Teach It Once, Chapters 4 and 13). Until 8 October
// 2026 no assistant knew the address, on any route.
const none=()=>{throw Error('no such file');};
const at=(options)=>notebookAddress({env:{},read:none,inContainer:()=>false,...options});

test('a computer gets the local address with the port its notebook listens on',()=>{
  assert.deepEqual(at({port:47999}),{link:'http://127.0.0.1:47999/dashboard',opens:'only on the computer this notebook runs on'});
  assert.equal(at({env:{GODSPEED_PORT:'48000'}}).link,'http://127.0.0.1:48000/dashboard','the installer\'s port, when the server does not say');
});

test('a server installed with the Linux installer gets the https address it printed, with its port',()=>{
  assert.equal(at({env:{GODSPEED_WEB_ADDRESS:'https://srv1328602.hstgr.cloud:48443'}}).link,'https://srv1328602.hstgr.cloud:48443/dashboard');
  assert.equal(at({env:{GODSPEED_WEB_ADDRESS:'https://notebook.example/'}}).link,'https://notebook.example/dashboard');
  assert.match(at({env:{GODSPEED_WEB_ADDRESS:'https://notebook.example'}}).opens,/any computer or phone/);
  assert.equal(at({env:{GODSPEED_WEB_ADDRESS:'javascript:alert(1)'},port:47831}).link,'http://127.0.0.1:47831/dashboard','anything but a web address is ignored');
});

test('the Hostinger one-click server gets its own srvNNNNNN.hstgr.cloud address from the hostname the VPS gives it',()=>{
  const read=file=>{assert.equal(file,'/run/godspeed-vps-hostname');return 'srv1069233\n';};
  assert.equal(at({read,inContainer:()=>true}).link,'https://srv1069233.hstgr.cloud/dashboard');
  assert.equal(hostingerAddress('srv1069233.hstgr.cloud'),'https://srv1069233.hstgr.cloud');
  assert.equal(hostingerAddress('my-laptop'),null);
  assert.equal(at({read:()=>'my-laptop\n',port:47831}).link,'http://127.0.0.1:47831/dashboard','another computer\'s name is not a Hostinger address');
  assert.equal(at({read,env:{GODSPEED_WEB_ADDRESS:'https://own.example'}}).link,'https://own.example/dashboard','an address set by hand wins');
});

test('in a container that does not know its address there is no link to give, and the answer says so',()=>{
  const answer=at({inContainer:()=>true});
  assert.equal(answer.link,null);
  assert.match(answer.opens,/does not know its own web address/);
});

test('the Linux installer keeps the address for the notebook it starts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-address-start-')),start=path.join(dir,'start.mjs');
  try{
    const writer=fileURLToPath(new URL('../scripts/native-start-script.mjs',import.meta.url));
    const made=spawnSync(process.execPath,[writer,start,path.join(dir,'supervise.mjs')],{env:{...process.env,GODSPEED_WORKSPACE:dir,GODSPEED_WEB_ADDRESS:'https://srv1.example.com:48443'},encoding:'utf8'});
    assert.equal(made.status,0,made.stderr);
    assert.match(fs.readFileSync(start,'utf8'),/"GODSPEED_WEB_ADDRESS":"https:\/\/srv1\.example\.com:48443"/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('an assistant asking the notebook for its link gets the address of the door it really listens on',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-address-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const service=await createService({root,port:0});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});delete process.env.GODSPEED_ASSISTANT_CONFIG;});
  const port=service.address.port;
  const listed=await (await fetch('http://127.0.0.1:'+port+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})})).json();
  assert.ok(listed.result.tools.some(tool=>tool.name==='get_notebook_link'));
  const reply=await (await fetch('http://127.0.0.1:'+port+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_notebook_link',arguments:{}}})})).json();
  const answer=JSON.parse(reply.result.content[0].text);
  // The same answer this machine gives for that port: the local address on a computer
  // (a container running this suite, where /.dockerenv exists, has none).
  assert.deepEqual(answer,notebookAddress({port}));
  if(!fs.existsSync('/.dockerenv')&&!fs.existsSync('/run/godspeed-vps-hostname'))assert.equal(answer.link,'http://127.0.0.1:'+port+'/dashboard');
});
