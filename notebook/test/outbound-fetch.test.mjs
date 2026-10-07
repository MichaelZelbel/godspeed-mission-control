import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {outboundFetch,checkOutboundURL,publicAddress} from '../core/outbound-fetch.mjs';
import {publicSource} from '../core/public-source.mjs';
import {procedure} from '../core/procedures.mjs';
import {createService} from '../server/main.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];
async function serve(t,handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return server.address().port;}
const refused=/private network|not read|https|sign-in/i;

test('addresses on this server, the local network, metadata services and carrier networks are refused',async t=>{
 for(const raw of ['http://127.0.0.1/','http://127.1.2.3:8080/x','http://[::1]/','http://169.254.169.254/latest/meta-data/','http://10.0.0.1/','http://172.20.0.2/','http://192.168.1.1/','http://100.86.49.3:3010/','http://[::ffff:127.0.0.1]/','http://[fd00::1]/','http://[fe80::1]/','http://0.0.0.0/','http://localhost:47831/','http://godspeed:47831/','http://router.local/','http://metadata.google.internal/','file:///etc/passwd','https://user:pw@example.org/'])
  assert.throws(()=>checkOutboundURL(raw),refused,raw);
 for(const ip of ['93.184.216.34','2606:4700::1111','8.8.8.8'])assert.equal(publicAddress(ip),true,ip);
 // A name that resolves to a private address is refused when the connection is made.
 const port=await serve(t,(req,res)=>res.end('INTERNAL-SECRET'));
 const lookup=(host,options,callback)=>callback(null,[{address:'127.0.0.1',family:4}]);
 await assert.rejects(outboundFetch('http://public-looking.example:'+port+'/',{},{lookup}),refused);
});

test('each redirect is checked again, and size and time are bounded',async t=>{
 let internalCalls=0;const internal=await serve(t,(req,res)=>{internalCalls++;res.end('INTERNAL-SECRET');});
 const big=await serve(t,(req,res)=>res.end('x'.repeat(300*1024)));
 const slow=await serve(t,()=>{});
 const front=await serve(t,(req,res)=>{if(req.url==='/away'){res.writeHead(302,{Location:'http://127.0.0.1:'+internal+'/latest/meta-data'});return res.end();}if(req.url==='/near'){res.writeHead(301,{Location:'/final'});return res.end();}res.end('public page '+req.url);});
 // The fixture stands in for a public site under the name "localhost" only.
 const opts={allowHosts:['localhost']};
 assert.equal(await (await outboundFetch('http://localhost:'+front+'/near',{},opts)).text(),'public page /final');
 await assert.rejects(outboundFetch('http://localhost:'+front+'/away',{},opts),refused);assert.equal(internalCalls,0);
 await assert.rejects(outboundFetch('http://localhost:'+big+'/',{},{...opts,maxBytes:100*1024}),/larger/);
 assert.equal((await (await outboundFetch('http://localhost:'+big+'/',{},{...opts,maxBytes:100*1024,truncate:true})).text()).length,100*1024);
 await assert.rejects(outboundFetch('http://localhost:'+slow+'/',{},{...opts,timeoutMs:300}),/abort|timeout/i);
 await assert.rejects(publicSource('http://127.0.0.1:'+internal+'/'),refused);assert.equal(internalCalls,0);
});

test('an actions-only key cannot make the server read an internal address, by watch or by a stored topic',async t=>{
 const seen=[];const internal=await serve(t,(req,res)=>{seen.push(req.url);res.end('{"AccessKeyId":"INTERNAL-SECRET-123"}');});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-ssrf-'));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
 const service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const key=(await (await fetch(base+'/api/functions/mc-api-keys/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'actions only',scopes:['actions']})})).json()).data.api_key;
 const url='http://127.0.0.1:'+internal+'/latest/meta-data/iam/security-credentials/role';
 const r=await (await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'personal_operation',arguments:{type:'watch-add',title:'prices',url,minutes:1,criteria:'any change'}}})})).json();
 assert.equal(r.result.isError,true,r.result.content[0].text);
 // A topic that already names such an address is not read either.
 service.store.save('watch_topics',{title:'Fictional old topic',urls:[url],criteria:'any change'});
 const out=await procedure({kind:'watch',id:'watch-sweeper'},{store:service.store,query:service.query,provider:null});
 assert.deepEqual(seen,[]);assert.ok(!JSON.stringify(out).includes('INTERNAL-SECRET'));
 assert.ok(!service.query.rows('watch_observations').some(o=>String(o.content||'').includes('INTERNAL-SECRET')));
});
