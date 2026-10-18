import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFile,spawnSync} from 'node:child_process';import {promisify} from 'node:util';import {localPath} from './local-path.mjs';
const runFile=promisify(execFile);
export async function subscriptionCommand(store,args){
 if(!Array.isArray(args)||!['meter','dashboard','review','ask','register','prices','set','help','--help','-h'].includes(args[0])||args.some(a=>typeof a!=='string'||a.length>2000))throw Error('Choose a supported subscription command');
 const output=args.indexOf('--out');if(output>=0){const target=localPath(store.root,args[output+1]||'');if(!target.startsWith(path.join(store.root,'observations','subscription-reviews')+path.sep)||!target.endsWith('.md'))throw Error('Save the review inside observations/subscription-reviews');}
 const script=fileURLToPath(new URL('../../tools/subscriptions.cjs',import.meta.url));
 if(args[0]==='set'){
   await store.waitForWriter();
   return store.withLock(()=>{const result=spawnSync(process.execPath,[script,...args],{cwd:store.root,env:{...process.env,GODSPEED_WORKSPACE:store.root},encoding:'utf8',timeout:10000,maxBuffer:5*1024*1024,windowsHide:true});if(result.error||result.status!==0)throw Error(String(result.stderr||result.error?.message||'Subscription register update failed').slice(0,500));return {result:result.stdout.trim()};});
 }
 try{const result=await runFile(process.execPath,[script,...args],{cwd:store.root,env:{...process.env,GODSPEED_WORKSPACE:store.root},encoding:'utf8',timeout:60000,maxBuffer:5*1024*1024,windowsHide:true});return {result:result.stdout.trim()};}
 catch(error){throw Error(String(error.stderr||error.message||'Subscription measurement failed').slice(0,500));}
}
