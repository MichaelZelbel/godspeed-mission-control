// One row of Settings > Routines in plain words: what the routine is, when it runs, when it runs
// next, when it last ran and whether that worked, and whether it is paused. Until 8 October 2026 a
// Hermes routine showed "<skill>: scheduled. Next: 2026-10-09T05:30:00+02:00" and nothing about
// its last run, though Hermes keeps both (cron/jobs.json, last_run_at and last_status).
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const two=n=>String(n).padStart(2,'0');
const listWords=items=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+' and '+items.at(-1);

// "30 5 * * *" and its simple relatives in words; anything else as Hermes wrote it.
export function scheduleWords(schedule){
 const text=String(schedule||'').trim();if(!text)return '';
 let m=/^(?:every\s+)?(\d+)\s*m(?:in(?:ute)?s?)?$/i.exec(text);if(m)return Number(m[1])===1?'every minute':'every '+m[1]+' minutes';
 m=/^(?:every\s+)?(\d+)\s*h(?:ours?)?$/i.exec(text);if(m)return Number(m[1])===1?'every hour':'every '+m[1]+' hours';
 const parts=text.split(/\s+/);if(parts.length!==5)return text;
 const [minute,hour,dom,month,dow]=parts;
 m=/^\*\/(\d+)$/.exec(minute);if(m&&hour==='*'&&dom==='*'&&month==='*'&&dow==='*')return 'every '+m[1]+' minutes';
 if(!/^\d+$/.test(minute)||!/^\d+(,\d+)*$/.test(hour)||month!=='*')return text;
 const times=listWords(hour.split(',').map(h=>two(h)+':'+two(minute)));
 if(dom==='*'&&dow==='*')return 'every day at '+times;
 if(dom==='*'&&/^[0-7](,[0-7])*$/.test(dow)){const days=dow.split(',').map(d=>DAYS[Number(d)%7]);return (dow==='1,2,3,4,5'?'every weekday':'every '+listWords(days))+' at '+times;}
 if(dom==='*'&&dow==='1-5')return 'every weekday at '+times;
 if(/^\d+$/.test(dom)&&dow==='*')return 'on day '+dom+' of every month at '+times;
 return text;
}

export function whenWords(value,{now=Date.now(),timeZone}={}){
 const at=Date.parse(value||'');if(!Number.isFinite(at))return '';
 const day=d=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
 const time=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
 if(day(at)===day(now))return 'today at '+time;
 if(day(at)===day(now+86400000))return 'tomorrow at '+time;
 if(day(at)===day(now-86400000))return 'yesterday at '+time;
 return new Intl.DateTimeFormat('en-GB',{timeZone,weekday:'long',day:'numeric',month:'long'}).format(at)+' at '+time;
}

const firstLine=text=>String(text||'').split('\n').map(l=>l.trim()).find(Boolean)||'';
// Hermes writes a failed script as "Script exited with code 1\nstderr:\n<what the script said>";
// the starting routines say what went wrong in their first line there.
const errorWords=text=>{const said=/\bstderr:\s*\n\s*(\S[^\n]*)/.exec(String(text||''));return (said?said[1]:firstLine(text)).trim();};
export function lastRunWords(job,options={}){
 if(job.native){
  if(!job.last_run_at)return 'It has not run yet.';
  const when=whenWords(job.last_run_at,options),status=String(job.last_status||'');
  if(status==='ok')return 'Last ran '+when+', and it worked.';
  if(status==='delivery_failed')return 'Last ran '+when+'. It worked, but its message could not be sent.';
  if(status==='error')return 'Last ran '+when+', and it failed'+(job.last_error?': '+errorWords(job.last_error).slice(0,200):'.');
  if(status==='blocked_config')return 'Last ran '+when+', and it could not start: the assistant\'s settings need a look.';
  return 'Last ran '+when+(status?' ('+status.replaceAll('_',' ')+').':'.');
 }
 return job.last_outcome?'Last run: '+job.last_outcome:'';
}

export function routineRow(job,options={}){
 const paused=!!job.paused,schedule=job.native?scheduleWords(job.schedule):(job.interval_ms?'every '+Math.round(job.interval_ms/60000)+' minutes':'');
 const next=paused?'Paused. Nothing runs until you resume it.':job.next_run?'Next run '+whenWords(job.next_run,options)+'.':'';
 return {name:job.title||job.kind||'Routine',what:job.what||'',when:schedule?'Runs '+schedule+'.':'',next,last:lastRunWords(job,options),paused};
}
