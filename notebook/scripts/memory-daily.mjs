#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runChild} from '../core/child-process.mjs';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {hasNotebookNote} from '../core/notebook-note.mjs';
import {rememberWhatYouSaid} from '../core/memory-daily.mjs';

const root=process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_ROOT||process.cwd();
const model=fileURLToPath(new URL('../bin/godspeed-model.mjs',import.meta.url));
const due=fileURLToPath(new URL('../../tools/due.js',import.meta.url));

const configuredModel=root=>fs.existsSync(path.join(root,'.godspeed','assistant.json'))||fs.existsSync(path.join(root,'.godspeed','provider.json'));

export async function main({root:workspace=root,modelCommand=model,dueCommand=due}={}){
 const check=await runChild(process.execPath,[modelCommand,'--workspace',workspace,'--check'],{cwd:workspace,env:process.env,timeoutMs:60000,maxBytes:65536});
 if(check.code!==0){if(!configuredModel(workspace))return {skipped:true};throw Error('The configured Godspeed model could not be checked');}
 const notebook=hasNotebookNote(workspace),store=notebook?new Store(workspace):null,query=store?new QueryService(store):null,domains=query?new Domains(query):null;
 const request=async input=>{const result=await runChild(process.execPath,[modelCommand,'--workspace',workspace],{cwd:workspace,env:process.env,input:JSON.stringify(input),timeoutMs:245000,maxBytes:1024*1024});if(result.code!==0)throw Error('model failed');return JSON.parse(result.stdout);};
 const state=await runChild(process.execPath,[dueCommand,'state','--json','--godspeed',workspace],{cwd:workspace,env:process.env,timeoutMs:120000,maxBytes:1024*1024});
 if(state.code!==0)throw Error('The deadline state could not be read');
 let deadlines;try{const rows=JSON.parse(state.stdout);if(!Array.isArray(rows))throw Error();deadlines=rows.filter(row=>row&&row.state==='open'&&typeof row.doneWhen==='string'&&row.doneWhen.trim());}catch{throw Error('The deadline state could not be read');}
 const close=async(slug,evidence)=>{const result=await runChild(process.execPath,[dueCommand,'done',slug,'--evidence',evidence,'--godspeed',workspace],{cwd:workspace,env:process.env,timeoutMs:120000,maxBytes:65536});return result.code===0;};
 return rememberWhatYouSaid({root:workspace,store,query,domains,model:request,due:close,deadlines,notebook});
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().then(result=>{if(result.failed&&result.completed===0)process.exitCode=1;}).catch(()=>{process.exitCode=1;});
