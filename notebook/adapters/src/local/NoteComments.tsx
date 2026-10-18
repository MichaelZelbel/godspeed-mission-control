import { useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
export default function NoteComments(){const location=useLocation(),id=location.pathname.split('/')[3],qc=useQueryClient(),[content,setContent]=useState(''),[error,setError]=useState('');
  const {data=[]}=useQuery({queryKey:['file-comments',id],enabled:!!id,queryFn:async()=>{const r=await supabase.from('comments').select('*').eq('note_id',id).order('created_at');if(r.error)throw new Error(r.error.message);return r.data;}});
  if(!id)return null;
  return <section className="border rounded p-4 mt-6"><h2 className="font-bold">Comments</h2>{data.map((c:any)=><article key={c.id} className="border-b py-2"><p>{c.content}</p><small>{c.created_at}</small></article>)}<form onSubmit={async e=>{e.preventDefault();const r=await supabase.from('comments').insert({note_id:id,content,author:'owner'});if(r.error)setError(r.error.message);else{setContent('');setError('');qc.invalidateQueries({queryKey:['file-comments',id]});}}}><label>New comment<textarea className="block w-full bg-background border p-2" value={content} onChange={e=>setContent(e.target.value)} required/></label><button className="border p-2">Add comment</button><p role="alert">{error}</p></form></section>;
}
