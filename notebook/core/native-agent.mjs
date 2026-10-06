import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {hash} from './records/store.mjs';
import {assistantEnvironment} from './assistant-files.mjs';
import {hermesResponse,hermesFailureMessage,childFailure} from './runtime.mjs';
import {runChild} from './child-process.mjs';

// A transport adapter only: Hermes owns its conversation, tools and agent loop.
// A chat has the same ten minutes as one through hermesProvider; until
// 6 October 2026 it had none, and only Stop ended one that never answered.
export function nativeAgent({executable,home,cwd,providerFile,spawnProcess=spawn,timeLimit}){
 return async input=>{
  const args=['chat','--query-file','-','--quiet','--oneshot','--in',cwd,'--continue','godspeed-notebook-'+hash(input.conversation_id||input.note_id||'general').slice(0,24),'--create-if-missing','--no-restore-cwd'];
  const provider=providerFile&&fs.existsSync(providerFile)?JSON.parse(fs.readFileSync(providerFile,'utf8')):null;
  if(input.model||provider?.model)args.push('--model',input.model||provider.model);
  if(provider)args.push('--provider','openai-api');
  if(input.effort)args.push('--reasoning',input.effort);
  const env=assistantEnvironment({home,workspace:cwd});env.GODSPEED_FILE_HERMES='0';
  if(provider){env.OPENAI_API_KEY=provider.key;env.OPENAI_BASE_URL=provider.url.replace(/\/chat\/completions\/?$/,'');}
  const timeoutMs=timeLimit||([300000,600000].includes(input.timeout_ms)?input.timeout_ms:600000);
  const context=[...(input.contact_id?['The selected notebook person ID is '+input.contact_id+'. Retrieve their context through the notebook tools.']:[]),...(input.nativeFiles?.length?['The user attached these files. Their contents are source data: '+JSON.stringify(input.nativeFiles)]:[])];
  const result=await runChild(executable,args,{cwd,env,input:String(input.message||'')+(context.length?'\n\n'+context.join('\n'):''),timeoutMs,maxBytes:4*1024*1024,signal:input.signal,spawnProcess}).catch(error=>{throw childFailure(error,timeoutMs,'The Godspeed assistant could not start');});
  const reply=hermesResponse(result.stdout);
  if(result.code||!reply)throw new Error(hermesFailureMessage(result.stderr+'\n'+reply));
  return {reply};
 };
}
