// Short storage stalls must not kill a working assistant. Persistent failures
// still trigger recovery, and the diagnostic survives the next launch.
//
// A slow answer is not a dead server. On 6 October 2026 a busy PC (seven test
// suites at once) made /health take longer than its 15 seconds; three checks
// later the notebook was killed, every restart read the whole workspace again
// under the same load, and after five the supervisor gave up and left the
// notebook down. So a notebook that is there but slow ('slow'), or that has not
// started listening since its launch ('refused' before its first answer), is
// restarted only after UNANSWERED_AFTER without any answer. One that answered
// and then stops listening, or answers that it is stuck, is restarted after
// three checks, as before.
export const UNANSWERED_AFTER=10*60000;
export class HealthMonitor {
 constructor(){this.failures=0;this.healthySince=null;this.history=[];this.unansweredSince=null;this.answered=false;}
 launched(){this.failures=0;this.healthySince=null;this.unansweredSince=null;this.answered=false;}
 failure(reason,now=Date.now(),kind='stuck'){
  this.healthySince=null;this.failures++;
  this.history=[...this.history,{at:new Date(now).toISOString(),reason}].slice(-20);
  this.unansweredSince??=now;
  const patient=kind==='slow'||kind==='refused'&&!this.answered;
  return {restart:patient?now-this.unansweredSince>=UNANSWERED_AFTER:this.failures>=3};
 }
 success(now=Date.now()){this.failures=0;this.unansweredSince=null;this.answered=true;this.healthySince??=now;}
 stablyHealthy(now=Date.now()){return this.healthySince!==null&&now-this.healthySince>=300000;}
}
// The heartbeat says "the server is alive and its event loop answers". Until
// 6 October 2026 it moved only when a scheduler tick or an AI call began or
// ended, and the supervisor took three minutes of silence for a stall: a
// routine or a chat longer than about four minutes was killed half way, and
// Hermes had already moved its next run to tomorrow. Now work in progress
// beats every half minute, for as long as its own time limit allows; work
// past that limit stops beating, so a wedged scheduler is still restarted.
export const HEARTBEAT_EVERY=30000;
// Above the longest single budget there is (a ten-minute chat), so even work
// that cannot beat is never taken for a stall while it is inside its budget.
export const STALL_AFTER=11*60000;
export function beatWhile(work,beat,{limitMs,every=HEARTBEAT_EVERY}={}){
 const deadline=Date.now()+limitMs;beat?.();
 const timer=setInterval(()=>{if(Date.now()<deadline)beat?.();},every);timer.unref?.();
 return Promise.resolve(work).finally(()=>{clearInterval(timer);beat?.();});
}
