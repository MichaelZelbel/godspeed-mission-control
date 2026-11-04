// The slip question in the notebook's chat panel (and every other chat the assistant answers through
// domains.nativeAgent). Hermes' own plugin (godspeed-charm/hermes/plugin) judges the messages that
// pass through it; this chat's turns are one-shot assistant runs, so the notebook asks the same
// judgement (`godspeed-charm judge`, lib/judge.mjs) while the assistant works, and acts on its
// verdict as the plugin does: the reply ends with the question, recorded as `asked`, or a plain
// yes or no is recorded as the `answer`. Best effort, as the model's own question is (R15): whatever
// goes wrong, the reply goes out as the assistant wrote it.
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {addonInvocation} from './native-personal.mjs';
import {JUDGE_PROTOCOL} from '../../third-party/addons/godspeed-charm/lib/judge.mjs';
import {runChild} from './child-process.mjs';
import {charmConversation,charmOperation} from './charm-operation.mjs';

// The seconds the judgement may take from the message's arrival; as in the plugin the variable exists for tests.
const judgeSeconds=()=>Number(process.env.GODSPEED_CHARM_JUDGE_SECONDS)||25;
// The word check after the limit gets the plugin's patience (its _timeout()), under the same variable, read
// as Python's float() reads it: unset, empty or not a number means five seconds; zero, less or NaN runs out
// at once (subprocess.run's does; runChild would set no timer for it); infinity, or more than a timer can
// hold, means no deadline (0 for runChild).
const DIGITS='\\d+(?:_\\d+)*',PYTHON_FLOAT=new RegExp('^[-+]?(?:inf(?:inity)?|nan|(?:'+DIGITS+'(?:\\.(?:'+DIGITS+')?)?|\\.'+DIGITS+')(?:e[-+]?'+DIGITS+')?)$','i');
export const wordCheckMs=()=>{
 const raw=(process.env.GODSPEED_CHARM_PLUGIN_TIMEOUT||'5').trim();
 const seconds=PYTHON_FLOAT.test(raw)?Number(raw.replace(/_/g,'').replace(/^([-+]?)inf(inity)?$/i,'$1Infinity')):5;
 if(!(seconds>0))return 1;
 const ms=seconds*1000;
 return ms>2147483647?0:ms;
};
const modelCommand=home=>{const file=path.join(home||'.','bin','godspeed-model'+(process.platform==='win32'?'.cmd':''));return fs.existsSync(file)?file:null;};
const verdictOf=stdout=>{
 for(const line of String(stdout).split('\n').reverse()){
  if(!line.trim().startsWith('{'))continue;
  let value;try{value=JSON.parse(line);}catch{continue;}
  if(value?.ok===true&&JUDGE_PROTOCOL.verdict.includes(value.verdict)&&JUDGE_PROTOCOL.source.includes(value.source)&&(value.verdict!=='answer'||JUDGE_PROTOCOL.answer.includes(value.answer)))return value;
 }
 return null;
};
const ending=(reply,question)=>reply.includes(question)?reply:reply.trimEnd()+'\n\n'+question;

// Starts the judgement of this message. `end(reply)` says what the reply becomes; `drop()` is for a
// turn that ends without one.
export function startCharmJudgement(domains,input){
 const began=Date.now(),words=String(input.message||'').trim(),conversation=charmConversation(input.conversation_id);
 const nothing={end:async reply=>reply,drop(){}};
 if(!words||!conversation)return nothing;
 const {store}=domains,file=path.join(store.state,'charm-words',randomUUID()+'.txt');
 const judge=async(extra,timeoutMs)=>{
  const {command,argv,cwd,env}=addonInvocation(store,{addon:'charm',args:['judge','--conversation',conversation,'--words-file',file,...extra]},{judge:true});
  const run=await runChild(command,argv,{cwd,env,timeoutMs,signal:input.signal});
  return run.code===0?verdictOf(run.stdout):null;
 };
 const drop=()=>fs.rmSync(file,{force:true});
 let verdict;
 try{
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,words);
  const model=modelCommand(domains.query?.nativeHermesHome);
  verdict=judge(model?['--model-command',model]:['--no-model'],judgeSeconds()*1000).catch(()=>null);
 }catch{drop();return nothing;}
 return {drop,async end(reply){
  try{
   // Past the limit, or no answer: the word check alone, as the plugin does.
   const v=await verdict||await judge(['--no-model'],wordCheckMs()).catch(()=>null);
   if(!v||v.verdict==='none')return reply;
   const done=charmOperation(domains,v.verdict==='answer'?{action:'answer',answer:v.answer,conversation,words,language:v.language}:{action:'asked',conversation,words,language:v.language});
   return done.ok&&done.reply?ending(reply,done.reply):reply;
  }catch{return reply;}
  finally{drop();}
 }};
}
