// #822: the Dashboard's arrival read must confirm the AI afresh, even right after a note's chat
// kept the five-second check window warm — inside that window the shared state answers without
// asking the AI, so the card could show what it last knew. A plain read still keeps the pacing
// #794 set; only a read that asks for a check jumps it.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';

async function standIn(t){
 const state={key:'fictional-key',checks:0,wait:0};
 const server=http.createServer(async(req,res)=>{for await(const chunk of req)void chunk;
  const keyed=req.headers.authorization==='Bearer '+state.key;
  const json=(code,body)=>{res.statusCode=code;res.setHeader('content-type','application/json');res.end(JSON.stringify(body));};
  if(req.method==='GET'&&req.url==='/v1/models'){state.checks++;if(state.wait)await new Promise(resolve=>setTimeout(resolve,state.wait));return json(200,{data:[{id:'fictional-model'}]});}
  if(req.method==='POST'&&req.url==='/v1/chat/completions')return keyed?json(200,{choices:[{message:{content:JSON.stringify({reply:'Stand-in answer.'})}}]}):json(401,{error:{message:'Invalid key'}});
  json(404,{});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve));});
 return {state,url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions'};
}

async function notebook(t){
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-arrival-'));for(const name of names)delete process.env[name];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'none.json');
 const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
 t.after(async()=>{await service.close();for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+service.address.port;
 return {
  connect:url=>fetch(base+'/api/provider',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,key:'fictional-key',model:'fictional-model'})}),
  options:(search='')=>fetch(base+'/api/chat/options'+search).then(r=>r.json()),
 };
}

test('inside the five-second window a plain read asks the AI nothing while a Dashboard arrival read checks it',async t=>{
 const ai=await standIn(t),page=await notebook(t);
 assert.equal((await page.connect(ai.url)).status,200);
 const before=ai.state.checks;
 const plain=await page.options();
 assert.equal(plain.usable,true);
 assert.equal(ai.state.checks,before,'a plain read inside the window sends no AI request');
 const confirmed=await page.options('?check=1');
 assert.equal(confirmed.usable,true);
 assert.equal(ai.state.checks,before+2,'the arrival read checked the AI (key endpoint probed without and with the key)');
 const after=await page.options();
 assert.equal(ai.state.checks,before+2,'a plain read after the fresh check still keeps the pacing');
});

// #822 acceptance item 1: the fresh check after a chat must hold on every repeat, not just some —
// ten arrivals in one run, each inside the warm window, each checking the AI and answering from it.
// (The first check read also refreshes the cached model list, so it probes the key endpoint twice;
// later repeats probe once for the check.)
test('the arrival check holds on 10 out of 10 repeats in one run',async t=>{
 const ai=await standIn(t),page=await notebook(t);
 assert.equal((await page.connect(ai.url)).status,200);
 for(let i=1;i<=10;i++){
  const before=ai.state.checks;
  const warm=await page.options();
  assert.equal(warm.usable,true);
  assert.equal(ai.state.checks,before,'repeat '+i+': the warm-window read asked the AI nothing');
  const confirmed=await page.options('?check=1');
  assert.equal(confirmed.usable,true);
  assert.ok(ai.state.checks>before,'repeat '+i+': the arrival read checked the AI and answered from it');
 }
});

test('reads that ask for a check share the check already in flight',async t=>{
 const ai=await standIn(t),page=await notebook(t);
 assert.equal((await page.connect(ai.url)).status,200);
 ai.state.wait=150;
 const [first,second,plain]=await Promise.all([page.options('?check=1'),page.options('?check=1'),page.options()]);
 ai.state.wait=0;
 assert.equal(first.usable,true);assert.equal(second.usable,true);assert.equal(plain.usable,true);
 assert.equal(ai.state.checks,2,'one check (a keyless and a keyed key-endpoint read) answered all three reads');
});
