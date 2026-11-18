import {domainToASCII} from 'node:url';
import {hash} from './records/store.mjs';
import {outboundFetch} from './outbound-fetch.mjs';

const INTERVAL=6*60*60*1000;
const USER_AGENT='Godspeed-Mission-Control-Domain-Watch';
const MAX_DELIVERY_LENGTH=4000;
const advice={
  available:'it can be registered now, at any registrar',
  'pending delete':'it is released in about five days; a backorder service can try to catch it',
  redemption:'the owner can still renew it for about 30 days',
  registered:'it is registered again'
};

export function normalizeDomain(raw){
  const entered=String(raw??'').trim().replace(/\.$/,'');
  if(!entered||entered.includes('://')||/[\/@:?#[\]]/.test(entered))throw Error('Enter a domain name without an address, path or port');
  const domain=domainToASCII(entered).toLowerCase();
  if(!domain||domain.length>253||!domain.includes('.'))throw Error('Enter a complete domain name');
  for(const label of domain.split('.'))if(!label||label.length>63||!(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))throw Error('Enter a valid domain name');
  return domain;
}

const active=store=>store.list('domain_watches').filter(w=>!w.removed_at).sort((a,b)=>a.domain.localeCompare(b.domain));
export const listDomainWatches=store=>active(store);

export function addDomainWatch(store,raw){
  const domain=normalizeDomain(raw),id='domain-'+hash(domain).slice(0,24),now=new Date().toISOString();
  return store.withLock(()=>{
    const current=store.get('domain_watches',id);
    if(current&&!current.removed_at)throw Error(domain+' is already being watched');
    const owner=store.get('settings','installation')?.owner||store.device,job=store.get('jobs','domain-watch-sweeper');
    const records=[store.prepare('domain_watches',{id,domain,removed_at:null,...(current?{}:{state:null,checked_at:null})},current)];
    if(!job)records.push(store.prepare('jobs',{id:'domain-watch-sweeper',kind:'domain-watch',owner,paused:false,next_run:now,interval_ms:INTERVAL,state:'pending',outward:false}));
    else records.push(store.prepare('jobs',{paused:false,next_run:Date.parse(job.next_run)>Date.parse(now)?now:job.next_run,interval_ms:INTERVAL,state:'pending',outward:false},job));
    store.commit(records);return store.get('domain_watches',id);
  });
}

export function removeDomainWatch(store,raw){
  const domain=normalizeDomain(raw),watch=active(store).find(w=>w.domain===domain);
  if(!watch)throw Error(domain+' is not being watched');
  return store.withLock(()=>{store.commit([store.prepare('domain_watches',{removed_at:new Date().toISOString()},watch)]);return store.get('domain_watches',watch.id);});
}

export function endpointsFor(domain){
  const name=encodeURIComponent(domain);
  if(domain.endsWith('.com'))return ['https://rdap.verisign.com/com/v1/domain/'+name];
  if(domain.endsWith('.net'))return ['https://rdap.verisign.com/net/v1/domain/'+name];
  return ['https://rdap.org/domain/'+name,'https://www.rdap.net/domain/'+name];
}

const stateOf=(response,body)=>{
  if(response.status===404)return 'available';
  if(!response.ok||!body||typeof body!=='object'||Array.isArray(body))throw Error('RDAP did not return a domain record');
  const statuses=Array.isArray(body.status)?body.status.map(v=>String(v).toLowerCase().replace(/[_ -]+/g,'')):[];
  if(statuses.includes('pendingdelete'))return 'pending delete';
  if(statuses.includes('redemptionperiod'))return 'redemption';
  return 'registered';
};

async function lookup(domain,fetcher){
  let last;
  for(const endpoint of endpointsFor(domain))try{
    const response=await outboundFetch(endpoint,{headers:{Accept:'application/rdap+json','User-Agent':USER_AGENT}},{fetcher,timeoutMs:15000,maxBytes:1024*1024,maxRedirects:0});
    let body=null;if(response.status!==404)try{body=await response.json();}catch{throw Error('RDAP returned unreadable data');}
    return {state:stateOf(response,body),endpoint,http_status:response.status,statuses:Array.isArray(body?.status)?body.status:[]};
  }catch(error){last=error;}
  throw last||Error('RDAP lookup failed');
}

// The receipt Telegram keeps for one saved message it was handed (telegram.mjs, deliver): any
// state of it means the message was sent or its sending is uncertain, and it is not sent again.
export const telegramDeliveryReceiptId=record=>'delivery-'+hash([record.type,record.id,String(record.content)]).slice(0,40);

// The sweeper's saved messages a run handed to Telegram (the receipt's delivery_record_ids,
// jobs/scheduler.mjs) that Telegram was never asked to send: when one message's delivery was
// uncertain the run stopped there, and the domain states it had saved bring no new
// transition, so the next run sends these first. In the order they were saved.
export function pendingDeliveries(store,jobId='domain-watch-sweeper'){
  const runs=store.list('job_receipts').filter(r=>r.job_id===jobId&&Array.isArray(r.delivery_record_ids)).sort((a,b)=>String(a.started_at).localeCompare(String(b.started_at)));
  const pending=[];
  for(const id of runs.flatMap(r=>r.delivery_record_ids)){
    const note=store.get('notes',id);
    if(note?.content&&!note.is_trashed&&!pending.includes(id)&&!store.get('command_receipts',telegramDeliveryReceiptId(note)))pending.push(id);
  }
  return pending;
}

export async function runDomainWatches({store,fetcher}){
  const outcomes=[],successful=[],failures=[];
  for(const snapshot of active(store)){
    let read;try{read=await lookup(snapshot.domain,fetcher);}catch(error){failures.push({snapshot,error:String(error?.message||error)});continue;}
    successful.push({snapshot,read});
  }
  await store.waitForWriter();
  let deliveries=[];
  store.withLock(()=>{
    const records=[],transitions=[];
    // A lookup that failed on every server is not a state change: the domain keeps its last
    // state and is looked up again at the next six-hour run. The failure is kept on the watch,
    // where Settings shows it, and in the run's outcome; it does not make the run unverified,
    // so one unreachable registry never pauses the sweeper for the other domains (owner
    // decision on #706, 18 November 2026).
    for(const {snapshot,error} of failures){
      const at=new Date().toISOString(),current=store.get('domain_watches',snapshot.id);
      if(!current||current.removed_at){outcomes.push({domain:snapshot.domain,ok:false,removed:true});continue;}
      records.push(store.prepare('domain_watches',{last_lookup_error:error,last_lookup_failed_at:at},current));
      outcomes.push({domain:current.domain,ok:false,lookup_failed:true,error,state:current.state??null});
    }
    for(const {snapshot,read} of successful){
      const at=new Date().toISOString();
      const current=store.get('domain_watches',snapshot.id);
      if(!current||current.removed_at){outcomes.push({domain:snapshot.domain,ok:false,removed:true});continue;}
      const changed=!!current.state&&current.state!==read.state,transition=changed?hash([current.id,current.state,read.state,current._hash]):null;
      const observation=store.prepare('domain_watch_observations',{watch_id:current.id,domain:current.domain,state:read.state,observed_at:at,endpoint:read.endpoint,http_status:read.http_status,statuses:read.statuses,changed});
      records.push(observation,store.prepare('domain_watches',{state:read.state,checked_at:at,last_observation_id:observation.id,...(current.last_lookup_error?{last_lookup_error:null}:{})},current));
      if(changed)transitions.push({id:'domain-watch-'+transition,domain:current.domain,watch_id:current.id,observation_id:observation.id,body:current.domain+' is now '+read.state+': '+advice[read.state]+'.'});
      outcomes.push({domain:current.domain,ok:true,state:read.state,changed});
    }
    if(transitions.length){
      const batches=[];
      for(const transition of transitions){
        const batch=batches.at(-1),content=batch?[...batch,transition].map(change=>change.body).join('\n\n'):'';
        if(batch&&content.length<=MAX_DELIVERY_LENGTH)batch.push(transition);else batches.push([transition]);
      }
      deliveries=batches.map(batch=>{
        const note=store.prepare('notes',{title:'Domain registration changes',content:batch.map(change=>change.body).join('\n\n'),source_app:'domain-watch'});
        records.push(note,...batch.map(change=>store.prepare('notifications',{...change,status:'ready',record_id:note.id})));
        return note;
      });
    }
    if(records.length)store.commit(records);
  });
  const failed=outcomes.filter(outcome=>outcome.lookup_failed),recordIds=[...pendingDeliveries(store).filter(id=>!deliveries.some(note=>note.id===id)),...deliveries.map(note=>note.id)];
  const outcome=failed.length?'Checked '+(outcomes.filter(o=>o.ok).length)+' of '+(outcomes.filter(o=>!o.removed).length)+' domains. No registry answered for '+failed.map(o=>o.domain).join(', ')+'; '+(failed.length===1?'it keeps its':'they keep their')+' last state and '+(failed.length===1?'is':'are')+' looked up again at the next run.':'Checked '+outcomes.filter(o=>o.ok).length+' domains.';
  return {verified:true,silent:recordIds.length===0,domains:outcomes,outcome,...(failed.length?{lookup_failures:failed.map(o=>({domain:o.domain,error:o.error}))}:{}),...(recordIds.length?{record_id:recordIds[0],record_ids:recordIds,content_hash:store.get('notes',recordIds[0])._hash,delivery:'notebook'}:{})};
}
