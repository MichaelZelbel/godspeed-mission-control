import {useQuery,useQueryClient} from '@tanstack/react-query';
// Settings' list of watched domains (core/domain-watch.mjs), read from its own route so the
// personal page's shared request stays as it is.
export function DomainWatches({operation}:{operation:(input:any)=>Promise<boolean>}){
 const qc=useQueryClient(),{data}=useQuery({queryKey:['domain-watches'],queryFn:async()=>{const response=await fetch('/api/domain-watches');const body=await response.json();if(!response.ok)throw Error(body.error);return body;},refetchInterval:5000});
 const change=async(input:any)=>{if(await operation(input))await qc.invalidateQueries({queryKey:['domain-watches']});};
 return <details className="border rounded p-4"><summary>Domains to watch</summary><p>Godspeed checks registration state every six hours and only notifies you. It never registers, buys or backorders a domain.</p><form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);change({type:'domain-watch-add',domain:String(form.get('domain'))});}}><label className="block">Domain<input required name="domain" placeholder="example.com" className="border bg-background p-2"/></label><button className="border p-2">Watch this domain</button></form>{data?.domains?.map((d:any)=><article key={d.id}><p>{d.domain}: {d.state||'not checked yet'}{d.checked_at?', checked '+new Date(d.checked_at).toLocaleString():''}</p><button className="border p-2" onClick={()=>change({type:'domain-watch-remove',domain:d.domain})}>Stop watching</button></article>)}</details>;
}
