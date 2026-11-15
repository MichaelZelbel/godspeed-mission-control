#!/usr/bin/env node
import fs from 'node:fs';

const usage='usage: node notebook/scripts/brief-verifier-setup.mjs <notebook-url> <setup-plan.json> <result-log.jsonl>';
const base=new URL(process.argv[2]||'http://invalid');
const planFile=process.argv[3];
const logFile=process.argv[4];
if(!planFile||!logFile||!['127.0.0.1','localhost','::1'].includes(base.hostname))throw Error(usage);
const steps=JSON.parse(fs.readFileSync(planFile,'utf8'));
if(!Array.isArray(steps)||!steps.length)throw Error('the setup plan must be a non-empty JSON array');

for(const [index,step] of steps.entries()){
 if(!step||typeof step!=='object'||typeof step.path!=='string'||!step.path.startsWith('/api/'))throw Error(`setup step ${index+1} must name an /api/ path`);
 const method=String(step.method||'POST').toUpperCase();
 const response=await fetch(new URL(step.path,base),{
  method,
  headers:{'content-type':'application/json'},
  ...(method==='GET'||method==='HEAD'?{}:{body:JSON.stringify(step.body??{})}),
 });
 const text=await response.text();
 fs.appendFileSync(logFile,JSON.stringify({step:index+1,name:step.name||'',method,path:step.path,status:response.status,body:text})+'\n');
 if(!response.ok)throw Error(`setup step ${index+1} returned HTTP ${response.status}`);
}
