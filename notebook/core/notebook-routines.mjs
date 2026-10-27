import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';
import {loadSettings as journalSettings,saveSettings as saveJournal,DEFAULTS as JOURNAL_DEFAULTS} from '../../third-party/addons/godspeed-journal/lib/settings.mjs';

// THE ROUTINES THE NOTEBOOK MAKES IN HERMES BESIDE THE STARTING ROUTINES (18 October 2026): the ones
// Settings > Enable routine adds, and the journal's check-ins. Kept in this machine's own state
// (.godspeed, never synced), since Hermes' jobs live in each machine's own Hermes. Each entry:
// {id, key, name, what, skill?}. Where their results go follows the delivery the starting routines
// follow (deliveryFor), so a routine made before Telegram was connected reaches Telegram too.
const file=store=>path.join(store.state,'notebook-routines.json');
export function readNotebookRoutines(store){try{const data=JSON.parse(fs.readFileSync(file(store),'utf8'));return Array.isArray(data?.jobs)?data:{jobs:[]};}catch{return {jobs:[]};}}
export function writeNotebookRoutines(store,data){atomic(file(store),JSON.stringify(data,null,2)+'\n');}
export function rememberNotebookRoutine(store,job){const data=readNotebookRoutines(store);data.jobs=[...data.jobs.filter(j=>j.id!==job.id),job];writeNotebookRoutines(store,data);return job;}

// WHAT SETTINGS > ENABLE ROUTINE OFFERS WITH THE ORIGINAL ASSISTANT. Until 18 October 2026 it listed
// the notebook's own kinds of job, and Hermes could run only the few whose name was also a recipe's;
// the rest were refused with "Choose an installed Godspeed skill". Now each kind is a recipe of the
// mission control's own, by the name a person knows it by, and only the recipes installed in this
// mission control are offered. The daily round, the deadline reminders, the weekly check-in and the
// coach's reminders come with the first goal and are not offered twice.
export const ENABLE_KINDS=[
 {kind:'morning-brief',skill:'morning-brief',label:'Morning brief',what:'Writes your morning brief: the one thing that needs you, what changed, your dates and what your watches found.'},
 {kind:'review',skill:'weekly-review',label:'Weekly review',what:'Files the notes waiting in your inbox, asks about the unclear ones and says how each goal is going.'},
 {kind:'research-watch',skill:'research-watch',label:'Research watches',what:'Checks the questions you asked it to keep researching, and tells you only what is new.'},
 {kind:'memory-review',skill:'memory-audit',label:'Memory review',what:'Checks what your mission control remembers about you against dated evidence, and repairs what is wrong.'},
 {kind:'radar',skill:'mc-radar',label:'AI radar',what:'Looks for one new idea from the sources you chose that would change part of your setup, for your verdict.'},
 {kind:'subscription-review',skill:'subscription-review',label:'Subscription review',what:'Reviews your AI subscriptions from your receipts: what each cost and what it carried.'},
 {kind:'lead',skill:'lead',label:'Public contributions',what:'Prepares one contribution you could post or send, from what really happened; you post it yourself.'},
 {kind:'audit',skill:'audit',label:'Mission control audit',what:'Audits your mission control and names the three changes that would help most.'},
];
export const enableKinds=root=>ENABLE_KINDS.filter(k=>fs.existsSync(path.join(root,'skills',k.skill,'SKILL.md'))).map(({kind,label})=>({kind,label}));
export const enableKind=kind=>ENABLE_KINDS.find(k=>k.kind===kind)||null;

// WHERE THE ROUTINES OF THIS MACHINE DELIVER. Until 18 October 2026 this was decided once, when the
// first goal made the routines: a server that connected Telegram after its first goal kept every
// result in the notebook for good, and Settings > Routine delivery only saved a setting. Now:
// "Keep results here" pressed in Settings keeps them here; otherwise they go to Telegram whenever this
// machine's Hermes has a bot connected, and stay here while it has none.
export function deliveryFor(installation,{telegram=false}={}){
 if(installation?.delivery==='notebook'&&installation?.delivery_chosen_at)return 'local';
 return telegram?'telegram':'local';
}

// THE JOURNAL'S CHECK-INS (18 October 2026). The journal can check in on a task you started, give an
// evening list and a weekly summary, each switched on in its own settings (routines/journal/
// settings.json, changed in the chat: "check in after four hours"). Only the journal add-on's own
// setup made the Hermes job that sends them, and no installation runs that setup, so they never
// came. Now the machine that runs the routines keeps one routine for them while any of the three is
// switched on: every 15 minutes it runs the journal's own tick, which says something only when one
// is due, at the times the settings name, outside its quiet hours. All three off pauses it.
export const JOURNAL_JOB='Journal check-ins';
export const JOURNAL_SCRIPT='godspeed-journal-checkins.py';
export const JOURNAL_WHAT='Sends your journal\'s check-ins, its evening list and its weekly summary, the ones you switched on. It looks every 15 minutes whether one is due.';
export function journalWanted(root){
 const s=journalSettings(root);
 return s.capture_enabled!==false&&!!(s.nudge?.enabled||s.evening?.enabled||s.weekly?.enabled);
}
// THE NIGHT CHAT TIDY-UP (26 October 2026). The assistant keeps a chat app's chat as one long
// conversation and summarises its older part once it passes its threshold, and it does that before
// answering the message that crossed the line: a real message waited 4 minutes 9 seconds while 348
// messages became 43, and all the person saw was "typing". The assistant has no idle-time
// summarising of its own. So the machine that runs the routines keeps one routine that does it at
// night, while nobody is waiting: every install whose Hermes has a chat app connected gets it, at
// 01:30 on the install's clock, with no AI. It summarises only the conversation the gateway's
// routing table names for the owner's chat, only while the chat is out of use, and only when the
// chat is long enough to be worth it (godspeed_routines.py, chat_tidy). It sends nothing to the
// chat: its output is its log, which is why its results are kept here and never delivered
// (followDelivery leaves this one alone).
// MADE FOR NO INSTALL SINCE 27 OCTOBER 2026 (godspeed-dev,
// releases/godspeed-2.0.0-beta.8-faster-chat/plan.md): on Hermes 0.22.5, which a new install gets,
// the control channel it speaks is refused while the gateway runs, so it would fail every night. It
// comes back in a release of its own. Its script is still written (starting-routines.mjs,
// routineFiles), and the routine is taken off an install that already has it
// (native-scheduler.mjs, removeChatTidy).
export const CHAT_TIDY_JOB='Night chat tidy-up';
export const CHAT_TIDY_SCRIPT='godspeed-chat-tidy.py';
// The journal reads its times on its own clock, which starts as UTC until its setup writes the
// person's; the installation's zone is the person's, so it becomes the journal's when the journal
// still has the default one.
export function journalOnTheClock(root,timezone){
 if(!timezone)return false;
 let raw={};try{raw=JSON.parse(fs.readFileSync(path.join(root,'routines','journal','settings.json'),'utf8'))||{};}catch{}
 const current=raw.timezone||JOURNAL_DEFAULTS.timezone;
 if(current===timezone||(raw.timezone&&raw.timezone!=='UTC'))return false;
 saveJournal(root,{...raw,timezone});return true;
}
