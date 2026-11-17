import {domainToASCII} from 'node:url';
import {hash} from './records/store.mjs';
import {outboundFetch} from './outbound-fetch.mjs';

const INTERVAL=6*60*60*1000;
const USER_AGENT='Godspeed-Mission-Control-Domain-Watch';
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

export async function runDomainWatches({store,fetcher}){
  const outcomes=[],successful=[];
  for(const snapshot of active(store)){
    let read;try{read=await lookup(snapshot.domain,fetcher);}catch(error){outcomes.push({domain:snapshot.domain,ok:false,error:error.message});continue;}
    successful.push({snapshot,read});
  }
  await store.waitForWriter();
  let delivery;
  store.withLock(()=>{
    const records=[],transitions=[];
    for(const {snapshot,read} of successful){
      const at=new Date().toISOString();
      const current=store.get('domain_watches',snapshot.id);
      if(!current||current.removed_at){outcomes.push({domain:snapshot.domain,ok:false,removed:true});continue;}
      const changed=!!current.state&&current.state!==read.state,transition=changed?hash([current.id,current.state,read.state,current._hash]):null;
      const observation=store.prepare('domain_watch_observations',{watch_id:current.id,domain:current.domain,state:read.state,observed_at:at,endpoint:read.endpoint,http_status:read.http_status,statuses:read.statuses,changed});
      records.push(observation,store.prepare('domain_watches',{state:read.state,checked_at:at,last_observation_id:observation.id},current));
      if(changed)transitions.push({id:'domain-watch-'+transition,domain:current.domain,watch_id:current.id,observation_id:observation.id,body:current.domain+' is now '+read.state+': '+advice[read.state]+'.'});
      outcomes.push({domain:current.domain,ok:true,state:read.state,changed});
    }
    if(transitions.length){
      const note=store.prepare('notes',{title:'Domain registration changes',content:transitions.map(change=>change.body).join('\n\n'),source_app:'domain-watch'});
      records.push(note,...transitions.map(change=>store.prepare('notifications',{...change,status:'ready',record_id:note.id})));
      delivery=note;
    }
    if(records.length)store.commit(records);
  });
  const failed=outcomes.filter(outcome=>!outcome.ok);
  return {verified:outcomes.length===0||failed.length<outcomes.length,silent:!delivery,domains:outcomes,...(delivery?{record_id:delivery.id,content_hash:store.get('notes',delivery.id)._hash,delivery:'notebook'}:{})};
}
