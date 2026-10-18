// Compatibility vocabulary for reused screens. All requests reach the local file service.
import {createRecordWrites} from './record-writes.mjs';
export const SUPABASE_URL = location.origin;
export const SUPABASE_PUBLISHABLE_KEY = '';
async function request(route:string,body?:any) {
  try {
    const response=await fetch('/api/'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const context=response.clone();const result=await response.json();
    if(!response.ok)return {data:null,error:{message:result.error||'Request failed',code:result.code,context}};
    return result;
  }catch(e:any){return {data:null,error:{message:e.message}};}
}
const writes = createRecordWrites({send:(state:any)=>request(state.rpc?'rpc':'query',state)});
class Query implements PromiseLike<any> {
  state:any; signal?:AbortSignal;
  constructor(table?:string,rpc?:string,args?:any){this.state={table,rpc,args,filters:[],orders:[]};}
  select(selection='*',options={}){this.state.selection=selection;this.state.options={...this.state.options,...options};return this;}
  insert(values:any){this.state.operation='insert';this.state.values=values;return this;}
  upsert(values:any,options={}){this.state.operation='upsert';this.state.values=values;this.state.options=options;return this;}
  update(values:any){this.state.operation='update';this.state.values=values;return this;}
  delete(){this.state.operation='delete';return this;}
  filter(key:string,op:string,value:any){this.state.filters.push([op,key,value]);return this;}
  eq(k:string,v:any){return this.filter(k,'eq',v);} neq(k:string,v:any){return this.filter(k,'neq',v);}
  gt(k:string,v:any){return this.filter(k,'gt',v);} gte(k:string,v:any){return this.filter(k,'gte',v);}
  lt(k:string,v:any){return this.filter(k,'lt',v);} lte(k:string,v:any){return this.filter(k,'lte',v);}
  is(k:string,v:any){return this.filter(k,'is',v);} in(k:string,v:any){return this.filter(k,'in',v);}
  ilike(k:string,v:any){return this.filter(k,'ilike',v);} like(k:string,v:any){return this.filter(k,'like',v);}
  contains(k:string,v:any){return this.filter(k,'contains',v);} overlaps(k:string,v:any){return this.filter(k,'overlaps',v);}
  not(k:string,op:string,v:any){return this.filter(k,'not',[op,v]);} or(v:string){return this.filter('','or',v);}
  order(k:string,options={}){this.state.orders.push([k,options]);return this;}
  range(a:number,b:number){this.state.range=[a,b];return this;} limit(n:number){this.state.limit=n;return this;}
  single(){this.state.single=true;return this;} maybeSingle(){this.state.maybeSingle=true;return this;}
  abortSignal(signal:AbortSignal){this.signal=signal;return this;} setHeader(){return this;}
  run(){
    // Version stamping, remembering what came back, and running one write per
    // record at a time all live in record-writes.mjs so they can be tested.
    return writes.perform(this.state);
  }
  then<TResult1=any,TResult2=never>(onfulfilled?:((value:any)=>TResult1|PromiseLike<TResult1>)|null,onrejected?:((reason:any)=>TResult2|PromiseLike<TResult2>)|null):PromiseLike<TResult1|TResult2>{return this.run().then(onfulfilled,onrejected);}
}
const storage=(bucket:string)=>({
  upload:async(name:string,file:Blob,options:any={})=>{const form=new FormData();form.append('file',file);form.append('path',name);
    // A PDF's text travels with it, so the notebook can keep and search it
    // (lib/pdf-text.ts). A PDF whose text cannot be read still uploads.
    if(file.type==='application/pdf'||/\.pdf$/i.test(name)){try{const {extractPdfText}=await import('@/lib/pdf-text');const text=await extractPdfText(file);if(text)form.append('extracted_text',text);}catch{}}const r=await fetch('/api/media/upload?bucket='+encodeURIComponent(bucket),{method:'POST',body:form});const data=await r.json();return r.ok?{data,error:null}:{data:null,error:{message:data.error}};},
  getPublicUrl:(name:string)=>({data:{publicUrl:'/api/media/file/'+encodeURIComponent(name)}}),
  createSignedUrl:async(name:string)=>({data:{signedUrl:'/api/media/file/'+encodeURIComponent(name)},error:null}),
  createSignedUrls:async(names:string[])=>({data:names.map(name=>({path:name,signedUrl:'/api/media/file/'+encodeURIComponent(name),error:null})),error:null}),
  remove:async(names:string[])=>request('media/remove',{paths:names}),
  download:async(name:string)=>{const r=await fetch('/api/media/file/'+encodeURIComponent(name));return r.ok?{data:await r.blob(),error:null}:{data:null,error:{message:'Media unavailable'}};}
});
export const supabase:any={
  from:(table:string)=>new Query(table),rpc:(name:string,args:any)=>new Query(undefined,name,args),
  functions:{invoke:(name:string,options:any={})=>request('functions/'+name,options.body||{})},
  storage:{from:storage},
  auth:{getSession:async()=>({data:{session:{access_token:'local-session',user:{id:'owner'}}},error:null}),getUser:async()=>({data:{user:{id:'owner'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  channel:()=>({on(){return this;},subscribe(){return this;},unsubscribe(){}}),removeChannel:async()=>{},
};
