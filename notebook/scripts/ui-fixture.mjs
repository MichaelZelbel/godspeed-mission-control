import fs from 'node:fs';
const origin='http://127.0.0.1:47831',image=process.argv[2];
async function post(route,input){const r=await fetch(origin+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),result=await r.json();if(!r.ok)throw new Error(result.error);return result;}
const query=body=>post('query',body);
const note=(await query({table:'notes',operation:'insert',values:{title:'Synthetic receipt for media verification',content:'An artificial receipt created only for candidate tests.'}})).data[0];
const form=new FormData();form.set('file',new Blob([fs.readFileSync(image)],{type:'image/png'}),'synthetic-receipt.png');form.set('path','synthetic-ui/'+note.id+'.png');const uploaded=await(await fetch(origin+'/api/media/upload',{method:'POST',body:form})).json();
const storage_path='synthetic-ui/'+note.id+'.png';await query({table:'note_attachments',operation:'insert',values:{note_id:note.id,storage_path,filename:'synthetic-receipt.png',file_type:'image/png'}});
await query({table:'review_queue',operation:'insert',values:{title:'Synthetic preference suggestion',suggestion_type:'add_profile_entry',description:'Synthetic review fixture, not personal information.',source_note_id:note.id,payload:{label:'Synthetic preferred colour',value:'Blue'},status:'pending_review'}});
if(process.env.OPENROUTER_API_KEY){await post('provider',{url:'https://openrouter.ai/api/v1/chat/completions',key:process.env.OPENROUTER_API_KEY,model:'dots-studio/dots-3-note-preview:free'});await post('functions/analyze-media',{note_id:note.id,storage_path,media_type:'image',original_filename:'synthetic-receipt.png'});}
console.log(JSON.stringify({syntheticOnly:true,note_id:note.id,media_path:storage_path,providerConfigured:!!process.env.OPENROUTER_API_KEY,at:new Date().toISOString()}));
