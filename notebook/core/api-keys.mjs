import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {atomic,hash} from './records/store.mjs';
export class ApiKeys {
  constructor(store){this.file=path.join(store.state,'api-keys.json');}
  rows(){return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];}
  write(rows){atomic(this.file,JSON.stringify(rows));fs.chmodSync(this.file,0o600);}
  authenticate(token){return this.rows().find(k=>k.is_active&&(!k.expires_at||Date.parse(k.expires_at)>Date.now())&&k.hash===hash(token));}
  invoke(name,input){
    if(name==='mc-api-keys')return {keys:this.rows().map(({hash,...k})=>k)};
    if(name==='mc-api-keys/generate'){const scopes=input.scopes||[];if(!input.name?.trim()||!scopes.length||scopes.some(s=>!['profile','notes','contacts','actions','media','stats','world','collections'].includes(s)))throw new Error('Choose a key name and supported scopes');const token='godspeed_'+randomBytes(32).toString('hex'),row={id:randomUUID(),name:input.name,scopes,hash:hash(token),key_prefix:token.slice(0,17),created_at:new Date().toISOString(),expires_at:input.expires_at||null,is_active:true};this.write([...this.rows(),row]);return {api_key:token,id:row.id};}
    const id=name.slice('mc-api-keys/'.length);this.write(this.rows().map(r=>r.id===id?{...r,is_active:false,revoked_at:new Date().toISOString()}:r));return {revoked:true};
  }
}
export function toolScope(name,args){
  if(['search_knowledge','validate_knowledge'].includes(name))return 'stats';
  if(['capture_note'].includes(name))return 'notes';
  if(['write_fact','record_event'].includes(name))return 'world';
  if(name==='review_suggestions')return 'profile';
  const type=args.type||'';return /^(contacts|contact_|person_)/.test(type)?'contacts':/^(claims|entities|moments|moment_|world_)/.test(type)?'world':/^(profile|fact_|agent_|review_|ai_suggestion)/.test(type)?'profile':/^collection/.test(type)?'collections':/^media|attachment/.test(type)?'media':/^action/.test(type)?'actions':/^note|comments|conversation/.test(type)?'notes':'stats';
}
