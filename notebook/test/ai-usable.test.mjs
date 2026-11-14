// #573: with the AI's key refused, or the AI stopped, the Dashboard still said "Ready to chat", the
// model pickers named no model, and every chat reply was the provider's raw "HTTP 401" text.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {loadChatOptions} from '../ui/src/local/chat-options.mjs';

const KEY='fictional-good-key',MODEL='fictional-model-7';
// A stand-in AI on this computer that takes only KEY.
async function standInAI(t){
 const ai={key:KEY,calls:0};
 ai.server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{ai.calls++;
  if(req.headers.authorization!=='Bearer '+ai.key){res.writeHead(401,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:{message:'Incorrect API key provided: invalid API key'}}));}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'Fictional answer'})}}]}));});});
 await new Promise(resolve=>ai.server.listen(0,'127.0.0.1',resolve));
 ai.url='http://127.0.0.1:'+ai.server.address().port+'/v1/chat/completions';
 ai.stop=()=>new Promise(resolve=>{ai.server.closeAllConnections();ai.server.close(resolve);});
 t.after(()=>ai.server.listening&&ai.stop());
 return ai;
}
async function notebook(t,{url,key}){
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-ai-usable-'));
 for(const n of names)delete process.env[n];
 Object.assign(process.env,{GODSPEED_ASSISTANT_CONFIG:path.join(root,'no-assistant.json'),GODSPEED_MODEL_URL:url,GODSPEED_MODEL_KEY:key,GODSPEED_MODEL:MODEL});
 const {createService}=await import('../server/main.mjs');const service=await createService({root:path.join(root,'workspace'),port:0});
 t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+service.address.port;
 return {
  status:async()=>(await fetch(base+'/api/status')).json(),
  options:()=>loadChatOptions({fetcher:(route,init)=>fetch(base+route,init)}),
  chat:async message=>{const r=await fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})});return {status:r.status,body:await r.json()};},
 };
}

test('the model pickers and the chat options name the model saved for the AI',async t=>{
 const ai=await standInAI(t),nb=await notebook(t,{url:ai.url,key:KEY});
 const status=await nb.status();assert.equal(status.runtimeConfigured,true);assert.equal(status.aiProblem,null);
 const options=await nb.options();
 assert.equal(options.connected,true);assert.equal(options.label,MODEL);assert.equal(options.problem,undefined);
});

test('a refused key is said on the Dashboard, in the pickers and in the chat reply, until the key works again',async t=>{
 const ai=await standInAI(t);ai.key='fictional-new-key';
 const nb=await notebook(t,{url:ai.url,key:KEY});
 const refused=/^The AI at 127\.0\.0\.1:\d+ refused its key, so it could not be used\. Check the key in Settings, Your AI\.$/;
 assert.match((await nb.status()).aiProblem,refused);
 assert.match((await nb.options()).problem,refused);
 const reply=await nb.chat('Fictional question');
 assert.notEqual(reply.status,200);assert.match(reply.body.error,refused);assert.doesNotMatch(JSON.stringify(reply.body),/HTTP|Incorrect API key/);
 ai.key=KEY;
 const answered=await nb.chat('Fictional question again');assert.equal(answered.status,200,JSON.stringify(answered.body));
 assert.equal((await nb.status()).aiProblem,null);assert.equal((await nb.options()).problem,undefined);
});

test('an AI that cannot be reached is said on the Dashboard and in the chat reply',async t=>{
 const ai=await standInAI(t),nb=await notebook(t,{url:ai.url,key:KEY});
 await ai.stop();
 const unreachable=/^The AI at 127\.0\.0\.1:\d+ could not be reached\. .*Settings, Your AI/;
 assert.match((await nb.status()).aiProblem,unreachable);
 const reply=await nb.chat('Fictional question');
 assert.notEqual(reply.status,200);assert.match(reply.body.error,unreachable);assert.doesNotMatch(reply.body.error,/fetch failed/);
});
