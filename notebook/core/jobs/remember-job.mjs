import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runChild} from '../child-process.mjs';
import {NO_AI_CONNECT} from '../no-ai.mjs';
import {assistantConfiguration} from '../running-notebook.mjs';

const PROGRAM=fileURLToPath(new URL('../../scripts/memory-daily.mjs',import.meta.url));
// The same program, in its own process, that the Hermes routine runs. With no AI connected it exits 0
// having sent nothing. Its output is never put in the message: stderr may hold credentials.
export const hasAI=root=>{const {assistantFile,providerFile}=assistantConfiguration(root);return !!assistantFile||fs.existsSync(providerFile);};
export async function runRememberWhatYouSaid({store,run=runChild,connected=hasAI(store.root)}){
  if(!connected)throw new Error(NO_AI_CONNECT);
  let result;
  try{result=await run(process.execPath,[PROGRAM],{cwd:store.root,env:{...process.env,GODSPEED_WORKSPACE:store.root,GODSPEED_ROOT:store.root,GODSPEED_DIR:store.root,GODSPEED_SCHEDULED_RUN:'1'},timeoutMs:900000,maxBytes:1024*1024});}
  catch{throw new Error('Remember what you said could not finish.');}
  if(result?.code!==0)throw new Error('Remember what you said could not finish.');
  return {verified:true,silent:true};
}
