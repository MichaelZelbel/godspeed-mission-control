// ONE MODULE FOR EVERY AI PROVIDER OUTCOME (#861). Since November 2026 the wording of an AI failure
// was fixed one surface at a time, and each layer re-read the provider's raw words out of the error
// message with a regular expression to guess a category; a route none of them knew passed the raw
// words through, and an HTTP 402 was read as an outage. Now the cause is decided once, from the
// status and the answer's structured fields, attached to the error as `aiCause` where the provider
// is asked (core/runtime.mjs), and translated to the one sentence a person reads here.
//
// The six causes, the issue's own words:
//   refused      the key or sign-in was refused (HTTP 401 or 403, or the provider's own
//                refused-key code on another 4xx answer),
//   no-credit    the account is out of credit (HTTP 402, or the provider's own code for it),
//   busy         the service is busy or has reached a usage limit (HTTP 429),
//   unavailable  an outage: any 5xx whatever its body says, a network failure, a timeout,
//   stalled      the AI took the request and has not answered it,
//   unusable     an answer came but is not the shape asked for or not valid JSON.
//
// The sentences live in core/no-ai.mjs, the words file the browser already imports. The internal
// `message` of a provider error is never rewritten: routines' receipts, the backup's fallback and
// the existing tests read it as before. Only the sentence the person sees is built from the cause.
import {
  AI_REFUSED,AI_UNREACHABLE,AI_STALLED,AI_NO_CREDIT,AI_BUSY,AI_UNREADABLE,
  KEY_REFUSED,CONNECT_UNREACHABLE,AI_SERVICE_FAILED,AI_REQUEST_LIMITED,AI_REQUEST_REJECTED,CONNECT_NO_CREDIT,
} from './no-ai.mjs';

export const AI_CAUSES=['refused','no-credit','busy','unavailable','stalled','unusable'];

// The route's sentence for each cause.
const ROUTE_SENTENCES={refused:AI_REFUSED,'no-credit':AI_NO_CREDIT,busy:AI_BUSY,unavailable:AI_UNREACHABLE,stalled:AI_STALLED,unusable:AI_UNREADABLE};
// Messages that already say a cause in plain words: the sentences above and Godspeed's own
// no-AI answers, which a route may have thrown itself. plainAIError leaves them as they are.
const PLAIN=/^(?:No AI is connected yet|Your AI is connected only to the notebook|Your AI key or sign-in was refused|Your AI could not be reached|Your AI is not answering|Your AI service has no credit left|Your AI service is busy or has reached a usage limit|Your AI answered, but its answer could not be used)/;

// The status line the AI program prints for an HTTP answer from the provider behind it, the line
// providerReason (runtime.mjs) shortens for the log. Exported so there is one copy of the pattern.
export const STATUS_LINE=/\b(?:HTTP\s*|Error code:?\s*|status(?:_code)?[=: ]\s*)[45]\d\d\b/i;

// The provider's own codes that name the cause, read only from the answer's structured fields,
// never from its message prose: prose matching is what read a 500 that mentions invalid_api_key as
// a refusal (#833).
const REFUSED_CODES=/^(?:invalid_api_key|authentication_error|invalid_authentication|unauthorized)$/;
const NO_CREDIT_CODES=/^(?:insufficient_quota)$/;

// THE CAUSE OF AN HTTP ANSWER, from the status first, the body's structured fields second.
// body is the parsed JSON object, or null when the body was not JSON.
export function answerCause(status,body){
  const code=String(body?.error?.code||body?.error?.type||'');
  if(status===401||status===403)return 'refused';
  if(status===402)return 'no-credit';
  if(status===429)return NO_CREDIT_CODES.test(code)?'no-credit':'busy';
  // A 5xx is an outage whatever its body says: a body that names a refused key during an outage is
  // not a refusal, or a person with a working key would be told to replace it (#861 review).
  if(status>=500)return 'unavailable';
  if(REFUSED_CODES.test(code))return 'refused';
  if(NO_CREDIT_CODES.test(code))return 'no-credit';
  // Any other status (including a 408 and the 4xx the provider refused for a reason that is not
  // the key) is an outage too: today's wording calls those an outage as well.
  return 'unavailable';
}

// THE CAUSE OF WHAT THE AI PROGRAM PRINTED when it could not answer (Hermes, the assistant runtime).
// A context-limit text is its own kind of problem with its own sentence, said by
// hermesFailureMessage itself: null, so the cause is left off the error.
export function diagnosticCause(text){
  const diagnostic=String(text||'');
  if(/context length exceeded|context_length_exceeded|maximum context length|cannot compress further|(?:model )?input exceeds (?:the )?context (?:window|limit)/i.test(diagnostic))return null;
  const line=diagnostic.replace(/\x1b\[[0-9;]*m/g,'').split(/\r?\n/).map(l=>l.trim()).filter(l=>STATUS_LINE.test(l)).at(-1);
  if(line){
    const status=Number(/\b(?:HTTP\s*|Error code:?\s*|status(?:_code)?[=: ]\s*)([45]\d\d)\b/i.exec(line)?.[1]);
    // The line's own words stand in for the answer's body, which Hermes does not keep.
    if(status===401||status===403)return 'refused';
    if(status===402)return 'no-credit';
    if(status===429)return /insufficient_quota/i.test(diagnostic)?'no-credit':'busy';
    if(status<500&&/invalid_api_key|incorrect api key|authentication|unauthorized/i.test(diagnostic))return 'refused';
    if(status<500&&/insufficient_quota/i.test(diagnostic))return 'no-credit';
    return 'unavailable';
  }
  if(/insufficient_quota|insufficient credits/i.test(diagnostic))return 'no-credit';
  if(/rate_limit_exceeded|rate limit exceeded|too many requests|usage limit reached|quota exceeded/i.test(diagnostic))return 'busy';
  if(/authenticationerror|invalid_api_key|incorrect api key|token expired|unauthorized|authentication failed/i.test(diagnostic))return 'refused';
  return 'unavailable';
}

// An error that carries its cause, set at the boundary where the status and the answer are in hand.
// `detail` becomes the error's own cause (a fetch failure, a syntax error), kept for the server log.
export function aiFailed(cause,message,{status,detail}={}){
  return cause
    ?Object.assign(new Error(message,detail?{cause:detail}:undefined),{aiCause:cause,...(status!==undefined?{aiStatus:status}:{})})
    :new Error(message,detail?{cause:detail}:undefined);
}

// The provider's raw words a route may have wrapped in its own text: if such an error passes the
// shared handling without a cause, its own wording must not carry the provider's words (and its
// key) to the person (#861 review). The raw words themselves say the cause, so they are read here.
const RAW_PROVIDER=new RegExp('Model provider failed|Incorrect API key|invalid_api_key|insufficient_quota|rate limit exceeded|rate_limit|'+STATUS_LINE.source);

// The cause an error carries, read from aiCause first, or from raw provider words a route wrapped
// in its own text (a context limit reads as no cause, its own kind of problem). Null is no cause.
const causeOf=error=>{
  if(AI_CAUSES.includes(error?.aiCause))return error.aiCause;
  if(error instanceof Error&&RAW_PROVIDER.test(String(error.message||''))){const read=diagnosticCause(error.message);if(read)return read;}
  return null;
};

// THE SENTENCE A ROUTE ANSWERS WITH. Applied to every error a route can raise, so a route added
// later is worded by construction, not by being added to a list. An error without a cause (the
// notebook's own refusals, a stopped reply, a context limit) passes as it is, and one whose message
// already says a cause passes unchanged, so applying it twice changes nothing.
export function plainAIError(error){
  const cause=causeOf(error);if(!cause)return error;
  const message=String(error?.message||'');
  if(PLAIN.test(message))return error;
  return Object.assign(new Error(ROUTE_SENTENCES[cause],{cause:error}),{aiCause:cause,aiStatus:error.aiStatus});
}

// THE SENTENCE SETTINGS' CONNECTION TESTS ANSWER WITH ("Test and connect"): Settings' own words for
// each cause, chosen on the server now. A refused key, an outage and a 5xx keep the sentences the
// browser used to build from the raw status; an out-of-credit and a busy service gain their own.
export function connectionTestError(error){
  const cause=causeOf(error);if(!cause)return error;
  const sentence=cause==='refused'?KEY_REFUSED
    :cause==='no-credit'?CONNECT_NO_CREDIT
    :cause==='busy'?AI_REQUEST_LIMITED
    :cause==='stalled'?AI_STALLED
    :cause==='unusable'?AI_UNREADABLE
    :error.aiStatus===408||error.aiStatus>=500?AI_SERVICE_FAILED
    :error.aiStatus?AI_REQUEST_REJECTED
    :CONNECT_UNREACHABLE;
  // The sentence is the last word: it carries no aiCause, so a later plainAIError leaves it as it is.
  return new Error(sentence,{cause:error});
}

// EVERY ROUTE THAT CALLS THE AI, for the server test that drives every outcome through every one
// of them: the AI-calling function names come from the dispatch owner itself (core/domains.mjs,
// published beside its branches), and this module keeps only the routes outside the generic
// /api/functions/ dispatch. Translation does not depend on the list (plainAIError is applied to
// every route's errors by construction); the list exists so a new AI route is included or the test
// fails: a function published without a fixture fails the test, and an AI route outside the
// generic dispatch is added to the list here, in the file that owns the wording.
const AI_ROUTES_OUTSIDE_FUNCTIONS=Object.freeze(['/api/browser-chat','/api/provider','/api/backup-ai']);
let aiFunctionNames=null;
export function publishAIFunctions(names){aiFunctionNames=Object.freeze([...names]);}
export function aiRoutes(){
  if(!aiFunctionNames)throw new Error('The AI-calling functions are not published (core/domains.mjs publishes them beside its dispatch)');
  return Object.freeze([...aiFunctionNames.map(name=>'/api/functions/'+name),...AI_ROUTES_OUTSIDE_FUNCTIONS]);
}
