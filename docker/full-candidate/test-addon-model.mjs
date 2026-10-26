// Runs inside the fresh test container. The only model endpoint is a local fake;
// no production credential, subscription request or dating site is involved.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const root=process.env.GODSPEED_WORKSPACE,home=process.env.HERMES_HOME,config=path.join(home,'config.yaml');
const original=fs.readFileSync(config);let seen;
const server=http.createServer(async(req,res)=>{let bytes='';req.setEncoding('utf8');for await(const chunk of req)bytes+=chunk;seen=JSON.parse(bytes);res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'fictional-check',object:'chat.completion',created:1,model:'fictional-addon-model',choices:[{index:0,message:{role:'assistant',content:'{"verdict":"like","reason":"Fictional test passed."}'},finish_reason:'stop'}]}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 fs.writeFileSync(config,'model:\n  provider: custom\n  default: fictional-addon-model\n  base_url: http://127.0.0.1:'+server.address().port+'/v1\n');
 if(process.argv.includes('--serve')){
  const ready='/tmp/godspeed-addon-model-ready.json';fs.writeFileSync(ready,JSON.stringify({pid:process.pid}));
  await new Promise(resolve=>process.once('SIGTERM',resolve));fs.unlinkSync(ready);
  assert.equal(seen?.model,'fictional-addon-model');assert.equal(seen.tools,undefined);assert.equal(seen.messages.length,2);
 }else{
 const child=spawn(process.execPath,[path.join(root,'.godspeed','model.mjs'),'--workspace',root],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);
 child.stdin.end(JSON.stringify({system:'Return a fictional verdict only.',prompt:'A wholly invented profile.',timeout_ms:20000,max_tokens:128}));
 const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0,err);const result=JSON.parse(out);assert.equal(result.provider,'custom');assert.equal(result.model,'fictional-addon-model');assert.equal(JSON.parse(result.text).verdict,'like');assert.equal(seen.model,'fictional-addon-model');assert.equal(seen.tools,undefined);assert.equal(seen.messages.length,2);
 console.log('Fresh server add-on model request used its installed host helper and selected local endpoint with no tools.');
 }
}finally{fs.writeFileSync(config,original);await new Promise(resolve=>server.close(resolve));}
