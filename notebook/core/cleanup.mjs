import fs from 'node:fs';
import path from 'node:path';

// THE NIGHTLY CLEANUP OF GODSPEED'S OWN WORKING FILES (#238). The assistant leaves request dumps and
// session transcripts in the sessions folder of its home and of every profile, and Godspeed's routines
// leave a folder of run files for every day they ran. Nothing read them again and nothing removed
// them, so on a small server they filled the disk within months.
//
// THE ONE LIST OF PLACES is here. Disposable files inside it go when they have not been touched
// for 30 days; the work runner's fixed-depth before.txt undo backup stays. Nothing outside the
// list is ever looked at, so a database, a .env, a configuration, a skill, the notebook, the chat
// archive, a backup or an upgrade copy cannot be reached. A link is never followed (every entry is
// read with lstat, and only a regular file is removed) and a folder on another file system is never
// entered.
export const KEEP_DAYS=30;

// In the assistant's home and every profile of it: sessions/<these>, except every file of a session
// that sessions/sessions.json still lists (the assistant resumes those).
const SESSION_FILES=[/^request_dump_.*\.json$/,/^session_.*\.json$/,/\.jsonl$/];
// The run files Godspeed's own routines write, one folder per day under each of these: research
// (mc-research), work (mc-work-run), next-action (mc-decide) and coach-prep (mc-coach-prep).
export const RUN_LOG_FOLDERS=['routines/research','routines/work','routines/next-action','routines/coach-prep'];
const DAY_FOLDER=/^\d{4}-\d{2}-\d{2}$/;
const isWorkUndoBackup=(name,depth)=>depth===1&&name==='before.txt';
// Shorter strings in sessions.json are words (a platform, a mode), not ids a file name could carry.
const MIN_ID=8;

const lstat=p=>{try{return fs.lstatSync(p);}catch{return null;}};
const realFolder=(p,dev)=>{const s=lstat(p);return !!s&&s.isDirectory()&&(dev===undefined||s.dev===dev);};

// The text of every string in sessions.json is kept as an id: a file whose name carries one stays.
// null when the file is there but unreadable or not JSON; the folder is then left alone.
function listedSessions(folder){
 let text;try{text=fs.readFileSync(path.join(folder,'sessions.json'),'utf8');}catch(error){return error.code==='ENOENT'?[]:null;}
 let data;try{data=JSON.parse(text);}catch{return null;}
 const ids=[];
 (function walk(value){
  if(typeof value==='string'){if(value.length>=MIN_ID)ids.push(value);}
  else if(value&&typeof value==='object')for(const inner of Object.values(value))walk(inner);
 })(data);
 return ids;
}

function removeIfOld(file,dev,cutoff,freed){
 const stat=lstat(file);
 if(!stat||!stat.isFile()||stat.dev!==dev||stat.mtimeMs>=cutoff)return;
 try{fs.unlinkSync(file);freed.files++;freed.bytes+=stat.size;}catch{freed.failed=true;}
}

function sweepSessions(folder,dev,cutoff,freed){
 const stat=lstat(folder);
 if(!stat||!stat.isDirectory()||stat.dev!==dev)return;
 const listed=listedSessions(folder);
 if(!listed)return;
 for(const name of fs.readdirSync(folder)){
  if(!SESSION_FILES.some(pattern=>pattern.test(name))||listed.some(id=>name.includes(id)))continue;
  removeIfOld(path.join(folder,name),stat.dev,cutoff,freed);
 }
}

function sweepDay(folder,dev,cutoff,freed,keep=(name,depth)=>false,depth=0){
 for(const name of fs.readdirSync(folder)){
  const entry=path.join(folder,name),stat=lstat(entry);
  if(stat?.isDirectory()&&stat.dev===dev)sweepDay(entry,dev,cutoff,freed,keep,depth+1);
  else if(!keep(name,depth))removeIfOld(entry,dev,cutoff,freed);
 }
 try{fs.rmdirSync(folder);}catch{}
}

function sweepRunLogs(folder,dev,cutoff,freed,keep){
 const stat=lstat(folder);
 if(!stat||!stat.isDirectory()||stat.dev!==dev)return;
 for(const name of fs.readdirSync(folder)){
  const day=path.join(folder,name);
  if(DAY_FOLDER.test(name)&&realFolder(day,stat.dev))sweepDay(day,stat.dev,cutoff,freed,keep);
 }
}

const subfolders=(folder,dev)=>{if(!realFolder(folder,dev))return [];try{return fs.readdirSync(folder).map(name=>path.join(folder,name)).filter(p=>realFolder(p,dev));}catch{return [];}};

// What the cleanup looks at: [{name, sweep(cutoff, freed)}], one entry per place.
export function places({root,home}){
 const homeStat=lstat(home),rootStat=lstat(root),homeDev=homeStat?.isDirectory()?homeStat.dev:undefined,rootDev=rootStat?.isDirectory()?rootStat.dev:undefined;
 const homes=homeDev===undefined?[]:[{name:'assistant sessions',folder:home},...subfolders(path.join(home,'profiles'),homeDev).map(p=>({name:'profile '+path.basename(p)+' sessions',folder:p}))];
 return [
  ...homes.map(h=>({name:h.name,sweep:(cutoff,freed)=>sweepSessions(path.join(h.folder,'sessions'),homeDev,cutoff,freed)})),
  ...RUN_LOG_FOLDERS.map(relative=>({name:relative,sweep:(cutoff,freed)=>sweepRunLogs(path.join(root,...relative.split('/')),rootDev,cutoff,freed,relative==='routines/work'?isWorkUndoBackup:undefined)})),
 ];
}

const freeBytes=folder=>{try{const s=fs.statfsSync(folder);return s.bavail*s.bsize;}catch{return null;}};

// Removes what is old in every place and reports what it freed per place and the disk before and after.
export function nightlyCleanup({root,home,now=Date.now(),keepDays=KEEP_DAYS,free=freeBytes}){
 const cutoff=now-keepDays*86400000,before=free(root),report=[];
 for(const place of places({root,home})){
  const freed={files:0,bytes:0};
  let failed=false;
  try{place.sweep(cutoff,freed);}catch{failed=true;}
  report.push({place:place.name,files:freed.files,bytes:freed.bytes,failed:failed||freed.failed===true});
 }
 return {places:report,disk_before:before,disk_after:free(root)};
}

const megabytes=bytes=>bytes===null?'unknown':(bytes/1048576).toFixed(1)+' MB';
export function cleanupLog(result){
 return [
  ...result.places.map(p=>`${p.place}: freed ${megabytes(p.bytes)} in ${p.files} file${p.files===1?'':'s'}${p.failed?' (stopped early: a file or folder could not be read)':''}`),
  `disk free: ${megabytes(result.disk_before)} before, ${megabytes(result.disk_after)} after`,
 ].join('\n');
}
