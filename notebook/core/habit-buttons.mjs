// Native Telegram UI only. The model cannot describe a mutation here: the server chooses a
// bounded action from a freshly read canonical habit and gives the keyboard an opaque token.
// Receipts live on this host, separately from uncertain Telegram delivery. No notebook scan.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store,atomic,hash} from './records/store.mjs';
import {habitOperation,findHabits,habitId} from './habit-trackers.mjs';
import {rememberFile} from './native-personal.mjs';
import {readHabit} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';
import {habitProgress} from '../../third-party/addons/godspeed-coach/lib/progress.mjs';
import {loadSettings} from '../../third-party/addons/godspeed-coach/lib/settings.mjs';
import {addDays,zonedToUtc} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

const PREFIX='gsh1:',MAX_TOKENS=4096,RETENTION=30*86400000;
const id=value=>typeof value==='number'&&!Number.isSafeInteger(value)?null:/^[1-9]\d{0,19}$/.test(String(value))?String(value):null;
const tokenId=value=>typeof value==='string'&&/^gsh1:[a-f0-9]{32}$/.test(value)?value.slice(PREFIX.length):null;
const denied=()=>({ok:false,status:'denied',buttons:[],notice:'This button is not available in this chat.'});
const words={
 en:{done:'I did it',resume:'Resume',undo:'Undo',applied:'Saved. Your progress is up to date.',resumed:'Resumed. Your habit is active again.',undone:'Undone. Your previous answer is restored.',already:'Already saved. Nothing was added twice.',doneElsewhere:'Already completed today. Nothing was added twice.',stale:'This card has changed or expired. Use the refreshed card below.',unbound:'This card could not be confirmed. Ask for a fresh habit card.',uncertain:'I could not confirm this save. Check the refreshed progress before asking for a new card.',correction:'To correct a day, tell me the habit and date to change.'},
 de:{done:'Erledigt',resume:'Fortsetzen',undo:'Rückgängig',applied:'Gespeichert. Dein Fortschritt ist aktuell.',resumed:'Fortgesetzt. Deine Gewohnheit ist wieder aktiv.',undone:'Rückgängig gemacht. Deine vorherige Antwort ist wiederhergestellt.',already:'Schon gespeichert. Es wurde nichts doppelt hinzugefügt.',doneElsewhere:'Heute bereits erledigt. Es wurde nichts doppelt hinzugefügt.',stale:'Diese Karte hat sich geändert oder ist abgelaufen. Nutze die aktualisierte Karte unten.',unbound:'Diese Karte konnte nicht bestätigt werden. Bitte um eine neue Karte.',uncertain:'Ich konnte das Speichern nicht bestätigen. Prüfe den aktualisierten Fortschritt, bevor du um eine neue Karte bittest.',correction:'Um einen Tag zu korrigieren, nenne mir die Gewohnheit und das Datum.'},
};
function authenticate(input,env){
 const allowed=String(env.TELEGRAM_ALLOWED_USERS||'').trim().split(/[\s,]+/).filter(Boolean);
 const owner=allowed.length===1?id(allowed[0]):null;
 if(!owner||input.chatType!=='private'||[input.ownerId,input.userId,input.chatId].some(v=>id(v)!==owner)||!id(input.botId))return null;
 return {ownerId:owner,userId:owner,chatId:owner,chatType:'private',botId:id(input.botId)};
}
// Only the writer lock is reused. Constructing Store would load all personal records, migrate
// their layout and replay unrelated transactions; a habit tap needs none of that.
function narrowStore(root){
 const store=Object.create(Store.prototype);store.root=fs.realpathSync(root);store.state=path.join(store.root,'.godspeed');
 store.get=()=>null;fs.mkdirSync(store.state,{recursive:true});return store;
}
const snapshot=h=>({name:h.title,minimum:h.doneMeans,status:h.status,days:h.days,timezone:h.timezone,started:h.started,display:h.progressDisplay,history:h.progressHistory});
function context(store,h,now){
 const zone=h.timezone||loadSettings(store.root).timezone;
 const progress=habitProgress(h,{now,timezone:zone});
 const habit={id:habitId(h),name:h.title,status:h.status,doneMeans:h.doneMeans,days:h.days,daysText:h.daysText,started:h.started,progress};
 const day=progress.calendar.find(d=>d.date===progress.today);
 const action=h.status==='paused'?'resume':h.status==='active'&&day?.scheduled&&!['completed','paused','notplanned'].includes(day.status)?'done':null;
 return {habit,action,zone,day,hash:hash(fs.readFileSync(h.file)),shown:snapshot(h)};
}
function save(file,value){atomic(file,JSON.stringify(value)+'\n');fs.chmodSync(file,0o600);}
function gc(directory,now){
 let count=0;
 for(const name of fs.readdirSync(directory)){
  if(!/^[a-f0-9]{32}\.json$/.test(name))continue;
  const file=path.join(directory,name);let value;
  try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{count++;continue;}
  if(Number.isFinite(value.createdAt)&&now-value.createdAt>RETENTION)fs.unlinkSync(file);else count++;
 }
 if(count>=MAX_TOKENS)throw Error('Too many active habit buttons');
}
function create(directory,workspace,auth,ctx,now,{locale='en',messageId=null,action=ctx.action,parent=null}={}){
 if(!action)return null;
 gc(directory,now.getTime());const key=randomBytes(16).toString('hex'),callbackData=PREFIX+key;
 const token={version:1,key,workspace,...auth,messageId,habitId:ctx.habit.id,action,date:ctx.habit.progress.today,timezone:ctx.zone,
  sourceHash:ctx.hash,shown:ctx.shown,createdAt:now.getTime(),expiresAt:Math.min(now.getTime()+86400000,zonedToUtc(addDays(ctx.habit.progress.today,1),'00:00',ctx.zone).getTime()),
  locale:locale==='de'?'de':'en',state:'ready',parent};
 save(path.join(directory,key+'.json'),token);return {text:words[token.locale][action],callbackData};
}
const correction=locale=>words[locale].correction;

export function habitButtonAction(root,input,{env=process.env,now=new Date(),checkpoint=()=>{}}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||!['issue','bind','tap'].includes(input.command))return denied();
 const auth=authenticate(input,env);if(!auth)return denied();
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('A valid clock is required');
 const key=input.command==='issue'?null:tokenId(input.callbackData);
 if(input.command!=='issue'&&(!key||!id(input.messageId)))return denied();
 if(input.command==='issue'&&(typeof input.habitId!=='string'||input.habitId.length>160||!input.habitId.startsWith('habit-')))return denied();
 const store=narrowStore(root),workspace=hash(store.root),directory=path.join(store.state,'habit-buttons');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 return store.withLockSoon(()=>{
  let token=null,file=null;
  if(key){
   file=path.join(directory,key+'.json');try{token=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return denied();}
   if(token.version!==1||token.key!==key||token.workspace!==workspace||Object.entries(auth).some(([k,v])=>token[k]!==v))return denied();
   if(token.messageId!==null&&token.messageId!==id(input.messageId))return denied();
  }
  const found=findHabits(store,token?.habitId||input.habitId);
  if(found.length!==1||habitId(found[0])!==(token?.habitId||input.habitId))return {ok:false,status:'missing',buttons:[],notice:'This habit no longer exists.'};
  let h=found[0],ctx=context(store,h,now);const locale=token?.locale||(input.locale==='de'?'de':'en'),w=words[locale];
  const response=(ok,status,notice,buttons=[])=>({ok,status,locale,habit:ctx.habit,buttons,notice});
  const refresh=(status,notice)=>response(false,status,notice+' '+correction(locale),[create(directory,workspace,auth,ctx,now,{locale,messageId:token?.messageId})].filter(Boolean));
  if(input.command==='issue')return response(true,'issued',correction(locale),[create(directory,workspace,auth,ctx,now,{locale})].filter(Boolean));
  if(input.command==='bind'){
   if(now.getTime()>=token.expiresAt||ctx.habit.progress.today!==token.date)return refresh('stale',w.stale);
   if(token.messageId===null){token.messageId=id(input.messageId);save(file,token);}
   return response(true,'bound',null);
  }
  if(token.messageId===null)return response(false,'unbound',w.unbound);

  const receiptButtons=()=>{
   if(!token.undo)return [];
   const undoKey=tokenId(token.undo.callbackData);let undo;
   try{undo=JSON.parse(fs.readFileSync(path.join(directory,undoKey+'.json'),'utf8'));}catch{return [];}
   return undo.state==='ready'&&undo.sourceHash===ctx.hash&&undo.expiresAt>now.getTime()?[token.undo]:[];
  };
  if(token.state==='applied')return response(true,'already-applied',w.already+' '+correction(locale),receiptButtons());
  if(token.state==='applying'){
   // A crash may have happened after the atomic swap but before the receipt. Exact bytes
   // prove that save. Anything ambiguous is consumed, never automatically attempted again.
   if(ctx.hash!==token.afterHash){token.state='uncertain';save(file,token);return refresh('uncertain',w.uncertain);}
   token.state='applied';token.appliedAt=now.getTime();save(file,token);
   return response(true,'already-applied',w.already+' '+correction(locale));
  }
  if(token.state!=='ready')return refresh('uncertain',w.uncertain);
  if(now.getTime()>=token.expiresAt||ctx.habit.progress.today!==token.date||ctx.zone!==token.timezone)return refresh('stale',w.stale);
  if(hash(ctx.shown)!==hash(token.shown))return refresh('stale',w.stale);
  if(token.action==='done'&&ctx.day.answer==='done'){
   token.state='applied';token.appliedAt=now.getTime();token.noWrite=true;save(file,token);return response(true,'already-done',w.doneElsewhere+' '+correction(locale));
  }
  if(ctx.hash!==token.sourceHash||(!['undo'].includes(token.action)&&ctx.action!==token.action))return refresh('stale',w.stale);
  if(token.action==='undo'&&h.log[token.date]?.source!=='telegram-button:'+token.parent)return refresh('stale',w.stale);

  // Run the canonical owner UI operation on one isolated copy. Its exact output is committed
  // atomically under the real writer lock, so a crash cannot truncate the authoritative habit.
  // This is still the same model/validation/history code; the service invents no progress math.
  const stage=fs.mkdtempSync(path.join(directory,'stage-'));
  let after;
  const before=fs.readFileSync(h.file,'utf8'),relative=path.relative(store.root,h.file),stageFile=path.join(stage,relative);
  try{
   fs.mkdirSync(path.dirname(stageFile),{recursive:true});fs.writeFileSync(stageFile,before);
   const operation=token.action==='done'?{type:'track',answer:'done',on:token.date,source:'telegram-button:'+key,note:'Telegram button: I did it.'}:
    token.action==='resume'?{type:'habit-progress',action:'resume',on:token.date}:
    {type:'tracker-correct',entry_id:token.date,remove:true};
   habitOperation({root:stage,get:()=>null},{...operation,tracker:token.habitId,expected:token.sourceHash},{now,zone:ctx.zone,assistant:false,evidence:{source:'telegram-button:'+key}});
   after=fs.readFileSync(stageFile,'utf8');
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
  token.state='applying';token.afterHash=hash(after);save(file,token);checkpoint('after-intent');
  // Notebook writers share this lock. A legacy standalone CLI or a person editing Markdown
  // might not; compare the real source again before swapping the projected bytes into place.
  if(hash(fs.readFileSync(h.file))!==token.sourceHash){token.state='uncertain';save(file,token);h=readHabit(h.file);ctx=context(store,h,now);return refresh('stale',w.stale);}
  // The earlier file is preserved exactly as every canonical notebook habit write preserves it.
  // atomic() fsyncs new bytes and the containing directory before the receipt can say applied.
  rememberFile(store,h.file);
  if(hash(fs.readFileSync(h.file))!==token.sourceHash){token.state='uncertain';save(file,token);h=readHabit(h.file);ctx=context(store,h,now);return refresh('stale',w.stale);}
  atomic(h.file,after);checkpoint('after-save');
  h=readHabit(h.file);ctx=context(store,h,now);
  token.state='applied';token.appliedAt=now.getTime();
  if(token.action==='done')token.undo=create(directory,workspace,auth,ctx,now,{locale,messageId:token.messageId,action:'undo',parent:key});
  save(file,token);checkpoint('after-receipt');
  const buttons=token.undo?[token.undo]:[create(directory,workspace,auth,ctx,now,{locale,messageId:token.messageId})].filter(Boolean);
  return response(true,'applied',(token.action==='resume'?w.resumed:token.action==='undo'?w.undone:w.applied)+' '+correction(locale),buttons);
 },{timeoutMs:5000});
}
