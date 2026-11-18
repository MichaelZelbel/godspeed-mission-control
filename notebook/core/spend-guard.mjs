import fs from 'node:fs';
import path from 'node:path';
import {outboundFetch} from './outbound-fetch.mjs';
import {baseAddress} from './routine-ai.mjs';
import {BACKUP_FILE,fallbackEntries} from './backup-ai.mjs';
import {readConfigValue} from './hermes-config.mjs';
import {queueNotice} from './notices.mjs';

export const SPEND_GUARD_DEFAULTS={enabled:true,daily_limit:2,low_balance:5};
const WINDOW=6*60*60*1000;
const unquote=value=>String(value||'').trim().replace(/^["']|["']$/g,'');
const read=file=>{try{return fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');}catch{return '';}};
const json=file=>{try{return JSON.parse(read(file));}catch{return null;}};
const envValue=(text,name)=>{const found=new RegExp('^\\s*(?:export\\s+)?'+name+'\\s*=\\s*(.*)$','m').exec(text);return found?unquote(found[1]):'';};
const openRouter=config=>config&&typeof config==='object'&&baseAddress(config.url)==='https://openrouter.ai/api/v1'&&typeof config.key==='string'&&config.key;

export function spendGuardKeys({state,hermesHome}={}){
 const keys=[];
 for(const file of ['provider.json',BACKUP_FILE]){const config=json(path.join(state,file)),key=openRouter(config);if(key)keys.push(key);}
 if(hermesHome){
  const config=read(path.join(hermesHome,'config.yaml')),env=read(path.join(hermesHome,'.env'));
  if(unquote(readConfigValue(config,['model','provider']))==='openrouter'){
   const key=envValue(env,'OPENROUTER_API_KEY')||unquote(readConfigValue(config,['model','api_key']));if(key)keys.push(key);
  }
  for(const entry of fallbackEntries(config).filter(entry=>entry.provider==='openrouter')){
   const key=entry.api_key||envValue(env,entry.key_env);if(key)keys.push(key);
  }
 }
 return [...new Set(keys)];
}

export function spendGuardSettings(store){const saved=store.get('settings','spend-guard')||{};return {enabled:saved.enabled??true,daily_limit:saved.daily_limit??2,low_balance:saved.low_balance??5};}
export function saveSpendGuardSettings(store,input){
 const old=spendGuardSettings(store),next={enabled:input.enabled??old.enabled,daily_limit:input.daily_limit??old.daily_limit,low_balance:input.low_balance??old.low_balance};
 if(typeof next.enabled!=='boolean'||![next.daily_limit,next.low_balance].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0))throw Error('Choose an on or off setting and non-negative dollar amounts');
 store.save('settings',{id:'spend-guard',...next});return next;
}
export function spendGuardStatus(store,options={}){const count=spendGuardKeys({state:store.state,...options}).length;return {...spendGuardSettings(store),openrouter_connected:count>0,provider_message:count?'OpenRouter spending is checked hourly.':'Spending is not checked for the connected provider yet. The check starts automatically when an OpenRouter key is connected.'};}

async function sample(key,fetcher){
 const headers={Authorization:'Bearer '+key};
 const get=async route=>{const response=await outboundFetch('https://openrouter.ai/api/v1/'+route,{method:'GET',headers},{allowHosts:['openrouter.ai'],maxRedirects:0,maxBytes:65536,timeoutMs:15000,fetcher});if(!response.ok)throw Error('request-failed');return response.json();};
 const [usage,credits]=await Promise.all([get('key'),get('credits')]),dailyValue=usage?.data?.usage_daily??usage?.usage_daily,creditData=credits?.data??credits;
 const daily=typeof dailyValue==='number'?dailyValue:NaN,total=creditData?.total_credits,used=creditData?.total_usage,direct=creditData?.balance;
 const balance=typeof direct==='number'?direct:typeof total==='number'&&typeof used==='number'?total-used:NaN;
 if(!Number.isFinite(daily)||daily<0||!Number.isFinite(balance)||balance<0)throw Error('invalid-response');
 return {daily,balance};
}

export async function runSpendGuard({store,hermesHome,fetcher,now=Date.now}={}){
 const settings=spendGuardSettings(store);if(!settings.enabled)return {verified:true,silent:true,reason:'Spending check is off'};
 const keys=spendGuardKeys({state:store.state,hermesHome});if(!keys.length)return {verified:true,silent:true,reason:'No OpenRouter key'};
 let samples;try{samples=await Promise.all(keys.map(key=>sample(key,fetcher)));}catch(error){store.save('spend_guard_runs',{id:'latest',status:'failed',failure:error.message==='invalid-response'?'invalid-response':'request-failed',checked_at:new Date(now()).toISOString(),key_count:keys.length});return {verified:true,silent:true,reason:'OpenRouter could not be read'};}
 const checked=now(),daily_spend=samples.reduce((sum,item)=>sum+item.daily,0),balance=Math.min(...samples.map(item=>item.balance));
 const due=[daily_spend>settings.daily_limit&&['daily-spend',`OpenRouter has spent $${daily_spend.toFixed(2)} today, above your $${settings.daily_limit.toFixed(2)} daily limit. Change this limit in Settings under Connect AI.`],balance<settings.low_balance&&['low-balance',`Your lowest remaining OpenRouter balance is $${balance.toFixed(2)}, below your $${settings.low_balance.toFixed(2)} limit. Change this limit in Settings under Connect AI.`]].filter(Boolean);
 store.save('spend_guard_runs',{id:'latest',status:'ok',failure:null,checked_at:new Date(checked).toISOString(),daily_spend,balance,key_count:keys.length});
 const queued=[];
 for(const [kind,text] of due){
  let reserved=false,id;
  store.withLock(()=>{const state=store.get('spend_guard_runs','latest'),last=Date.parse(state?.last_notified?.[kind]||'');if(Number.isFinite(last)&&checked-last<WINDOW)return;id='spend-guard-'+kind+'-'+checked;store.commit([store.prepare('spend_guard_runs',{id:'latest',status:'ok',checked_at:new Date(checked).toISOString(),daily_spend,balance,key_count:keys.length,last_notified:{...(state?.last_notified||{}),[kind]:new Date(checked).toISOString()}},state),store.prepare('notifications',{id,status:'pending',kind:'spend-guard',title:kind==='daily-spend'?'OpenRouter daily spending is over your limit':'OpenRouter credit is running low',body:text,link:'/dashboard/settings#spend-guard'})]);reserved=true;});
  if(reserved){queueNotice(store,{id,text,about:'OpenRouter spending'});queued.push(kind);}
 }
 return {verified:true,silent:queued.length===0,daily_spend,balance,key_count:keys.length,notices:queued};
}
