import {createHash} from 'node:crypto';
import {identifier,checkedUser} from './migration.mjs';
import {isoTimestamps} from './timestamps.mjs';

export class MenerioSource {
  constructor({project,token,apiKey,user}={}){
    if(!/^[a-z0-9]{20}$/.test(project||''))throw new Error('Choose the source Supabase project reference');
    if(!token||!apiKey)throw new Error('Load SUPABASE_ACCESS_TOKEN and MENERIO_API_KEY from the protected secrets store');
    this.project=project;this.token=token;this.apiKey=apiKey;this.requestedUser=user;
  }
  async management(route,options={}){
    for(let attempt=0;attempt<6;attempt++){
      const delay=Math.max(0,1500-(Date.now()-(this.lastRequest||0)));if(delay)await new Promise(r=>setTimeout(r,delay));this.lastRequest=Date.now();
      const r=await fetch('https://api.supabase.com/v1/projects/'+this.project+route,{...options,headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json','User-Agent':'Godspeed-Mission-Control-migration',...options.headers},signal:AbortSignal.timeout(60000)});
      if(r.ok)return r.json();
      if((r.status===429||r.status>=500)&&attempt<5){const retry=Number(r.headers.get('retry-after'));await new Promise(resolve=>setTimeout(resolve,Math.min(30000,Math.max(2000*(2**attempt),Number.isFinite(retry)?retry*1000:0))));continue;}
      throw new Error('Source management request failed with HTTP '+r.status);
    }
  }
  async sql(query){return this.management('/database/query/read-only',{method:'POST',body:JSON.stringify({query})});}
  async identify(){
    const digest=createHash('sha256').update(this.apiKey).digest('hex');
    const rows=await this.sql("select user_id::text from public.godspeed_api_keys where key_hash='"+digest+"' and is_active and (expires_at is null or expires_at>now()) limit 2");
    if(rows.length!==1)throw new Error('The source account could not be identified from its active personal API key');
    this.user=checkedUser(rows[0].user_id);if(this.requestedUser&&this.requestedUser!==this.user)throw new Error('The source user does not match the connected personal account');return this.user;
  }
  async catalog(){
    if(!this.user)await this.identify();
    return this.sql(`select c.relname as name,
      (select json_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
      coalesce((select json_agg(a.attname order by k.ord) from pg_constraint p cross join lateral unnest(p.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.num where p.conrelid=c.oid and p.contype='p'),'[]'::json) as "primaryKey",
      coalesce((select json_agg(json_build_object('parent',pc.relname,'columns',(select json_agg(a.attname order by k.ord) from unnest(f.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.num),'parentColumns',(select json_agg(a.attname order by k.ord) from unnest(f.confkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=f.confrelid and a.attnum=k.num))) from pg_constraint f join pg_class pc on pc.oid=f.confrelid join pg_namespace pn on pn.oid=pc.relnamespace where f.conrelid=c.oid and f.contype='f' and pn.nspname='public'),'[]'::json) as "foreignKeys"
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`);
  }
  order(table){return table.primaryKey.map(k=>'s.'+identifier(k)).join(',');}
  async fingerprint(table,where){const rows=await this.sql('select count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),\'\' order by '+this.order(table)+'),\'\')) as digest from public.'+identifier(table.name)+' s where '+where);return rows[0];}
  async fingerprints(entries){return this.sql(entries.map(({table,where})=>"select '"+table.name+"' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by "+this.order(table)+"),'')) as digest from public."+identifier(table.name)+' s where '+where).join(' union all '));}
  // The query service answers in Postgres' text form ("2026-10-05 00:00:00+00"); rows are
  // copied with ISO timestamps, as Menerio's own service handed them out (timestamps.mjs).
  async page(table,where,offset,size){const rows=await this.sql('select s.* from public.'+identifier(table.name)+' s where '+where+' order by '+this.order(table)+' limit '+Number(size)+' offset '+Number(offset));return Array.isArray(rows)?rows.map(isoTimestamps):rows;}
  async media(all){
    const columns=await this.sql("select column_name from information_schema.columns where table_schema='storage' and table_name='objects'");const names=new Set(columns.map(c=>c.column_name));
    const owner=names.has('owner_id')?'s.owner_id::text':names.has('owner')?'s.owner::text':"''";
    const rows=await this.sql('select s.bucket_id as bucket,s.name,s.metadata,'+owner+' as owner from storage.objects s order by s.bucket_id,s.name');
    const references=new Set();
    const walk=(v,k='')=>{if(typeof v==='string'){if(/path|url|attachment|avatar|content/i.test(k))references.add(v);}else if(Array.isArray(v))v.forEach(x=>walk(x,k));else if(v&&typeof v==='object')for(const [key,value] of Object.entries(v))walk(value,key);};walk(all);
    return rows.filter(o=>o.owner===this.user||o.name.startsWith(this.user+'/')||[...references].some(r=>r===o.name||r.includes('/'+o.bucket+'/'+o.name))).map(o=>({bucket:o.bucket,name:o.name,size:o.metadata?.size,contentType:o.metadata?.mimetype||'application/octet-stream'}));
  }
  async download(object){
    if(!this.storageKey){const keys=await this.management('/api-keys?reveal=true');const selected=keys.find(k=>k.type==='secret')||keys.find(k=>k.name==='service_role');this.storageKey=selected?.api_key;if(!this.storageKey)throw new Error('Source media download needs the protected administrative storage key');}
    const url='https://'+this.project+'.supabase.co/storage/v1/object/'+encodeURIComponent(object.bucket)+'/'+object.name.split('/').map(encodeURIComponent).join('/');
    const r=await fetch(url,{headers:{apikey:this.storageKey,...(this.storageKey.startsWith('eyJ')?{Authorization:'Bearer '+this.storageKey}:{})},signal:AbortSignal.timeout(120000)});if(!r.ok)throw new Error('Source media download failed with HTTP '+r.status);return Buffer.from(await r.arrayBuffer());
  }
}
