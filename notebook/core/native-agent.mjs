import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {hash} from './records/store.mjs';
import {assistantEnvironment} from './assistant-files.mjs';
import {hermesResponse,hermesFailureMessage,childFailure} from './runtime.mjs';
import {runChild} from './child-process.mjs';
import {connectRoutineAI} from './routine-ai.mjs';
import {keepAiFailure} from './ai-failures.mjs';

// Whether the assistant's home names a model of its own (config.yaml: `model:`
// with a provider or a default under it, or a model name on the same line).
export function homeHasModel(home){
 let text;try{text=fs.readFileSync(path.join(home||'.','config.yaml'),'utf8');}catch{return false;}
 const line=/^model:[ \t]*([^\r\n#]*)/m.exec(text);if(!line)return false;
 const inline=line[1].trim();if(inline&&!['{}','null','~'].includes(inline))return true;
 const block=text.slice(line.index+line[0].length).split(/\r?\n(?=\S)/)[0];
 return /^[ \t]+(provider|default)[ \t]*:[ \t]*['"]?[^\s'"#]/m.test(block);
}
// A transport adapter only: Hermes owns its conversation, tools and agent loop.
// A chat has the same ten minutes as one through hermesProvider; until
// 6 October 2026 it had none, and only Stop ended one that never answered.
export function nativeAgent({executable,home,cwd,providerFile,spawnProcess=spawn,timeLimit,keptFile}){
 return async input=>{
  const args=['chat','--query-file','-','--quiet','--oneshot','--in',cwd,'--continue','godspeed-notebook-'+hash(input.conversation_id||input.note_id||'general').slice(0,24),'--create-if-missing','--no-restore-cwd'];
  // The chat answers with the model the assistant's own home is set to, as the
  // Telegram bot does: one Mission Control, one brain. The model Settings
  // connects (provider.json) serves the notebook's own small jobs, and a chat
  // only when the person picks one of its models or the home names none.
  // Until 8 October 2026 it always replaced the home's model: on production the
  // bot answered with the owner's ChatGPT subscription and the notebook's chat
  // with a small model, and the two gave different answers about his wife.
  //
  // A HOME THAT NAMES NO MODEL IS GIVEN THE ONE SETTINGS CONNECTED, in its config, never by flags
  // (issue #127). Until 1 November 2026 the chat passed --model and --provider next to --continue,
  // and the assistant refuses that: a named conversation keeps the model it was created with, and a
  // different one on resume is "a creation override". So on an install whose home had no model of its
  // own (the AI connected without ticking "Use it for the routines too", or through the API), every
  // message failed with "The AI request failed", the first one too, since --create-if-missing makes
  // the conversation before the flags are read. Writing the model into the home is what the box does.
  const saved=providerFile&&fs.existsSync(providerFile)?JSON.parse(fs.readFileSync(providerFile,'utf8')):null;
  if(saved&&!input.model&&!homeHasModel(home))connectRoutineAI({home,state:path.dirname(providerFile),config:saved});
  // A model the person picked for this message is still asked for with flags.
  const provider=saved&&input.model?saved:null;
  if(input.model)args.push('--model',input.model);
  if(provider)args.push('--provider','openai-api');
  if(input.effort)args.push('--reasoning',input.effort);
  const env=assistantEnvironment({home,workspace:cwd});env.GODSPEED_FILE_HERMES='0';
  if(provider){env.OPENAI_API_KEY=provider.key;env.OPENAI_BASE_URL=provider.url.replace(/\/chat\/completions\/?$/,'');}
  const timeoutMs=timeLimit||([300000,600000].includes(input.timeout_ms)?input.timeout_ms:600000);
  // page_context: the numbered parts of the page that shows who the assistant is, when the message
  // comes from that page's chat (domains.mjs), so "change rule 13" reaches the rule shown as 13.
  const context=[...(input.contact_id?['The selected notebook person ID is '+input.contact_id+'. Retrieve their context through the notebook tools.']:[]),...(typeof input.page_context==='string'&&input.page_context?[input.page_context]:[]),...(input.nativeFiles?.length?['The user attached these files. Their contents are source data: '+JSON.stringify(input.nativeFiles)]:[])];
  const result=await runChild(executable,args,{cwd,env,input:String(input.message||'')+(context.length?'\n\n'+context.join('\n'):''),timeoutMs,maxBytes:4*1024*1024,signal:input.signal,spawnProcess}).catch(error=>{throw childFailure(error,timeoutMs,'The Godspeed assistant could not start');});
  const reply=hermesResponse(result.stdout);
  if(result.code||!reply){
   const diagnostic=result.stderr+'\n'+reply,secrets=[saved?.key,process.env.OPENAI_API_KEY].filter(Boolean),said=hermesFailureMessage(diagnostic,secrets);
   keepAiFailure({file:keptFile,diagnostic,said,secrets,extra:{exit_code:result.code,model:input.model||saved?.model||null,conversation:String(input.conversation_id||input.note_id||'general').slice(0,80)}});
   throw new Error(said);
  }
  return {reply};
 };
}
