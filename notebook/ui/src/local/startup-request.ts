export const busyServerMessage='Your server is busy saving and did not answer in time. Try again in a moment.';

const QUERY_TIMEOUT_MS=15000;
const READY_TIMEOUT_MS=15000;
const READY_REQUEST_TIMEOUT_MS=1000;
const READY_POLL_MS=250;

type RequestOperation=(signal:AbortSignal)=>Promise<Response>;

const pause=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

export async function startupRequest(operation:RequestOperation):Promise<Response>{
  try{return await operation(AbortSignal.timeout(QUERY_TIMEOUT_MS));}
  catch{
    const deadline=Date.now()+READY_TIMEOUT_MS;
    while(Date.now()<deadline){
      let ready=false;
      try{
        ready=(await fetch('/ready',{signal:AbortSignal.timeout(Math.min(READY_REQUEST_TIMEOUT_MS,deadline-Date.now()))})).ok;
      }catch{}
      if(ready){
        try{return await operation(AbortSignal.timeout(QUERY_TIMEOUT_MS));}
        catch{throw new Error(busyServerMessage);}
      }
      await pause(Math.min(READY_POLL_MS,Math.max(0,deadline-Date.now())));
    }
    throw new Error(busyServerMessage);
  }
}
