#!/usr/bin/env node
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

async function main(){
 const check=await runChild(process.execPath,[model,'--workspace',root,'--check'],{cwd:root,env:process.env,timeoutMs:60000,maxBytes:65536});
 if(check.code!==0)return;
 const notebook=hasNotebookNote(root),store=notebook?new Store(root):null,query=store?new QueryService(store):null,domains=query?new Domains(query):null;
 const request=async input=>{const result=await runChild(process.execPath,[model,'--workspace',root],{cwd:root,env:process.env,input:JSON.stringify(input),timeoutMs:245000,maxBytes:1024*1024});if(result.code!==0)throw Error('model failed');return JSON.parse(result.stdout);};
 const state=await runChild(process.execPath,[due,'state','--json','--godspeed',root],{cwd:root,env:process.env,timeoutMs:120000,maxBytes:1024*1024});
 const deadlines=state.code===0?JSON.parse(state.stdout).filter(row=>row.state==='open'&&row.doneWhen):[];
 const close=async(slug,evidence)=>{const result=await runChild(process.execPath,[due,'done',slug,'--evidence',evidence,'--godspeed',root],{cwd:root,env:process.env,timeoutMs:120000,maxBytes:65536});return result.code===0;};
 const result=await rememberWhatYouSaid({root,store,query,domains,model:request,due:close,deadlines,notebook});
 if(result.failed&&result.completed===0)process.exitCode=1;
}
main().catch(()=>{process.exitCode=1;});
