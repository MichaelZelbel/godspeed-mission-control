import test from 'node:test';import assert from 'node:assert/strict';
import {loadChatOptions} from '../ui/src/local/chat-options.mjs';
test('model option loading times out rather than leaving the composer loading forever',async()=>{
 const hanging=(url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});const keepAlive=setInterval(()=>{},1000);try{await assert.rejects(loadChatOptions({fetcher:hanging,timeoutMs:15}),/did not load/);}finally{clearInterval(keepAlive);}
});
test('a fresh retry loads actual connected choices without replaying a message',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response(JSON.stringify({current:'fictional-model',models:[{id:'fictional-model',efforts:['low']}]}),{headers:{'content-type':'application/json'}});};const result=await loadChatOptions({fetcher});assert.equal(result.current,'fictional-model');assert.deepEqual(result.models[0].efforts,['low']);assert.equal(calls,1);
});
test('endpoint default choices use the empty default model ID and retain its readable label',async()=>{
 const result=await loadChatOptions({fetcher:async()=>new Response(JSON.stringify({current:'Connected model',models:[{id:'',efforts:[]}]}))});assert.equal(result.current,'');assert.equal(result.label,'Connected model');
});
test('invalid choices fail visibly rather than making up a model',async()=>{
 await assert.rejects(loadChatOptions({fetcher:async()=>new Response(JSON.stringify({current:'missing',models:[]}))}),/No model choices/);
});
