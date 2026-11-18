#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {reminderSent} from '../core/background-reports.mjs';
import {appendAssistantMessage} from '../core/conversation-state.mjs';
import {NativeScheduler} from '../core/native-scheduler.mjs';

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

 // Every pass goes through the notebook's own hourly scheduler tick, the way a running notebook reaches it.
 // The first chat write of the first pass fails, as an unavailable chat would; the next pass retries it.
 let now=AT.getTime(),failNext=false;const failures=[];
 const withLock=store.withLock.bind(store);
 store.withLock=(fn,...rest)=>{if(failNext){failNext=false;throw Error('verifier chat unavailable');}return withLock(fn,...rest);};
 const scheduler=new NativeScheduler(store,{home:path.join(root,'.hermes'),executable:'hermes',now:()=>now,lifecycle:{acquire:()=>null}});
 scheduler.onFailure=error=>failures.push(error.message);
 failNext=true;await scheduler.tick();failNext=false;
 const notebookIds=[ids.due,ids.retry,ids.young,ids.outward];
 const failed=notebookIds.filter(id=>id!==ids.young&&!store.get('approvals',id).reminded_at);
 expect(failed.length===1,'exactly one notebook send was made to fail');
 const telegramFile=path.join(root,'.godspeed','step-reminders',ids.telegram+'.json');
 const telegram=JSON.parse(fs.readFileSync(telegramFile,'utf8'));
 expect(failures.join()==='verifier chat unavailable','the failed send was not reported');
 expect(!store.get('approvals',failed[0]).reminded_at,'the failed send wrote a marker');
 expect(telegram.text==='The Telegram verifier backup is waiting. Should I continue the verifier backup? Please answer yes or no.','the Telegram reminder is not self-contained');
 expect(!store.get('approvals',ids.telegram).reminded_at,'the queued Telegram reminder was marked before delivery');
 expect(await reminderSent(store,ids.telegram),'the delivered Telegram reminder was not marked');

 now+=30*60000;await scheduler.tick();
 expect(!store.get('approvals',failed[0]).reminded_at,'a pass under an hour after the last one ran the sweep');
 now+=30*60000;await scheduler.tick();
 const messages=store.list('note_conversations').flatMap(chat=>chat.state?.messages||[]).map(message=>message.content);
 const marked=Object.fromEntries(Object.entries(ids).map(([name,id])=>[name,Boolean(store.get('approvals',id).reminded_at)]));
 expect(marked.due&&marked.retry&&marked.telegram&&marked.young&&marked.outward,'eligible reminders were not marked after delivery');
 expect(!marked.old&&!marked.expired&&!marked.answered&&!marked.quiet&&!marked.legacy,'an ineligible reminder was marked');
 expect(store.get('approvals',ids.outward).status==='pending','the reminder answered or performed the outward step');
 const before=messages.length;
 now+=3600000;await scheduler.tick();
 const after=store.list('note_conversations').flatMap(chat=>chat.state?.messages||[]).length;
 expect(after===before,'a marked reminder repeated');

 return {at:AT.toISOString(),path:'NativeScheduler.tick',failed_first_pass:Object.keys(ids).find(name=>ids[name]===failed[0]),failures,telegram:{chat:'telegram',text:telegram.text,marked_after_delivery:marked.telegram},notebook:{chat:'notebook',messages},marked,statuses:Object.fromEntries(Object.entries(ids).map(([name,id])=>[name,store.get('approvals',id).status])),second_marked_pass_added_messages:after-before};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const root=process.argv[2];
 if(!root){process.stderr.write('usage: node notebook/scripts/waiting-step-verifier.mjs <empty-workspace>\n');process.exit(2);}
 verifyWaitingStepReminders(path.resolve(root)).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exit(1);});
}
