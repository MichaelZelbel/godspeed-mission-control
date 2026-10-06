import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {SearchIndex} from '../core/index/search.mjs';
import {MeaningIndex,passages,embeddingsUrl} from '../core/index/meaning.mjs';
import {createService} from '../server/main.mjs';

// A stand-in embeddings service that knows a few meanings: knee, Knie and
// Orthopäde are one thing, groceries another. It speaks the OpenAI-style
// /embeddings API, as OpenRouter, OpenAI and Ollama do.
const concepts=[['knee','knie','orthopäde','orthopädie','orthopedist','doctor','arzt','mrt','mri'],['grocery','groceries','milk','bread','einkauf'],['guitar','music','song']];
const vectorOf=text=>{const words=String(text).toLowerCase().match(/[\p{L}]+/gu)||[];const v=concepts.map(c=>words.filter(w=>c.includes(w)).length);v.push(0.01);return v;};
async function fakeService(){
  let calls=0,inputs=0;
  const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const {input,model}=JSON.parse(body);calls++;inputs+=input.length;
    if(req.headers.authorization!=='Bearer fictional-key'){res.writeHead(401,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:{message:'Invalid key'}}));}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({model,data:input.map((t,index)=>({index,embedding:vectorOf(t)})),usage:{total_tokens:input.length}}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {url:'http://127.0.0.1:'+server.address().port+'/v1',stats:()=>({calls,inputs}),close:()=>new Promise(r=>server.close(r))};
}
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-meaning-')));
  const ortho=store.save('notes',{title:'Orthopäde Termin',content:'Montag 9 Uhr, MRT besprechen.'});
  store.save('notes',{title:'Einkauf',content:'Milk and bread.'});
  store.save('notes',{title:'Gig',content:'New song on the guitar.'});
  return {store,ortho};};

test('passages overlap a little and stay near 1,500 characters',()=>{
  const parts=passages('Title',('Sentence number one. ').repeat(400));
  assert.ok(parts.length>=5&&parts.every(p=>p.startsWith('Title\n')&&p.length<=1600));
  assert.deepEqual(passages('Only a title',''),['Only a title']);
  assert.equal(embeddingsUrl('https://openrouter.ai/api/v1'),'https://openrouter.ai/api/v1/embeddings');
  assert.equal(embeddingsUrl('http://localhost:11434/v1/embeddings'),'http://localhost:11434/v1/embeddings');
  assert.throws(()=>embeddingsUrl('http://example.org/v1'),/https/);
});

test('"knee doctor" finds "Orthopäde Termin" by meaning, which words alone cannot',async()=>{
  const service=await fakeService(),{store,ortho}=fixture(),index=new SearchIndex(store);
  try{
    const plain=await index.searchHybrid('knee doctor');assert.equal(plain.mode,'words');assert.match(plain.note,/words only/);assert.equal(plain.rows.length,0);
    index.meaning=new MeaningIndex(index,{config:{url:service.url,key:'fictional-key',model:'fictional-embed'}});
    await index.meaning.step();
    assert.equal(index.meaning.status.pending,0);
    const found=await index.searchHybrid('knee doctor');
    assert.equal(found.mode,'words and meaning');assert.equal(found.rows[0].id,ortho.id);assert.equal(found.rows[0].matched,'meaning');
    // A changed note is embedded again, an unchanged one is not.
    const before=service.stats().inputs;store.save('notes',{id:ortho.id,content:'Montag 9 Uhr, Knie.'},store.get('notes',ortho.id)._hash);index.update([store.get('notes',ortho.id)]);
    await index.meaning.step();assert.equal(service.stats().inputs-before,1);
    // A removed note's vectors go.
    store.save('notes',{id:ortho.id,removed_at:new Date().toISOString()});index.update([store.get('notes',ortho.id)]);
    await index.meaning.step();assert.ok(!(await index.searchHybrid('knee doctor')).rows.some(r=>r.id===ortho.id));
  }finally{index.close();await service.close();}
});

test('the notebook connects to a service, keeps its key private, and the notes search uses words and meaning',async()=>{
  const service=await fakeService(),{store,ortho}=fixture();
  const app=await createService({root:store.root,port:0}),base='http://127.0.0.1:'+app.address.port;
  try{
    let r=await fetch(base+'/api/embeddings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:service.url,key:'wrong',model:'fictional-embed'})});
    assert.equal(r.status,400);assert.match((await r.json()).error,/401.*Invalid key/);
    r=await fetch(base+'/api/embeddings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:service.url,key:'fictional-key',model:'fictional-embed'})});
    assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
    const status=await(await fetch(base+'/api/embeddings')).json();assert.equal(status.configured,true);assert.equal(status.has_key,true);assert.equal(JSON.stringify(status).includes('fictional-key'),false);
    for(let i=0;i<50&&(app.index.meaning.status.pending!==0||app.index.meaning.status.indexed===0);i++)await new Promise(r=>setTimeout(r,100));
    const search=await(await fetch(base+'/api/search?q='+encodeURIComponent('knee doctor'))).json();
    assert.equal(search.mode,'words and meaning');assert.equal(search.data[0].id,ortho.id);
    const semantic=await(await fetch(base+'/api/functions/search-notes-semantic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'knee doctor',limit:5})})).json();
    assert.equal(semantic.data.results[0].id,ortho.id);assert.deepEqual(semantic.data.notes,semantic.data.results);assert.ok(semantic.data.semantic);
    r=await fetch(base+'/api/embeddings',{method:'DELETE'});assert.equal((await r.json()).configured,false);
    assert.equal((await(await fetch(base+'/api/search?q=knee%20doctor')).json()).mode,'words');
  }finally{await app.close();await service.close();}
});

test('the chat is given the notes word-and-meaning search ranks first, without asking the model for synonyms',async()=>{
  const service=await fakeService(),{store,ortho}=fixture(),index=new SearchIndex(store),domains=new Domains(new QueryService(store));
  try{
    index.meaning=new MeaningIndex(index,{config:{url:service.url,key:'fictional-key',model:'fictional-embed'}});await index.meaning.step();domains.index=index;
    const kinds=[];let given;domains.provider=async input=>{kinds.push(input.kind);if(input.kind==='conversation-chat')given=input.context;return {reply:'Monday at nine.'};};
    await domains.invoke('conversation-chat',{message:'What did I note about the knee doctor?',conversation_id:'fictional'});
    assert.equal(given.notes[0].id,ortho.id);assert.match(given.retrieval.method,/meaning/);assert.ok(!kinds.includes('retrieval-expansion'));
  }finally{index.close();await service.close();}
});
