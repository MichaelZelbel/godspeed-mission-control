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
// Out of credit and busy or limited (#861). Until #861 an HTTP 402 was read as an outage and a
// 429 as whatever the one surface it reached said, because no surface knew the cause.
export const AI_NO_CREDIT_STATUS='Your AI service has no credit left';
export const AI_BUSY_STATUS='Your AI service is busy or has reached a usage limit';
export const SETTINGS_ONLY_AI_STATUS='Your AI is connected only to the notebook';
export const SETTINGS_ONLY_AI_HELP='Tick “Use it for the daily routines and the chat too” in Settings, Your AI.';
export const NO_AI_CHAT=NO_AI_STATUS+'. Connect your AI service in Settings, Your AI, then ask Godspeed again.';
export const NO_AI_ANALYSIS='No AI is connected yet. Connect your AI service in Settings, Your AI, before analysis.';

// What an AI route answers with when the AI fails (#774): a refused key or sign-in, an outage, a
// stalled AI, an answer that could not be used, no credit left, or a busy or limited service
// (#861). Each begins with its status line, the pattern the browser matches on
// (moment-form.mjs aiFailureKind, ChatConnectionEmptyState.tsx). Only the category is said, never
// the provider's words, so no status number and no key can reach the screen. The cause travels on
// the error as aiCause, set where the provider is asked (core/runtime.mjs), and core/ai-outcome.mjs
// picks the sentence; no route builds its own AI error text.
export const AI_REFUSED='Your AI key or sign-in was refused. Check it in Settings, Your AI, then try again.';
export const AI_UNREACHABLE='Your AI could not be reached. Check its connection in Settings, Your AI, then try again.';
export const AI_STALLED=AI_STALLED_STATUS+'. Try again in a moment, or check it in Settings, Your AI.';
export const AI_NO_CREDIT=AI_NO_CREDIT_STATUS+'. Add credit with the service, or choose another service in Settings, Your AI, then try again.';
export const AI_BUSY=AI_BUSY_STATUS+'. Try again in a few minutes, or check your account with the service.';

// What an AI action says when the AI answered but its answer is not in the shape the action needs
// (#792): Suggest said "The assistant returned an invalid proposal list", Create collection with AI
// "Return one complete JSON object", and the analysis actions "The request or a saved file was not
// valid JSON." for an AI that answered "Connected.". It is thrown where the AI's reply is read, never
// for a request or a saved file of the notebook's own, which keep their own messages. What was wrong
// with the reply is kept as the error's cause, for the server log.
export const AI_UNREADABLE='Your AI answered, but its answer could not be used. Try again, or choose another model in Settings, Your AI.';
export const unreadableReply=cause=>Object.assign(new Error(AI_UNREADABLE,cause?{cause}:undefined),{aiCause:'unusable'});
// The AI's reply as the JSON object an action asked for, fenced or not; a reply that is not one is
// the unreadable reply above.
export function readReply(result){
  if(typeof result!=='string')return result;
  try{return JSON.parse(result.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch(error){throw unreadableReply(error);}
}

// What Settings' own connection tests say ("Test and connect" for the main AI and the backup),
// carried here from ConnectAI.tsx (#861): the server picks the sentence from the AI outcome now
// (core/ai-outcome.mjs connectionTestError), so the raw "Model provider failed with HTTP 403" no
// longer has to reach the browser for it to be worded. The provider's text is dropped: it can quote
// part of the key. They are Settings' own words, not the routes' sentences above: a wrong model name
// (a 4xx) is the most common mistake here and deserves its own hint.
export const KEY_REFUSED=AI_REFUSED_STATUS+'. The service did not accept this key. Check it, or replace it with a new key from your AI service, then try again.';
export const CONNECT_UNREACHABLE=AI_UNREACHABLE_STATUS+'. Nothing answered at its address. Check that this computer is online and that the address is right, then try again.';
export const AI_SERVICE_FAILED='Your AI service had a problem on its side and did not answer. Your key was not refused. Try again in a few minutes.';
export const AI_REQUEST_LIMITED='Your AI service turned the request away for now, often because of a usage limit or no credit left. Check your account with the service, then try again.';
export const AI_REQUEST_REJECTED='Your AI service did not accept the request. Check the model name and the address, then try again.';
export const CONNECT_NO_CREDIT=AI_NO_CREDIT_STATUS+'. Add credit with the service, then try again.';
