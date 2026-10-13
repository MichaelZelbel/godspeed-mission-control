// A private local picture composed from verified progress and shared original character art.
// This module changes presentation only. The coach owns all dates, totals and permissions.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import imageScript from '../recipes/social-visuals/scripts/vendor/imagescript/ImageScript.js';
const {Image}=imageScript;
const fontFile=fileURLToPath(new URL('./progress-assets/NotoSans.ttf',import.meta.url));
const artRoot=fileURLToPath(new URL('./progress-assets/playful/',import.meta.url));
const boldFile=path.join(artRoot,'NotoSans-Bold.ttf');
const WIDTH=840,RENDER_VERSION=2,ink='#342b40',muted='#706475',paper='#fffaf0',warm='#df6237',blue='#247b98';
const dictionaries={
 en:{brand:'Godspeed Mission Control',lifetime:'Completed days, all time',run:'Current streak',unit:'completed days',today:'Today',completed:'Done',protected:'Protected',paused:'Paused',notplanned:'Rest day',unknown:'Not recorded',missed:'Gap in record',notdone:'Not done',coverage:'Earlier streak history is incomplete.',safe:'Your progress is safe.',noDue:'No action due today.',pauseTitle:'On pause',restTitle:'Rest easy',next:'Next spark',doneTitle:'That counts!',calm:'Your pace',tiny:'YOUR TINY WIN TODAY',kept:'TODAY, KEPT',pausedHabit:'PAUSE IS PART OF THE PLAN',rest:'A LITTLE ROOM FOR LIFE',tell:'Tell me when you have done it.',iceOne:'1 ice save for missed planned days. A gap without ice can end this streak.',iceMany:n=>`${n} ice saves for missed planned days. A gap without ice can end this streak.`,noIce:'No ice left. A gap can end this streak.',newIce:'Ice helps with your next streak.',restIce:'Rest uses no ice.',pausedIce:'Pauses use no ice.',forever:'Yours, through every break.',short:{completed:'Done',protected:'Ice',paused:'Pause',notplanned:'Rest',unknown:'Ready',missed:'Gap',notdone:'No'}},
 de:{brand:'Godspeed Mission Control',lifetime:'Erledigte Tage insgesamt',run:'Aktuelle Serie',unit:'erledigte Tage',today:'Heute',completed:'Erledigt',protected:'Geschützt',paused:'Pausiert',notplanned:'Freier Tag',unknown:'Nicht erfasst',missed:'Lücke im Verlauf',notdone:'Nicht erledigt',coverage:'Frühere Serien sind nicht vollständig erfasst.',safe:'Dein Fortschritt bleibt.',noDue:'Heute ist nichts fällig.',pauseTitle:'Pausiert',restTitle:'Ruhe tut gut',next:'Neuer Funke',doneTitle:'Das zählt!',calm:'Dein Tempo',tiny:'DEIN KLEINER SCHRITT HEUTE',kept:'HEUTE GESCHAFFT',pausedHabit:'PAUSEN GEHÖREN DAZU',rest:'PLATZ FÜR DAS LEBEN',tell:'Sag mir, wenn du es geschafft hast.',iceOne:'1 Eisschutz für verpasste Tage. Ohne Eis kann eine Lücke die Serie beenden.',iceMany:n=>`${n} Eisschützer für verpasste Tage. Ohne Eis kann eine Lücke die Serie beenden.`,noIce:'Kein Eis mehr. Eine Lücke kann die Serie beenden.',newIce:'Eis hilft bei deiner nächsten Serie.',restIce:'Freie Tage brauchen kein Eis.',pausedIce:'Pausen brauchen kein Eis.',forever:'Bleibt bei dir, auch nach einer Pause.',short:{completed:'Fertig',protected:'Eis',paused:'Pause',notplanned:'Frei',unknown:'Bereit',missed:'Lücke',notdone:'Nein'}}
};
const clean=value=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
const calendarState=day=>day.status==='missed'&&day.answer==='no'?'notdone':day.status;
export const escapeSvg=value=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function wrap(value,limit,max=Infinity){
 const words=clean(value).split(' '),out=[];let line='';
 for(let word of words){while(word.length>limit){if(line){out.push(line);line='';}out.push(word.slice(0,limit));word=word.slice(limit);}if(!word)continue;if(line&&line.length+1+word.length>limit){out.push(line);line=word;}else line+=(line?' ':'')+word;}
 if(line)out.push(line);if(out.length>max){out.length=max;out[max-1]=out[max-1].slice(0,-1)+'…';}return out.length?out:[''];
}
function valid(habit){
 const p=habit?.progress;if(p?.version!==1||!Array.isArray(p.calendar)||!/^\d{4}-\d{2}-\d{2}$/.test(p.today))throw Error('Saved habit progress is required');
 for(const key of ['currentRun','lifetimeCompletedDays'])if(!Number.isSafeInteger(p[key])||p[key]<0)throw Error('Invalid habit completion total');
 if(p.protections&&(!Number.isInteger(p.protections.remaining)||p.protections.remaining<0||p.protections.remaining>2))throw Error('Invalid saved ice allowance');
 const seen=new Set();for(const day of p.calendar){if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||new Date(day.date+'T12:00:00Z').toISOString().slice(0,10)!==day.date||seen.has(day.date)||!['completed','protected','paused','notplanned','unknown','missed'].includes(day.status))throw Error('Invalid habit calendar');seen.add(day.date);}
 return p;
}
function context(habit,p,lang){
 const d=dictionaries[lang],today=p.calendar.find(day=>day.date===p.today),status=habit.habit_status||habit.status;
 const paused=status==='paused',inactive=paused||['graduated','dropped'].includes(status);
 const rest=!inactive&&(today?.status==='paused'||today?.status==='notplanned'||today?.scheduled===false);
 const done=!inactive&&!rest&&today?.status==='completed',protectedDay=!inactive&&!rest&&today?.status==='protected';
 const calm=p.display==='calm',state=inactive?'paused':rest?'rest':done?'done':protectedDay?'protected':'ready';
 const hero=calm?'flame-rest':({paused:'flame-rest',rest:'flame-rest',done:'flame-done',protected:'flame-ice',ready:'flame-ready'})[state];
 const headline=inactive?d.pauseTitle:rest?d.restTitle:calm?d.calm:p.currentRun>0?null:done?d.doneTitle:d.next;
 const subtitle=inactive||rest?d.safe:done?(lang==='de'?'Geschafft. Ein Tag bleibt bei dir.':'You did it. A day to keep.'):protectedDay?(lang==='de'?'Das Eis hat deine Serie bewahrt.':'Ice kept your streak safe.'):p.currentRun===0?(lang==='de'?'Ein kleiner Schritt reicht.':'One small step is enough.'):(lang==='de'?'Ein Tag nach dem anderen.':'One day at a time.');
 const heading=inactive?d.pausedHabit:rest?d.rest:done?d.kept:d.tiny;
 const name=clean(habit.name||habit.title),action=clean(habit.doneMeans||habit.minimum||name);
 const body=inactive||rest?d.noDue:action;
 const invitation=paused?(lang==='de'?`Wenn du bereit bist: „resume ${name}“.`:`When ready, say “resume ${name}”.`):inactive||rest?'':done?(lang==='de'?'Das war dein Schritt für heute.':'That is your step for today.'):d.tell;
 return {state,hero,headline,subtitle,heading,body,invitation,calm,paused,inactive,rest};
}
function picture(habit,{locale='en'}={}){
 const p=valid(habit),lang=String(locale).startsWith('de')?'de':'en',d=dictionaries[lang],c=context(habit,p,lang),n=new Intl.NumberFormat(locale),text=[],shapes=[],art=[];
 const add=(value,x,y,size=32,color=ink,anchor='start',maxWidth=WIDTH-96,bold=false)=>text.push({value:clean(value),x,y,size,color,anchor,maxWidth,bold});
 const titles=wrap(habit.name||habit.title,34,2),extraTitle=(titles.length-1)*46;
 add(d.brand,420,44,25,muted,'middle',744);titles.forEach((line,i)=>add(line,420,103+i*46,46,ink,'middle',744,true));
 const heroY=133+extraTitle;shapes.push(`<ellipse cx="190" cy="${heroY+121}" rx="153" ry="131" fill="#ffeed6"/>`);
 art.push({name:c.hero,x:64,y:heroY,width:256,height:256,opacity:1});
 const countY=heroY+138;
 if(!c.headline){
  add(n.format(p.currentRun),390,countY,Math.max(64,112-Math.max(0,String(p.currentRun).length-4)*8),warm,'start',382,true);
  const unit=lang==='de'?(p.currentRun===1?'Tag in deiner Serie':'Tage in deiner Serie'):(p.currentRun===1?'day in your streak':'days in your streak');
  wrap(unit,20,2).forEach((line,i)=>add(line,391,countY+48+i*39,36,ink,'start',382));
 }else wrap(c.headline,14,2).forEach((line,i)=>add(line,374,heroY+103+i*65,58,ink,'start',400,true));
 wrap(c.subtitle,21,2).forEach((line,i)=>add(line,374,heroY+221+i*37,34,ink,'start',405));
 const panelY=heroY+280,body=wrap(c.body,32),invitation=wrap(c.invitation,37,3).filter(Boolean);
 const panelHeight=88+body.length*45+(invitation.length?30+invitation.length*36:0);
 shapes.push(`<rect x="38" y="${panelY}" width="764" height="${panelHeight}" rx="30" fill="${c.inactive||c.rest?'#edf5ed':c.state==='done'?'#fff0cd':'#fff0e2'}"/>`);
 add(c.heading,68,panelY+42,27,c.inactive||c.rest?'#52735c':warm,'start',704);
 body.forEach((line,i)=>add(line,68,panelY+91+i*45,40,ink,'start',704,true));
 invitation.forEach((line,i)=>add(line,68,panelY+98+body.length*45+i*36,34,ink,'start',704));
 let nextY=panelY+panelHeight+25;
 if(!c.calm&&p.protections?.remaining!==undefined){
  const remaining=p.protections.remaining;for(let i=0;i<2;i++)art.push({name:'flame-ice',x:46+i*59,y:nextY-8,width:62,height:62,opacity:i<remaining?1:0.22});
  const ready=lang==='de'?`${remaining} ${remaining===1?'Eisschutz bereit':'Eisschützer bereit'}`:`${remaining} ${remaining===1?'freeze ready':'freezes ready'}`;
  add(ready,184,nextY+30,36,ink,'start',610,true);
  const explanation=c.inactive?d.pausedIce:c.rest?d.restIce:p.currentRun===0?d.newIce:null;
  const explained=explanation?wrap(explanation,40,3):lang==='de'?['Eis schützt verpasste geplante Tage.','Ohne Eis kann eine Lücke die Serie beenden.']:['Ice covers missed planned days.','Without ice, a gap can end this streak.'];
  explained.forEach((line,i)=>add(line,68,nextY+75+i*38,34,ink,'start',704));nextY+=86+explained.length*38;
 }
 const weekY=nextY+9,days=p.calendar.filter(day=>day.date<=p.today).sort((a,b)=>a.date.localeCompare(b.date)).slice(-7),start=36,gap=110;
 days.forEach((day,i)=>{
  const x=start+i*gap,date=new Date(day.date+'T12:00:00Z'),state=calendarState(day),isToday=day.date===p.today;
  if(isToday)shapes.push(`<rect x="${x+1}" y="${weekY-4}" width="108" height="218" rx="24" fill="#ffedc8" stroke="#ecb56d" stroke-width="2"/>`);
  add(new Intl.DateTimeFormat(locale,{weekday:'short',timeZone:'UTC'}).format(date).replace(/\.$/,''),x+55,weekY+34,36,ink,'middle',102,true);
  add(new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',timeZone:'UTC'}).format(date).replaceAll('.',''),x+55,weekY+70,34,ink,'middle',102);
  if(['completed','protected','paused','notplanned'].includes(state)){
   const name=state==='completed'?'flame-done':state==='protected'?'flame-ice':'flame-rest';art.push({name,x:x+10,y:weekY+80,width:90,height:90,opacity:1});
  }else if(state==='unknown'&&isToday){
   shapes.push(`<path data-mark="waiting-spark" d="M${x+55} ${weekY+87}Q${x+72} ${weekY+109} ${x+67} ${weekY+120}Q${x+83} ${weekY+119} ${x+83} ${weekY+139}Q${x+83} ${weekY+161} ${x+55} ${weekY+162}Q${x+27} ${weekY+161} ${x+27} ${weekY+139}Q${x+27} ${weekY+123} ${x+43} ${weekY+114}Q${x+41} ${weekY+133} ${x+49} ${weekY+131}Q${x+61} ${weekY+122} ${x+55} ${weekY+87}Z" fill="#fffaf0" stroke="${muted}" stroke-width="5" stroke-linejoin="round"/>`);
  }else if(state==='unknown'){
   shapes.push(`<g data-mark="not-recorded">${[-18,0,18].map(offset=>`<circle cx="${x+55+offset}" cy="${weekY+127}" r="5" fill="${muted}"/>`).join('')}</g>`);
  }else{shapes.push(`<circle cx="${x+55}" cy="${weekY+126}" r="31" fill="#eee8e0" stroke="#b4a6a7" stroke-width="2" stroke-dasharray="${state==='missed'?'5 6':'0'}"/>`);add(state==='notdone'?'×':'·',x+55,weekY+145,48,muted,'middle',90);}
  if(state!=='unknown'||isToday)add(d.short[state],x+55,weekY+191,34,ink,'middle',102);if(isToday)add(d.today,x+55,weekY+241,34,ink,'middle',102);
 });
 const lifetimeY=weekY+265;shapes.push(`<rect x="38" y="${lifetimeY}" width="764" height="119" rx="28" fill="#f3ebfa"/>`);
 const lifetime=lang==='de'?`${n.format(p.lifetimeCompletedDays)} ${p.lifetimeCompletedDays===1?'erledigter Tag':'erledigte Tage'}`:`${n.format(p.lifetimeCompletedDays)} ${p.lifetimeCompletedDays===1?'completed day':'completed days'}`;
 add(lifetime,68,lifetimeY+48,46,ink,'start',704,true);add(d.forever,68,lifetimeY+92,34,ink,'start',704);
 const height=lifetimeY+143;shapes.unshift(`<rect width="${WIDTH}" height="${height}" fill="${paper}"/>`);return {p,c,text,shapes,art,height};
}
export function habitProgressText(habit,{locale='en'}={}){
 const p=valid(habit),lang=String(locale).startsWith('de')?'de':'en',d=dictionaries[lang],n=new Intl.NumberFormat(locale),c=context(habit,p,lang);
 return [clean(habit.name||habit.title),c.headline,c.subtitle,c.body,c.invitation,`${d.lifetime}: ${n.format(p.lifetimeCompletedDays)}`,...(p.display==='calm'?[]:[`${d.run}: ${n.format(p.currentRun)} ${lang==='de'?(p.currentRun===1?'erledigter Tag':d.unit):(p.currentRun===1?'completed day':d.unit)}`]),...p.calendar.filter(day=>day.date<=p.today).sort((a,b)=>a.date.localeCompare(b.date)).slice(-7).map(day=>`${new Intl.DateTimeFormat(locale,{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(day.date+'T12:00:00Z'))}: ${day.date===p.today&&day.status==='unknown'?(lang==='de'?'Noch nicht erfasst':'Not recorded yet'):d[calendarState(day)]}`),...(p.coverage?.scheduleHistoryComplete===false?[d.coverage]:[])].filter(Boolean).join('\n');
}
export function habitProgressSvg(habit,options){
 const {text,shapes,art,height}=picture(habit,options);
 const pictures=art.map(a=>`<image data-character="${a.name}" x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" opacity="${a.opacity}" href="data:image/png;base64,${fs.readFileSync(path.join(artRoot,a.name+'.png')).toString('base64')}"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img"><title>${escapeSvg(habitProgressText(habit,options))}</title>${shapes.join('')}${pictures}${text.map(t=>`<text x="${t.x}" y="${t.y}" font-family="Noto Sans, sans-serif" font-size="${t.size}" font-weight="${t.bold?700:400}" fill="${t.color}" text-anchor="${t.anchor}">${escapeSvg(t.value)}</text>`).join('')}</svg>`;
}
export async function habitProgressPng(habit,options){
 const {text,shapes,art,height}=picture(habit,options),font=fs.readFileSync(fontFile),bold=fs.readFileSync(boldFile);
 const image=await Image.renderSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">${shapes.join('')}</svg>`);
 const decoded=new Map();for(const a of art){if(!decoded.has(a.name))decoded.set(a.name,fs.readFileSync(path.join(artRoot,a.name+'.png')));const sprite=(await Image.decode(decoded.get(a.name))).resize(a.width,a.height).opacity(a.opacity);image.composite(sprite,a.x,a.y);}
 for(const t of text){if(!t.value)continue;let bitmap=await Image.renderText(t.bold?bold:font,t.size,t.value,Number.parseInt(t.color.slice(1)+'ff',16));if(bitmap.width>t.maxWidth)bitmap=bitmap.resize(t.maxWidth,Math.round(bitmap.height*t.maxWidth/bitmap.width));image.composite(bitmap,Math.round(t.x-(t.anchor==='middle'?bitmap.width/2:0)),Math.round(t.y-t.size));}
 return Buffer.from(await image.encode(1,{creationTime:0}));
}
export async function saveHabitProgressImage(habit,{directory,locale='en',requestId=null}={}){
 if(!directory)throw Error('Choose a private progress picture directory');
 const digest=createHash('sha256').update(JSON.stringify({habit,locale,requestId,renderer:RENDER_VERSION})).digest('hex').slice(0,24);
 const file=path.join(directory,'habit-progress-'+digest+'.png');fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(!fs.existsSync(file))fs.writeFileSync(file,await habitProgressPng(habit,{locale}),{mode:0o600});
 return {path:file,mime:'image/png',alt:habitProgressText(habit,{locale})};
}
