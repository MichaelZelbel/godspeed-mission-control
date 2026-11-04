import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

// Settings > Health data from your phone (issue #214, notebook/core/phone-health.mjs). A server
// install takes the uploads of the iPhone app Health Auto Export at a private address; a Windows or
// Mac notebook cannot be reached by the phone and says so in one line.
type Status={available:boolean;address?:string|null};
async function call(route:string,body?:unknown):Promise<Status>{
  const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'Something went wrong');return data;
}

export function PhoneHealth(){
  const client=useQueryClient(),[error,setError]=useState('');
  const {data}=useQuery({queryKey:['phone-health'],queryFn:()=>call('phone-health')});
  if(!data)return null;
  if(!data.available)return <p>Health data from your phone (Health Auto Export) needs the server install of Godspeed Mission Control.</p>;
  const renew=async()=>{
    if(!window.confirm('Make a new address? The old one stops working at once, and your phone needs the new one.'))return;
    try{setError('');client.setQueryData(['phone-health'],await call('phone-health/renew',{}));}catch(e){setError((e as Error).message);}
  };
  return <section className="border rounded p-4 space-y-2">
    <h2 className="text-lg font-semibold">Health data from your phone</h2>
    <p>In Health Auto Export, open Automations, add a REST API automation, choose the JSON format, and paste this address. Your phone then sends its health data here every hour, and your morning briefing and health talks use it.</p>
    {data.address?<>
      <Input readOnly aria-label="Address for Health Auto Export" value={data.address} onFocus={e=>e.currentTarget.select()}/>
      <p>Anyone with this address can send health data to your notebook, so keep it private.</p>
      <Button variant="outline" onClick={()=>void renew()}>Make a new address</Button>
    </>:<p>The address is shown only for this server's https web address, so nobody can read it on the way. Set that address up first.</p>}
    {error&&<p role="alert" className="text-red-400">{error}</p>}
  </section>;
}
