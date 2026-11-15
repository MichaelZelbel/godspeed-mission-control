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
const planned=Array.isArray(source.responses)?source.responses.map((entry,index)=>{
 if(!entry||typeof entry!=='object'||!Object.hasOwn(entry,'reply'))throw Error(`response ${index+1} must have a reply`);
 return {...entry,left:Number.isInteger(entry.times)&&entry.times>0?entry.times:1};
}):null;

const kindOf=input=>{
 const prompt=String(input.messages?.at(-1)?.content||'');
 const match=prompt.match(/"kind"\s*:\s*"([^"]+)"/);
 return match?.[1]||'default';
};
const requestInput=input=>{try{return JSON.parse(String(input.messages?.at(-1)?.content||'{}'));}catch{return {};}};
const partial=(actual,want)=>want&&typeof want==='object'&&!Array.isArray(want)
 ?Object.entries(want).every(([key,value])=>partial(actual?.[key],value))
 :Array.isArray(want)?Array.isArray(actual)&&want.every((value,index)=>partial(actual[index],value)):actual===want;
const nextResponse=(kind,input)=>{
 if(planned){
  const decoded=requestInput(input),entry=planned.find(candidate=>candidate.left>0&&partial(decoded,candidate.match||{}));
  if(!entry)throw Error(`the response plan has no matching reply for ${kind}`);
  entry.left--;
  return {value:entry.reply,name:String(entry.name||'')};
 }
 const queue=queues.get(kind)||queues.get('default');
 if(!queue?.length)throw Error(`the response plan has no reply left for ${kind}`);
 const value=queue.length===1?queue[0]:queue.shift();
 return {value,name:''};
};

const server=http.createServer((request,response)=>{
 let body='';
 request.setEncoding('utf8');
 request.on('data',chunk=>body+=chunk);
 request.on('end',()=>{
  let recorded=false,input,kind;
  try{
   input=JSON.parse(body||'{}');
   kind=kindOf(input);
   const selected=nextResponse(kind,input);
   if(logFile){fs.appendFileSync(logFile,JSON.stringify({method:request.method,url:request.url,kind,matched:planned?selected.name:null,input})+'\n');recorded=true;}
   const content=typeof selected.value==='string'?selected.value:JSON.stringify(selected.value);
   response.writeHead(200,{'content-type':'application/json'});
   response.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}));
  }catch(error){
   if(logFile&&!recorded)fs.appendFileSync(logFile,JSON.stringify({method:request.method,url:request.url,kind:kind||'invalid',matched:null,input:input||null,error:error.message})+'\n');
   response.writeHead(500,{'content-type':'application/json'});
   response.end(JSON.stringify({error:{message:error.message}}));
  }
 });
});
server.listen(port,'127.0.0.1',()=>process.stderr.write(`brief verifier AI listening on http://127.0.0.1:${port}/v1\n`));
