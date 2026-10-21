// The Charm Challenge in the notebook's own chat (spec 2026-10-21, "Where it works"): "start the
// Charm Challenge", a slip question, its yes or no and "charm slip" reach the charm add-on, the one
// owner of the count, through the same command /charm already runs (addonCommand). The answer is
// the command's own line, never the model's guess. The question after a slip belongs to the
// conversation that asked it, so the conversation is always this chat's own, "notebook:<id>", set
// by the notebook and never by the model (personal-operations.mjs conversationOperations).
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {addonCommand} from './native-personal.mjs';
import {charmState} from '../../third-party/addons/godspeed-charm/lib/count.mjs';
import {eventsFromItems,localDate} from '../../third-party/addons/godspeed-charm/lib/record.mjs';
import {loadSettings} from '../../third-party/addons/godspeed-charm/lib/settings.mjs';
import {now as clockNow} from '../../third-party/addons/godspeed-charm/lib/clock.mjs';
import {contextBlock} from '../../third-party/addons/godspeed-charm/lib/context.mjs';
import {pickLanguage} from '../../third-party/addons/godspeed-charm/lib/texts.mjs';

export const CHARM_ACTIONS=['start','status','asked','answer','slip','stop'];
// This chat's conversation as the challenge names it: "notebook:<the chat's id>" (the notebook's own
// chats already carry the "notebook:" prefix).
export const charmConversation=id=>{const s=String(id??'').trim();return !s?'':s.startsWith('notebook:')?s:'notebook:'+s;};
// en or de, the languages the add-on speaks; any other language is rewritten by the chat (inLanguage).
const spoken=value=>{const l=String(value??'').trim().slice(0,2).toLowerCase();return ['en','de'].includes(l)?l:null;};
const wordsOf=input=>String(input.words??input.source_quote??'').trim();
// The command line the add-on is given: the action, the answer, this chat's conversation, their
// words verbatim and the language. `wordsFile` replaces the words when they cannot travel as an
// argument (charmOperation).
export function charmArgs(input,conversation,{wordsFile}={}){
 const action=input.action;if(!CHARM_ACTIONS.includes(action))throw Error('Say what to do with the Charm Challenge: start, status, asked, answer, slip or stop');
 const conv=String(conversation??'').trim(),words=wordsOf(input);
 if(['asked','answer'].includes(action)&&!conv)throw Error('Only a chat in the notebook can ask or answer the Charm Challenge question; elsewhere the person says "charm slip"');
 if(action==='answer'&&!['yes','no'].includes(input.answer))throw Error('An answer to the Charm Challenge question is yes or no');
 const args=[action];
 if(action==='answer')args.push(input.answer);
 if(action!=='status'){
  if(conv)args.push('--conversation',conv);
  if(wordsFile)args.push('--words-file',wordsFile);else if(words)args.push('--words',words);
 }
 const language=spoken(input.language);if(language)args.push('--language',language);
 return args;
}
// The challenge as the notebook holds it: the oldest live tracker that names the charm specialist
// (as the add-on's own findTracker picks it), its rows read the way the add-on reads them, counted
// on the person's local day. `reader` is the store, or chat-context's snapshot of it.
export function charmNow(reader){
 const tracker=reader.list('collections').filter(c=>c.tracker&&typeof c.tracker==='object'&&c.tracker.specialist==='charm').sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))[0]||null;
 const settings=loadSettings(reader.root),today=localDate(clockNow(),settings.timezone);
 const events=tracker?eventsFromItems(reader.list('collection_items').filter(i=>i.collection_id===tracker.id)):[];
 return {state:charmState(events,today),settings,today,tracker};
}
// The [godspeed-charm] block for this chat, said as charm operations (the chat has no shell);
// null when no challenge runs and it is not the finish day.
export function charmBlock(reader,conversationId){
 const {state,settings,today}=charmNow(reader);
 return contextBlock(state,settings,{conversation:charmConversation(conversationId),today,channel:'notebook'})||null;
}
export function charmOperation(domains,input){
 const {store}=domains,conversation=charmConversation(input.conversation),words=wordsOf(input);
 // Words that start with a dash would be read as a flag, and a very long message is safest out of
 // the command line: both go in a file of their own, which the add-on reads as it is.
 const long=words.startsWith('-')||words.length>8000;let file=null;
 const language=spoken(input.language)||pickLanguage((()=>{try{return loadSettings(store.root).language;}catch{return 'en';}})());
 try{
  if(long&&input.action!=='status'){file=path.join(store.state,'charm-words',randomUUID()+'.txt');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,words);}
  const saved=JSON.parse(addonCommand(store,{addon:'charm',args:charmArgs(input,conversation,{wordsFile:file})}).result);
  return {ok:true,reply:saved.reply,state:saved.state,language};
 }catch(error){
  // A refusal (R4): nothing was written, and its reply is a plain sentence for the person, in the
  // language it carries when it has one of its own (the notebook's own refusals are English).
  if(error.refusal&&input.action!=='asked')return {ok:false,reply:error.refusal.reply,state:error.refusal.state,language:error.refusal.language||language};
  // The slip question is best-effort (R15): whatever stops it, the chat goes on without it.
  if(input.action==='asked')return {ok:false,reply:'',error:String(error?.message||error),language};
  throw error;
 }finally{if(file)fs.rmSync(file,{force:true});}
}
