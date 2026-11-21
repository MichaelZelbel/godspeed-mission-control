import {aiFailure} from './ai-health.mjs';
// What Godspeed says when no AI is connected yet. It names the place where one is connected in the
// words the Settings page uses ("Settings, Your AI"), so a person knows where to go (#552; until
// 14 November 2026 it said "Choose and configure a model provider", which named no place).
export const NO_AI_STATUS='No AI is connected yet';
// The chats' status lines for a refused key and an outage (#590). Settings, Your AI begins its own
// messages for the same states with them, so both say the same thing (#763).
export const AI_REFUSED_STATUS='Your AI key or sign-in was refused';
export const AI_UNREACHABLE_STATUS='Your AI could not be reached';
// The chats' status line for an AI that took a request and has not answered it, which is not an
// outage (#808).
export const AI_STALLED_STATUS='Your AI is not answering';
export const SETTINGS_ONLY_AI_STATUS='Your AI is connected only to the notebook';
// What Settings, Your AI says when the saved AI connection exists but cannot be read (#826), and
// what the chats say for the same state, so the two agree while the notebook runs.
export const AI_CONNECTION_UNREADABLE_STATUS='The saved AI connection could not be read.';
export const SETTINGS_ONLY_AI_HELP='Tick “Use it for the daily routines and the chat too” in Settings, Your AI.';
export const NO_AI_CHAT=NO_AI_STATUS+'. Connect your AI service in Settings, Your AI, then ask Godspeed again.';
export const NO_AI_ANALYSIS='No AI is connected yet. Connect your AI service in Settings, Your AI, before analysis.';

// What an AI action outside the chats says when the AI fails (#774): Suggest, Create collection
// with AI and My Profile's suggestions said the provider's own words ("Model provider failed with
// HTTP 401..."). They say what the chats say (server/main.mjs, #590): a refused key or sign-in, or
// an outage, each with where to fix it. Only the category is said, never the provider's words, so
// no status number and no key can reach the screen. A failure that is not the AI's passes as it is,
// and so does Godspeed's own "No AI is connected yet" (or "connected only to the notebook"): those
// say "Connect your AI service", which the pattern below would otherwise read as an outage.
export const AI_REFUSED='Your AI key or sign-in was refused. Check it in Settings, Your AI, then try again.';
export const AI_UNREACHABLE='Your AI could not be reached. Check its connection in Settings, Your AI, then try again.';
const PROVIDER_FAILURE=/model provider|AI service|assistant runtime|Hermes|fetch failed|HTTP [45]\d\d|could not be reached|did not finish within|did not answer|needs sign-in|returned no text|connection could not start/i;
export function analysisFailure(error){
  const message=String(error?.message||error||''),kind=PROVIDER_FAILURE.test(message)?aiFailure(error):null;
  if(!kind||message===AI_REFUSED||message===AI_UNREACHABLE||message.startsWith(NO_AI_STATUS)||message.startsWith(SETTINGS_ONLY_AI_STATUS))return error;
  return new Error(kind==='refused'?AI_REFUSED:AI_UNREACHABLE);
}

// What an AI action says when the AI answered but its answer is not in the shape the action needs
// (#792): Suggest said "The assistant returned an invalid proposal list", Create collection with AI
// "Return one complete JSON object", and the analysis actions "The request or a saved file was not
// valid JSON." for an AI that answered "Connected.". It is thrown where the AI's reply is read, never
// for a request or a saved file of the notebook's own, which keep their own messages. What was wrong
// with the reply is kept as the error's cause, for the server log.
export const AI_UNREADABLE='Your AI answered, but its answer could not be used. Try again, or choose another model in Settings, Your AI.';
export const unreadableReply=cause=>new Error(AI_UNREADABLE,cause?{cause}:undefined);
// The AI's reply as the JSON object an action asked for, fenced or not; a reply that is not one is
// the unreadable reply above.
export function readReply(result){
  if(typeof result!=='string')return result;
  try{return JSON.parse(result.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch(error){throw unreadableReply(error);}
}
