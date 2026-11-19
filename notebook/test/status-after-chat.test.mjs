// #803: after a refused or unreachable AI worked again and a chat answered, the chats showed the AI
// as ready at once, but /api/status (the Home card) kept runtimeConfigured false until the next
// 5-second connection check. Here both read the same state the moment the chat has answered.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';

async function standIn(t){
  const ai={status:200};
  const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{
    if(ai.status!==200){res.writeHead(ai.status,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:ai.status===500?'Internal server error':'Incorrect API key provided'}}));}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'Hello again.'})}}]}));});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  ai.url='http://127.0.0.1:'+server.address().port+'/v1/chat/completions';
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return ai;
}

async function notebook(t){
  const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-status-after-chat-'));
  for(const n of names)delete process.env[n];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
  t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+service.address.port;
  const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:JSON.parse(await r.text())};};
  const get=async route=>JSON.parse(await (await fetch(base+route)).text());
  return {post,get};
}

for(const [failure,status] of [['refused',401],['unreachable',500]]){
  test(`after a ${failure} AI answers a chat again, /api/status reads it as connected at once (#803)`,async t=>{
    const ai=await standIn(t),nb=await notebook(t);
    assert.equal((await nb.post('/api/provider',{url:ai.url,key:'sk-fictional-803',model:'fictional-model'})).status,200);
    // The next connection check is due 5 seconds after connecting; it fails, and the chats and the
    // Home card both say so.
    ai.status=status;
    await new Promise(resolve=>setTimeout(resolve,5100));
    assert.equal((await nb.get('/api/chat/options')).availability,failure);
    let home=await nb.get('/api/status');
    assert.equal(home.runtimeConfigured,false);assert.equal(home.aiAvailability,failure);
    // The AI works again and a chat is answered, well inside the 5 seconds before the next check.
    ai.status=200;
    const started=Date.now();
    const chat=await nb.post('/api/functions/conversation-chat',{message:'Are you back?',conversation_id:'general'});
    assert.equal(chat.status,200,JSON.stringify(chat.body));
    home=await nb.get('/api/status');
    assert.ok(Date.now()-started<5000,'read before the next connection check is due');
    assert.equal(home.runtimeConfigured,true);assert.equal(home.aiAvailability,'ready');
    const options=await nb.get('/api/chat/options');
    assert.equal(options.availability,'ready');assert.equal(options.usable,true);
  });
}

test('with the AI still refused and no chat answered since, /api/status keeps runtimeConfigured false (#803)',async t=>{
  const ai=await standIn(t),nb=await notebook(t);
  assert.equal((await nb.post('/api/provider',{url:ai.url,key:'sk-fictional-803',model:'fictional-model'})).status,200);
  ai.status=401;
  await new Promise(resolve=>setTimeout(resolve,5100));
  assert.equal((await nb.get('/api/chat/options')).availability,'refused');
  const chat=await nb.post('/api/functions/conversation-chat',{message:'Are you back?',conversation_id:'general'});
  assert.notEqual(chat.status,200);
  const home=await nb.get('/api/status');
  assert.equal(home.runtimeConfigured,false);assert.equal(home.aiAvailability,'refused');
});

test('with no AI connected /api/status says none and runtimeConfigured stays false (#803)',async t=>{
  const nb=await notebook(t);
  const home=await nb.get('/api/status');
  assert.equal(home.runtimeConfigured,false);assert.equal(home.aiAvailability,'none');
});
