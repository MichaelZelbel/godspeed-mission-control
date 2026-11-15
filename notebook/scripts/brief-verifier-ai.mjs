#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';

const usage='usage: node notebook/scripts/brief-verifier-ai.mjs <port> <response-plan.json> [request-log.jsonl]';
const port=Number(process.argv[2]);
const planFile=process.argv[3];
const logFile=process.argv[4];
if(!Number.isInteger(port)||port<1||!planFile)throw Error(usage);

const source=JSON.parse(fs.readFileSync(planFile,'utf8'));
if(!source||typeof source!=='object'||Array.isArray(source))throw Error('the response plan must be a JSON object');
const queues=new Map(Object.entries(source).map(([kind,value])=>[kind,Array.isArray(value)?[...value]:[value]]));

const kindOf=input=>{
 const prompt=String(input.messages?.at(-1)?.content||'');
 const match=prompt.match(/"kind"\s*:\s*"([^"]+)"/);
 return match?.[1]||'default';
};
const nextResponse=kind=>{
 const queue=queues.get(kind)||queues.get('default');
 if(!queue?.length)throw Error(`the response plan has no reply left for ${kind}`);
 const value=queue.length===1?queue[0]:queue.shift();
 return typeof value==='string'?value:JSON.stringify(value);
};

const server=http.createServer((request,response)=>{
 let body='';
 request.setEncoding('utf8');
 request.on('data',chunk=>body+=chunk);
 request.on('end',()=>{
  try{
   const input=JSON.parse(body||'{}');
   const kind=kindOf(input);
   if(logFile)fs.appendFileSync(logFile,JSON.stringify({method:request.method,url:request.url,kind,input})+'\n');
   const content=nextResponse(kind);
   response.writeHead(200,{'content-type':'application/json'});
   response.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}));
  }catch(error){
   response.writeHead(500,{'content-type':'application/json'});
   response.end(JSON.stringify({error:{message:error.message}}));
  }
 });
});
server.listen(port,'127.0.0.1',()=>process.stderr.write(`brief verifier AI listening on http://127.0.0.1:${port}/v1\n`));
