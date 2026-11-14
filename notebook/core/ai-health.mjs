// WHETHER THE CONNECTED AI CAN BE USED (#573, 14 November 2026). The Dashboard said "Ready to chat"
// with a key the AI refused and with the AI stopped: it only knew that an AI was set up. Each answer
// of the notebook's own calls now clears the problem, and each refused key or unreachable AI (an
// error with aiProblem, core/runtime.mjs) sets it. While the Dashboard card is open it asks again, with
// the provider's own smallest request, once what it knows is older than a recheck interval: shorter
// while there is a problem, so a key that works again shows soon.
export class AIHealth{
 constructor({okRecheckMs=30000,problemRecheckMs=10000,now=Date.now}={}){
  Object.assign(this,{okRecheckMs,problemRecheckMs,now,problem:null,checkedAt:0,generation:0,checking:null});
 }
 answered(){this.problem=null;this.checkedAt=this.now();}
 failed(error){if(!error?.aiProblem)return;this.problem=error.message;this.checkedAt=this.now();}
 // Another AI was connected: nothing known about the old one counts, nor a check still under way.
 reset(){this.generation++;this.problem=null;this.checkedAt=0;this.checking=null;}
 watch(provider){
  if(!provider)return provider;
  const run=async input=>{
   const generation=this.generation;
   try{const answer=await provider(input);if(generation===this.generation)this.answered();return answer;}
   catch(error){if(generation===this.generation)this.failed(error);throw error;}
  };
  return Object.assign(run,provider);
 }
 // check: resolves to the problem as an error, or null when the AI works.
 refresh(check){
  const wait=this.problem?this.problemRecheckMs:this.okRecheckMs;
  if(this.checking||this.now()-this.checkedAt<wait)return this.checking;
  const generation=this.generation;
  const checking=this.checking=Promise.resolve().then(check).then(problem=>{if(generation!==this.generation)return;if(problem)this.failed(problem);else this.answered();},()=>{})
   .finally(()=>{if(this.checking===checking)this.checking=null;});
  return checking;
 }
}
