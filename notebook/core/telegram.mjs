import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';
export class Telegram {
  constructor({store,domains,token,owner,origin='https://api.telegram.org',transport=fetch}){this.store=store;this.domains=domains;this.token=token;this.owner=String(owner);this.origin=origin;this.transport=transport;this.file=path.join(store.state,'telegram-offset.json');this.running=false;}
  async call(method,input){const response=await this.transport(this.origin+'/bot'+this.token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(35000)});const data=await response.json();if(!response.ok||!data.ok)throw new Error('Candidate Telegram request failed');return data.result;}
  async deliver(id,result){
    const receiptId='delivery-'+id,old=this.store.get('command_receipts',receiptId);if(old?.state==='verified')return old;if(old)throw Object.assign(new Error('A previous delivery needs review before another send'),{code:'OUTWARD_UNCERTAIN'});
    const record=[...this.store.records.values()].find(r=>r.id===result.record_id);if(!record?.content)throw new Error('No saved message exists for delivery');
    const text=String(record.content);if(text.length>4000)throw new Error('Prepare a shorter delivery before sending this saved result');
    this.store.save('command_receipts',{id:receiptId,source:'telegram-delivery',state:'attempted',record_id:record.id,content:text});
    try{const sent=await this.call('sendMessage',{chat_id:this.owner,text});this.store.save('conversation_messages',{role:'assistant',content:text,source_app:'telegram',message_id:sent.message_id,conversation_id:'telegram-owner'});return this.store.save('command_receipts',{id:receiptId,state:'verified',message_id:sent.message_id});}catch{this.store.save('command_receipts',{id:receiptId,state:'needs_review'});throw Object.assign(new Error('Telegram delivery is uncertain and will not be replayed'),{code:'OUTWARD_UNCERTAIN'});}
  }
  async tick(){
    if(this.running)return;this.running=true;
    try{
      const offset=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')).offset:0;
      const updates=await this.call('getUpdates',{offset,timeout:0,allowed_updates:['message']});
      for(const update of updates){
        const message=update.message,text=message?.text||'';
        if(String(message?.chat?.id)!==this.owner||message?.chat?.type!=='private'){atomic(this.file,JSON.stringify({offset:update.update_id+1}));continue;}
        const id='telegram-'+update.update_id,prior=this.store.get('command_receipts',id);
        if(prior){atomic(this.file,JSON.stringify({offset:update.update_id+1}));continue;}
        this.store.save('command_receipts',{id,source:'telegram',state:'attempted',request:text});
        let reply;
        try{
          if(text.startsWith('/capture ')){const note=this.store.save('notes',{id:'telegram-note-'+update.update_id,title:'Telegram capture',content:text.slice(9),source_app:'telegram'});reply='Saved your note: '+note.title;}
          else if(text==='/status'){const jobs=this.store.list('jobs');reply='Your candidate has '+this.store.records.size+' records and '+jobs.filter(j=>!j.paused).length+' enabled routines.';}
          else if(text.startsWith('/approve ')){const approval=this.store.get('approvals',text.slice(9).trim());if(!approval||approval.status!=='pending')throw new Error('Pending approval missing');this.store.save('approvals',{id:approval.id,status:'approved',user_words:text,approved_at:new Date().toISOString()});reply='Recorded your approval for '+approval.title+'.';}
          else {this.store.save('conversation_messages',{role:'user',content:text,source_app:'telegram',conversation_id:'telegram-owner'});const result=await this.domains.invoke('conversation-chat',{message:text,conversation_id:'telegram-owner'});reply=result.reply;}
          const delivered=await this.call('sendMessage',{chat_id:this.owner,text:String(reply).slice(0,4000)});
          this.store.save('command_receipts',{id,state:'verified',message_id:delivered.message_id,result:reply});
          this.store.save('conversation_messages',{role:'assistant',content:reply,source_app:'telegram',message_id:delivered.message_id,conversation_id:'telegram-owner'});
        }catch{this.store.save('command_receipts',{id,state:'needs_review',error:'Candidate Telegram request did not finish. It will not be replayed automatically.'});}
        atomic(this.file,JSON.stringify({offset:update.update_id+1}));
      }
    }finally{this.running=false;}
  }
}
