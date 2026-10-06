import fs from 'node:fs';
import path from 'node:path';
import {atomic,hash} from './records/store.mjs';
export class Telegram {
  constructor({store,domains,token,owner,origin='https://api.telegram.org',transport=fetch,loginLink}){this.store=store;this.domains=domains;this.token=token;this.owner=String(owner);this.origin=origin;this.transport=transport;this.loginLink=loginLink;this.file=path.join(store.state,'telegram-offset.json');this.running=false;}
  // A message carrying a link goes without a preview: Telegram's servers fetch
  // a previewed link first, and a one-time sign-in link was used up by them
  // before the owner could tap it (until 6 October 2026).
  async call(method,input){if(method==='sendMessage'&&/https?:\/\//i.test(String(input.text||'')))input={...input,link_preview_options:{is_disabled:true}};const response=await this.transport(this.origin+'/bot'+this.token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(35000)});const data=await response.json();if(!response.ok||!data.ok)throw new Error('Candidate Telegram request failed');return data.result;}
  async failureNotice(id,text){
    const receiptId=id+'-failure-notice';
    if(this.store.get('command_receipts',receiptId))return;
    // Record the send before contacting Telegram. An uncertain send is never replayed.
    await this.store.saveAsync('command_receipts',{id:receiptId,source:'telegram',state:'attempted'});
    try{const sent=await this.call('sendMessage',{chat_id:this.owner,text});await this.store.saveAsync('command_receipts',{id:receiptId,state:'verified',message_id:sent.message_id});}
    catch{await this.store.saveAsync('command_receipts',{id:receiptId,state:'needs_review'});}
  }
  async deliver(id,result){
    const record=[...this.store.records.values()].find(r=>r.id===result.record_id);if(!record?.content)throw new Error('No saved message exists for delivery');
    // One saved message is sent once, whichever run hands it over: until
    // 6 October 2026 the key was the run's slot, so a retried or resumed run
    // sent the same message again. The slot's own receipt still counts.
    const receiptId='delivery-'+hash([record.type,record.id,String(record.content)]).slice(0,40),old=this.store.get('command_receipts',receiptId)||this.store.get('command_receipts','delivery-'+id);if(old?.state==='verified')return old;if(old)throw Object.assign(new Error('A previous delivery needs review before another send'),{code:'OUTWARD_UNCERTAIN'});
    const text=String(record.content);if(text.length>4000)throw new Error('Prepare a shorter delivery before sending this saved result');
    await this.store.saveAsync('command_receipts',{id:receiptId,source:'telegram-delivery',state:'attempted',record_id:record.id,content:text});
    try{const sent=await this.call('sendMessage',{chat_id:this.owner,text});await this.store.saveAsync('conversation_messages',{role:'assistant',content:text,talk_id:result.talk_id||record.talk_id||null,habit_ids:record.habit_ids||[],observation_day:record.observation_day||null,source_app:'telegram',message_id:sent.message_id,conversation_id:'telegram-owner'});return await this.store.saveAsync('command_receipts',{id:receiptId,state:'verified',message_id:sent.message_id});}catch{await this.store.saveAsync('command_receipts',{id:receiptId,state:'needs_review'});throw Object.assign(new Error('Telegram delivery is uncertain and will not be replayed'),{code:'OUTWARD_UNCERTAIN'});}
  }
  async tick(){
    if(this.running)return;this.running=true;
    try{
      const offset=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')).offset:0;
      const updates=await this.call('getUpdates',{offset,timeout:0,allowed_updates:['message']});
      for(const update of updates){
        const message=update.message,text=message?.text||'';
        if(String(message?.chat?.id)!==this.owner||String(message?.from?.id)!==this.owner||message?.from?.is_bot||message?.chat?.type!=='private'){atomic(this.file,JSON.stringify({offset:update.update_id+1}));continue;}
        const id='telegram-'+update.update_id,prior=this.store.get('command_receipts',id);
        if(prior){if(prior.state==='attempted'){await this.store.saveAsync('command_receipts',{id,state:'needs_review',error:'Interrupted Telegram request; actions were not repeated.'});await this.failureNotice(id,'Your previous message did not finish. I have not repeated any actions. Please send it again.');}atomic(this.file,JSON.stringify({offset:update.update_id+1}));continue;}
        await this.store.saveAsync('command_receipts',{id,source:'telegram',state:'attempted',request:text});
        let reply,answered=false,sendAttempted=false;
        try{
          if(['/notebook','/chat'].includes(text)&&this.loginLink)reply='Open your '+(text==='/chat'?'chat':'notebook')+': '+this.loginLink(text==='/chat'?'/chat':'/');
          else if(text.startsWith('/capture ')){const note=await this.store.saveAsync('notes',{id:'telegram-note-'+update.update_id,title:'Telegram capture',content:text.slice(9),source_app:'telegram'});reply='Saved your note: '+note.title;}
          else if(text==='/status'){const jobs=this.store.list('jobs');reply='Your candidate has '+this.store.records.size+' records and '+jobs.filter(j=>!j.paused).length+' enabled routines.';}
          else if(text.startsWith('/approve ')){const approval=this.store.get('approvals',text.slice(9).trim());if(!approval||approval.status!=='pending')throw new Error('Pending approval missing');await this.store.saveAsync('approvals',{id:approval.id,status:'approved',user_words:text,approved_at:new Date().toISOString()});reply='Recorded your approval for '+approval.title+'.';}
          else {await this.store.saveAsync('conversation_messages',{role:'user',content:text,source_app:'telegram',conversation_id:'telegram-owner'});const result=await this.domains.invoke('conversation-chat',{message:text,conversation_id:'telegram-owner',request_id:id});reply=result.reply;answered=true;}
          sendAttempted=true;
          const delivered=await this.call('sendMessage',{chat_id:this.owner,text:String(reply).slice(0,4000)});
          await this.store.saveAsync('command_receipts',{id,state:'verified',message_id:delivered.message_id,result:reply});
          if(!answered)await this.store.saveAsync('conversation_messages',{role:'assistant',content:reply,source_app:'telegram',message_id:delivered.message_id,conversation_id:'telegram-owner'});
        }catch{await this.store.saveAsync('command_receipts',{id,state:'needs_review',error:'Telegram request did not finish. It will not be replayed automatically.'});if(!sendAttempted)await this.failureNotice(id,'I could not finish your message. I have not repeated any actions. Please try again.');}
        atomic(this.file,JSON.stringify({offset:update.update_id+1}));
      }
    }finally{this.running=false;}
  }
}
