#!/usr/bin/env node
// Installed as <server>/.godspeed/model.mjs. A host add-on reaches the same
// assistant inside this installation's container without a new network service.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

export const INNER_WORKSPACE='/opt/data/full-candidate/workspace';
export function dockerModelArgs(root,args){
 const marker=JSON.parse(fs.readFileSync(path.join(root,'.godspeed','model-host.json'),'utf8'));
 if(Object.keys(marker).sort().join(',')!=='format,kind,service,workspace'||marker.format!==1||marker.kind!=='godspeed-docker'||marker.service!=='godspeed'||marker.workspace!==INNER_WORKSPACE||!fs.existsSync(path.join(root,'compose.yaml')))throw Error('This folder is not a connected Godspeed server installation');
 let describe=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--workspace'){
   if(!args[i+1]||fs.realpathSync(args[++i])!==fs.realpathSync(root))throw Error('The model command belongs to a different Godspeed server installation');
  }else if(['--check','--describe'].includes(args[i]))describe=true;
  else throw Error('Use the installed Godspeed model command with --workspace and optional --check');
 }
 if(args.filter(arg=>arg==='--workspace').length>1)throw Error('Choose exactly one Godspeed workspace');
 return ['compose','-p','godspeed-mission-control','--project-directory',root,'-f',path.join(root,'compose.yaml'),'--env-file',path.join(root,'.env'),'exec','-T','--user','hermes','godspeed','timeout','245','node','/opt/godspeed/kit/notebook/bin/godspeed-model.mjs','--workspace',INNER_WORKSPACE,...(describe?['--check']:[])];
}
export async function dockerModelMain(root,args){
 const commandArgs=dockerModelArgs(root,args),describe=commandArgs.at(-1)==='--check';let input='';
 process.stdin.setEncoding('utf8');
 if(!describe)for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>600000)throw Error('The model request is too large');}
 const budget=describe?20000:(JSON.parse(input).timeout_ms??120000);
 if(!Number.isInteger(budget)||budget<1000||budget>240000)throw Error('Choose a supported model request budget');
 const docker=['/usr/bin/docker','/usr/local/bin/docker'].find(file=>fs.existsSync(file));if(!docker)throw Error('Docker was not found for this Godspeed server');
 await new Promise((resolve,reject)=>{
  const child=spawn(docker,commandArgs,{stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true});let output=0,errors=0;
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('The Godspeed server model request exceeded its limit'));},budget+5000);
  child.on('error',()=>{clearTimeout(timer);reject(Error('The Godspeed server model command could not start'));});
  child.stdout.on('data',chunk=>{output+=chunk.length;if(output>1024*1024){child.kill('SIGKILL');reject(Error('The Godspeed model answer exceeded its limit'));}else process.stdout.write(chunk);});
  child.stderr.on('data',chunk=>{errors+=chunk.length;if(errors<=32768)process.stderr.write(chunk);});
  child.stdin.on('error',()=>{});child.stdin.end(input);
  child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('The Godspeed server model connection could not answer'));});
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 dockerModelMain(root,process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
