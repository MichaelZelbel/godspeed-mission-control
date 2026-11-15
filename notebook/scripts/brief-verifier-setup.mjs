#!/usr/bin/env node
import fs from 'node:fs';

const usage='usage: node notebook/scripts/brief-verifier-setup.mjs <notebook-url> <setup-plan.json> <result-log.jsonl>';
const base=new URL(process.argv[2]||'http://invalid');
const planFile=process.argv[3];
const logFile=process.argv[4];
if(!planFile||!logFile||!['127.0.0.1','localhost','::1'].includes(base.hostname))throw Error(usage);
const steps=JSON.parse(fs.readFileSync(planFile,'utf8'));
if(!Array.isArray(steps)||!steps.length)throw Error('the setup plan must be a non-empty JSON array');
const saved={today:new Date().toISOString().slice(0,10)};
if(process.env.BRIEF_VERIFIER_AI_URL)saved.ai_url=process.env.BRIEF_VERIFIER_AI_URL;
const at=(value,field)=>String(field||'').split('.').filter(Boolean).reduce((current,key)=>current?.[key],value);
const fill=value=>{
 if(Array.isArray(value))return value.map(fill);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,fill(item)]));
 if(typeof value!=='string')return value;
 const exact=value.match(/^\{\{([^}]+)\}\}$/);
 if(exact){const found=at(saved,exact[1]);if(found===undefined)throw Error(`setup value ${exact[1]} was not captured`);return found;}
 return value.replace(/\{\{([^}]+)\}\}/g,(_,field)=>{const found=at(saved,field);if(found===undefined)throw Error(`setup value ${field} was not captured`);return String(found);});
};

for(const [index,step] of steps.entries()){
 if(!step||typeof step!=='object'||typeof step.path!=='string'||!step.path.startsWith('/api/'))throw Error(`setup step ${index+1} must name an /api/ path`);
 const method=String(step.method||'POST').toUpperCase();
 const requestBody=method==='GET'||method==='HEAD'?null:fill(step.body??{});
 const response=await fetch(new URL(step.path,base),{
  method,
  headers:{'content-type':'application/json'},
  ...(requestBody===null?{}:{body:JSON.stringify(requestBody)}),
 });
 const text=await response.text();
 fs.appendFileSync(logFile,JSON.stringify({step:index+1,name:step.name||'',method,path:step.path,request:requestBody,status:response.status,body:text})+'\n');
 const expected=step.expect?.status==null?null:Number(step.expect.status);
 if(expected==null?!response.ok:response.status!==expected)throw Error(`setup step ${index+1} returned HTTP ${response.status}${expected==null?'':`, expected ${expected}`}`);
 if(step.expect?.body_includes&&!text.includes(String(step.expect.body_includes)))throw Error(`setup step ${index+1} response did not include the expected text`);
 if(step.expect?.body_excludes&&text.includes(String(step.expect.body_excludes)))throw Error(`setup step ${index+1} response included excluded text`);
 let parsed=null;if(step.capture||step.expect?.json){try{parsed=JSON.parse(text);}catch{throw Error(`setup step ${index+1} returned no JSON to inspect`);}}
 for(const [name,field] of Object.entries(step.capture||{})){const value=at(parsed,field);if(value===undefined)throw Error(`setup step ${index+1} could not capture ${field}`);saved[name]=value;}
 for(const [field,want] of Object.entries(step.expect?.json||{}))if(JSON.stringify(at(parsed,field))!==JSON.stringify(fill(want)))throw Error(`setup step ${index+1} response did not match ${field}`);
}
