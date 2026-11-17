#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {reminderSent} from '../core/background-reports.mjs';
import {appendAssistantMessage} from '../core/conversation-state.mjs';
import {remindWaitingSteps} from '../core/waiting-steps.mjs';

const AT=new Date('2026-11-17T12:00:00.000Z');
const ids={due:'step-10000000-0000-4000-8000-000000000039',retry:'step-20000000-0000-4000-8000-000000000039',telegram:'step-30000000-0000-4000-8000-000000000039',young:'step-40000000-0000-4000-8000-000000000039',old:'step-50000000-0000-4000-8000-000000000039',expired:'step-60000000-0000-4000-8000-000000000039',answered:'step-70000000-0000-4000-8000-000000000039',quiet:'step-80000000-0000-4000-8000-000000000039',legacy:'step-90000000-0000-4000-8000-000000000039',outward:'step-a0000000-0000-4000-8000-000000000039'};

const record=(id,fields={})=>({id,status:'pending',about:'The verifier backup is waiting.',question:'Should I continue the verifier backup?',yes_outcome:'The backup continues.',no_outcome:'The backup stays paused.',asked_by:{kind:'routine',name:'H-39 verifier'},asked_in:'notebook',asked_at:'2026-11-17T05:40:00.000Z',sent_at:'2026-11-17T05:50:00.000Z',...fields});
const expect=(condition,message)=>{if(!condition)throw Error(message);};

export async function verifyWaitingStepReminders(root){
 fs.mkdirSync(root,{recursive:true});
 const store=new Store(root);
 const fixtures=[
  record(ids.due),record(ids.retry,{about:'The retryable verifier backup is waiting.'}),record(ids.telegram,{asked_in:'telegram',about:'The Telegram verifier backup is waiting.'}),
  record(ids.young,{sent_at:'2026-11-17T06:59:00.000Z'}),record(ids.old,{sent_at:'2026-11-10T11:59:59.000Z'}),record(ids.expired,{expires_at:'2026-11-17T11:59:59.000Z'}),
  record(ids.answered,{status:'approved',answered_at:'2026-11-17T08:00:00.000Z'}),record(ids.quiet,{quietly:'retry'}),record(ids.legacy,{asked_in:null}),record(ids.outward,{outward:true,about:'The outward verifier post is waiting.'})
 ];
 for(const fixture of fixtures)store.save('approvals',fixture);

 const failures=[];
 remindWaitingSteps(store,{at:AT,append:(...args)=>{if(args[2].startsWith('The retryable'))throw Error('verifier chat unavailable');return appendAssistantMessage(...args);},onFailure:error=>failures.push(error.message)});
 const telegramFile=path.join(root,'.godspeed','step-reminders',ids.telegram+'.json');
 const telegram=JSON.parse(fs.readFileSync(telegramFile,'utf8'));
 expect(failures.join()==='verifier chat unavailable','the failed send was not reported');
 expect(!store.get('approvals',ids.retry).reminded_at,'the failed send wrote a marker');
 expect(telegram.text==='The Telegram verifier backup is waiting. Should I continue the verifier backup? Please answer yes or no.','the Telegram reminder is not self-contained');
 expect(!store.get('approvals',ids.telegram).reminded_at,'the queued Telegram reminder was marked before delivery');
 expect(await reminderSent(store,ids.telegram),'the delivered Telegram reminder was not marked');

 remindWaitingSteps(store,{at:new Date(AT.getTime()+3600000)});
 const messages=store.list('note_conversations').flatMap(chat=>chat.state?.messages||[]).map(message=>message.content);
 const marked=Object.fromEntries(Object.entries(ids).map(([name,id])=>[name,Boolean(store.get('approvals',id).reminded_at)]));
 expect(marked.due&&marked.retry&&marked.telegram&&marked.young&&marked.outward,'eligible reminders were not marked after delivery');
 expect(!marked.old&&!marked.expired&&!marked.answered&&!marked.quiet&&!marked.legacy,'an ineligible reminder was marked');
 expect(store.get('approvals',ids.outward).status==='pending','the reminder answered or performed the outward step');
 const before=messages.length;
 remindWaitingSteps(store,{at:new Date(AT.getTime()+2*3600000)});
 const after=store.list('note_conversations').flatMap(chat=>chat.state?.messages||[]).length;
 expect(after===before,'a marked reminder repeated');

 return {at:AT.toISOString(),failures,telegram:{chat:'telegram',text:telegram.text,marked_after_delivery:marked.telegram},notebook:{chat:'notebook',messages},marked,statuses:Object.fromEntries(Object.entries(ids).map(([name,id])=>[name,store.get('approvals',id).status])),second_marked_pass_added_messages:after-before};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const root=process.argv[2];
 if(!root){process.stderr.write('usage: node notebook/scripts/waiting-step-verifier.mjs <empty-workspace>\n');process.exit(2);}
 verifyWaitingStepReminders(path.resolve(root)).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exit(1);});
}
