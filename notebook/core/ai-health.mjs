// WHAT THE AI'S NEWEST ANSWER SAYS ABOUT IT (#590). Every place that shows whether the AI can be
// used (the chats, their model pickers and the Dashboard card) reads one state from here:
//   'ready'       the AI answered,
//   'refused'     the provider refused the key or sign-in (HTTP 401 or 403, or Hermes saying so),
//   'unreachable' an outage: a timeout, a provider error, no route, or no answer at all yet,
//   'unknown'     nothing has been asked since the notebook started.
// The newest request to settle wins, whether it was a connection check or a real chat request, so
// a chat that just failed is not overruled by an older check, and recovery shows at once.
//
// A connection check that gets no answer within `waitMs` counts as an outage then, instead of after
// the request's own 15 seconds: the chats read the state every second and must show a provider that
// stopped answering within about five seconds. The request itself keeps running until its own limit;
// a check that arrives within the wait shares it instead of asking the provider again; once the wait
// has run out, the next check asks again. Until a check has answered, and while the AI's last answer
// took longer than `waitMs`, the wait is at least `firstWaitMs`: a working AI that takes 4 to 6
// seconds, varying from check to check, must not read as an outage (#788), and one that never answers
// still reads as one within that longer wait.
//
// Nothing from the provider's answer is kept: only the category. Keys never reach this file.

export const AI_HEALTH_WAIT_MS=3000;
export const AI_HEALTH_FIRST_WAIT_MS=8000;

const REFUSED=/HTTP (?:401|403)\b|needs sign-in|authenticationerror|invalid_api_key|incorrect api key|token expired|unauthorized|authentication failed/i;
// Failures of the request itself, not of the AI: they say nothing about whether it can be reached.
const NOT_THE_AI=/document-capable model endpoint|Reply stopped/i;

/** What a failed provider request says about the AI: 'refused', 'unreachable', or null (nothing). */
export function aiFailure(error){
  const message=String(error?.message||error||'');
  if(NOT_THE_AI.test(message))return null;
  return REFUSED.test(message)?'refused':'unreachable';
}

export function trackAIHealth(inner,{waitMs=AI_HEALTH_WAIT_MS,firstWaitMs=AI_HEALTH_FIRST_WAIT_MS,initial='unknown'}={}){
  if(typeof inner!=='function')return inner;
  if(inner.health)return inner;
  let state=initial,started=0,settled=0,pending=null,pendingSince=0,slowest=null;
  // A provider that is slow but answers is given a second more than its last answer took, up to
  // the check's own 15 seconds, so it does not flicker between ready and an outage.
  const wait=()=>Math.min(15000,Math.max(waitMs,slowest===null||slowest>waitMs?firstWaitMs:0,slowest?slowest+1000:0));
  const settle=(order,value)=>{if(value&&order>=settled){settled=order;state=value;}};
  const run=async input=>{
    const order=++started;
    try{const answer=await inner(input);settle(order,'ready');return answer;}
    catch(error){if(!input?.signal?.aborted)settle(order,aiFailure(error));throw error;}
  };
  Object.assign(run,inner);
  run.health=()=>state;
  if(typeof inner.check==='function'){
    run.check=async()=>{
      const order=++started;
      // A check younger than the wait is shared; an older one is left to end on its own time limit,
      // so a provider that answers again is seen at the next check, not after the stalled one gives up.
      if(!pending||Date.now()-pendingSince>=wait()){
        const since=pendingSince=Date.now();
        pending=Promise.resolve().then(()=>inner.check()).then(()=>{slowest=Date.now()-since;return {ok:true};},error=>({ok:false,error}));
        const mine=pending;mine.finally(()=>{if(pending===mine)pending=null;});
      }
      const request=pending,left=Math.max(0,wait()-(Date.now()-pendingSince));
      let timer;
      const late=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),left);});
      const result=await Promise.race([request,late]).finally(()=>clearTimeout(timer));
      if(!result){
        // Its wait has run out, so the next check asks again. This does not trust the clock: a timer
        // may fire a millisecond before Date.now() says the wait is over (#785), and a check that
        // shared the stalled request then would time out at once.
        if(pending===request)pending=null;
        settle(order,'unreachable');
        // When the slow answer does arrive, it is the newest word on the AI unless something newer settled.
        void request.then(late=>settle(order,late.ok?'ready':aiFailure(late.error)));
        throw new Error('The AI did not answer the connection check within '+Math.round(wait()/1000)+' seconds.');
      }
      if(result.ok){settle(order,'ready');return;}
      settle(order,aiFailure(result.error));
      throw result.error;
    };
  }
  return run;
}
