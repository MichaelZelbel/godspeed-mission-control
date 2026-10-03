// Short storage stalls must not kill a working assistant. Persistent failures
// still trigger recovery, and the diagnostic survives the next launch.
export class HealthMonitor {
 constructor(){this.failures=0;this.healthySince=null;this.history=[];}
 launched(){this.failures=0;this.healthySince=null;}
 failure(reason,now=Date.now()){
  this.healthySince=null;this.failures++;
  this.history=[...this.history,{at:new Date(now).toISOString(),reason}].slice(-20);
  return {restart:this.failures>=3};
 }
 success(now=Date.now()){this.failures=0;this.healthySince??=now;}
 stablyHealthy(now=Date.now()){return this.healthySince!==null&&now-this.healthySince>=300000;}
}
