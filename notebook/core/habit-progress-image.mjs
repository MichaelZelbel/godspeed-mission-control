// A private, local progress picture. Completion/protection semantics come only from the coach.
// ImageScript and the OFL font are shipped with the kit: no browser, model, CDN or API is needed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import imageScript from '../recipes/social-visuals/scripts/vendor/imagescript/ImageScript.js';
const {Image}=imageScript;
const fontFile=fileURLToPath(new URL('./progress-assets/NotoSans.ttf',import.meta.url));
const WIDTH=840,HEIGHT=1140;
const ink='#19332e',muted='#486058',paper='#fbfbf5',green='#175c48';
const dictionaries={
 en:{brand:'Godspeed Mission Control',lifetime:'Completed days, all time',run:'Current streak',unit:'completed days',minimum:'Your tiny action',week:'Your last 7 days',today:'Today',completed:'Done',protected:'Protected',paused:'Paused',notplanned:'Rest day',unknown:'Not recorded',missed:'Gap in record',notdone:'Not done',footer:'Rest and protection keep your streak, adding no completed days.',calm:'Your lasting progress',coverage:'Earlier schedules are incomplete.'},
 de:{brand:'Godspeed Mission Control',lifetime:'Erledigte Tage insgesamt',run:'Aktuelle Serie',unit:'erledigte Tage',minimum:'Dein kleiner Schritt',week:'Deine letzten 7 Tage',today:'Heute',completed:'Erledigt',protected:'Geschützt',paused:'Pausiert',notplanned:'Freier Tag',unknown:'Nicht erfasst',missed:'Lücke im Verlauf',notdone:'Nicht erledigt',footer:'Pausen und Schutz erhalten die Serie, zählen aber nicht mit.',calm:'Dein bleibender Fortschritt',coverage:'Frühere Zeitpläne sind unvollständig.'}
};
const clean=value=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const calendarState=day=>day.status==='missed'&&day.answer==='no'?'notdone':day.status;
export const escapeSvg=value=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function lines(value,limit,max=2){
 const words=clean(value).match(new RegExp('.{1,'+limit+'}(?:\\s|$)|.{1,'+limit+'}','gu'))||[''];
 const out=words.map(s=>s.trim()).slice(0,max);if(words.length>max)out[max-1]=out[max-1].slice(0,-1)+'…';return out;
}
function valid(habit){
 const p=habit?.progress;if(p?.version!==1||!Array.isArray(p.calendar)||!/^\d{4}-\d{2}-\d{2}$/.test(p.today))throw Error('Saved habit progress is required');
 for(const key of ['currentRun','lifetimeCompletedDays'])if(!Number.isSafeInteger(p[key])||p[key]<0)throw Error('Invalid habit completion total');
 const seen=new Set();for(const day of p.calendar){if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||new Date(day.date+'T12:00:00Z').toISOString().slice(0,10)!==day.date||seen.has(day.date)||!['completed','protected','paused','notplanned','unknown','missed'].includes(day.status))throw Error('Invalid habit calendar');seen.add(day.date);}
 return p;
}
function mark(state,x,y,size=50){
 const s=size/50,common=`stroke="${ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"`;
 const shapes={completed:`<circle cx="25" cy="25" r="23" fill="${green}"/><path d="M13 25l8 8 16-18" fill="none" stroke="white" stroke-width="5" stroke-linecap="round"/>`,protected:`<path d="M25 2L45 10v15c0 11-12 20-20 24C17 45 5 36 5 25V10z" fill="#e9eedb" ${common}/><path d="M16 24l7 7 12-13" fill="none" ${common}/>`,paused:`<circle cx="25" cy="25" r="23" fill="#edf0eb" ${common}/><path d="M19 16v18m12-18v18" ${common}/>`,notplanned:`<path d="M10 25h30" fill="none" ${common}/>`,unknown:`<circle cx="25" cy="25" r="21" fill="none" ${common} stroke-dasharray="3 8"/>`,missed:`<rect x="5" y="5" width="40" height="40" rx="9" fill="none" ${common}/><path d="M17 25h16" ${common}/>`,notdone:`<circle cx="25" cy="25" r="23" fill="none" ${common}/><path d="M17 17l16 16m0-16L17 33" ${common}/>`};
 return `<g transform="translate(${x},${y}) scale(${s})">${shapes[state]}</g>`;
}
function picture(habit,{locale='en'}={}){
 const p=valid(habit),lang=String(locale).startsWith('de')?'de':'en',d=dictionaries[lang],text=[],shapes=[];
 const add=(value,x,y,size=32,color=ink,anchor='start')=>text.push({value:clean(value),x,y,size,color,anchor});
 shapes.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${paper}"/>`);
 add(d.brand,48,55,28,muted);
 lines(habit.name||habit.title,30,2).forEach((line,i)=>add(line,48,115+i*53,44));
 add(d.minimum,48,218,34,muted);
 lines(habit.doneMeans||habit.minimum||'',39,2).forEach((line,i)=>add(line,48,258+i*42,36));
 shapes.push(`<rect x="32" y="327" width="776" height="211" rx="24" fill="#e9eedb"/>`);
 const number=new Intl.NumberFormat(locale);
 add(number.format(p.lifetimeCompletedDays),54,418,Math.max(42,76-Math.max(0,String(p.lifetimeCompletedDays).length-6)*5),green);
 if(lang==='de'){add('Erledigte Tage',54,466,34);add('insgesamt',54,502,34,muted);}
 else{add('Completed days',54,466,34);add('all time',54,502,34,muted);}
 if(p.display!=='calm'){
  shapes.push(`<path d="M467 361v141" stroke="#9bad9b" stroke-width="2"/>`);
  add(number.format(p.currentRun),494,418,Math.max(40,65-Math.max(0,String(p.currentRun).length-5)*5));
  add(d.run,494,466,34);add(d.unit,494,502,34,muted);
 }
 add(d.week,48,599,34);
 const days=p.calendar.filter(day=>day.date<=p.today).sort((a,b)=>a.date.localeCompare(b.date)).slice(-7),start=32,gap=111;
 days.forEach((day,i)=>{
  const x=start+i*gap,date=new Date(day.date+'T12:00:00Z');
  const weekday=new Intl.DateTimeFormat(locale,{weekday:'short',timeZone:'UTC'}).format(date).replace(/\.$/,'');
  add(weekday,x+55,653,36,ink,'middle');
  add(new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',timeZone:'UTC'}).format(date).replaceAll('.',''),x+55,690,34,muted,'middle');
  shapes.push(mark(calendarState(day),x+30,716));
  if(day.date===p.today)add(d.today,x+55,802,34,green,'middle');
 });
 const states=['completed','protected','paused','unknown','notplanned','missed','notdone'];
 states.forEach((state,i)=>{const x=48+(i%2)*400,y=839+Math.floor(i/2)*51;shapes.push(mark(state,x,y,32));add(d[state],x+47,y+32,38);});
 const footer=p.coverage?.scheduleHistoryComplete===false?d.coverage:d.footer;
 lines(footer,42,2).forEach((line,i)=>add(line,48,1075+i*40,34,muted));
 return {p,text,shapes};
}
export function habitProgressText(habit,{locale='en'}={}){
 const p=valid(habit),d=dictionaries[String(locale).startsWith('de')?'de':'en'],n=new Intl.NumberFormat(locale);
 return [clean(habit.name||habit.title),clean(habit.doneMeans),`${d.lifetime}: ${n.format(p.lifetimeCompletedDays)}`,...(p.display==='calm'?[]:[`${d.run}: ${n.format(p.currentRun)} ${d.unit}`]),...p.calendar.filter(day=>day.date<=p.today).sort((a,b)=>a.date.localeCompare(b.date)).slice(-7).map(day=>`${new Intl.DateTimeFormat(locale,{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(day.date+'T12:00:00Z'))}: ${d[calendarState(day)]}`)].filter(Boolean).join('\n');
}
export function habitProgressSvg(habit,options){
 const {text,shapes}=picture(habit,options);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img"><title>${escapeSvg(habitProgressText(habit,options))}</title>${shapes.join('')}${text.map(t=>`<text x="${t.x}" y="${t.y}" font-family="Noto Sans, sans-serif" font-size="${t.size}" fill="${t.color}" text-anchor="${t.anchor}">${escapeSvg(t.value)}</text>`).join('')}</svg>`;
}
export async function habitProgressPng(habit,options){
 const {text,shapes}=picture(habit,options),font=fs.readFileSync(fontFile);
 const image=await Image.renderSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${shapes.join('')}</svg>`);
 for(const t of text){
  if(!t.value)continue;
  let bitmap=await Image.renderText(font,t.size,t.value,Number.parseInt(t.color.slice(1)+'ff',16));
  const maxWidth=t.anchor==='middle'?102:t.y===418?(t.x<100?386:292):WIDTH-48-t.x;
  if(bitmap.width>maxWidth)bitmap=bitmap.resize(maxWidth,Math.round(bitmap.height*maxWidth/bitmap.width));
  const x=Math.round(t.x-(t.anchor==='middle'?bitmap.width/2:0));
  image.composite(bitmap,x,Math.round(t.y-t.size));
 }
 return Buffer.from(await image.encode(1,{creationTime:0}));
}
export async function saveHabitProgressImage(habit,{directory,locale='en',requestId=null}={}){
 if(!directory)throw Error('Choose a private progress picture directory');
 const digest=createHash('sha256').update(JSON.stringify({habit,locale,requestId})).digest('hex').slice(0,24);
 const file=path.join(directory,'habit-progress-'+digest+'.png');fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(!fs.existsSync(file))fs.writeFileSync(file,await habitProgressPng(habit,{locale}),{mode:0o600});
 return {path:file,mime:'image/png',alt:habitProgressText(habit,{locale})};
}
