import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,atomic} from '../core/records/store.mjs';
import {ApiKeys,ASSISTANT_KEY_NAME} from '../core/api-keys.mjs';
import {installSkillTree} from '../core/packaged-skills.mjs';
import {commandFile} from './windows-command-file.mjs';
import {starterBorn} from '../core/starter-workspace.mjs';
import {withTimezone,godspeedHermesSettings,setConfigValue,CRON_PROVIDER,backupQuickCommand,BACKUP_COMMAND} from '../core/hermes-config.mjs';
import {moveSavedSkills} from '../core/assistant-skills.mjs';
import {personaOf} from '../core/persona.mjs';
import {syncSoul,readExtra} from '../core/assistant-soul.mjs';
import {installModelCommand} from './install-model-command.mjs';
import {noteHermesMet} from '../core/starting-routines.mjs';
import {keepOutOfGit} from '../core/first-commit.mjs';
import {godspeedVoiceSettings,chatVoiceDefaults,ownerChats} from '../core/voice-replies.mjs';
const root=process.env.GODSPEED_WORKSPACE,home=process.argv[2];if(!root||!home)throw new Error("Set GODSPEED_WORKSPACE to your mission control folder and name your assistant's home folder");
// The notebook is opened only where its records are needed (a starter-made mission control, or a
// server's key): opening it reads every one of its files, and this runs at every install and every
// start. On one PC, where an update ran it twice, each run took two minutes until 21 October 2026;
// the rest needs only the folder's own paths.
let opened=null;const notebook=()=>opened??=new Store(root);
const store={root:path.resolve(root),state:path.join(path.resolve(root),'.godspeed'),get:(type,id)=>notebook().get(type,id)};fs.mkdirSync(store.state,{recursive:true});
const port=Number(process.env.GODSPEED_PORT||47831),file=path.join(home,'config.yaml');fs.mkdirSync(home,{recursive:true});
const kit=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// Keep the original main-branch command suite available as well as the
// integrated adapters below. Dependencies stay beside their original wrappers.
const commandHome=path.join(home,'bin');
fs.mkdirSync(commandHome,{recursive:true});
installModelCommand({root,home});
// Every Windows command file lives in commandHome; windows-command-file.mjs says why
// the paths in it are written the way they are.
const cmd=write=>commandFile(write,{folder:commandHome});
fs.cpSync(path.join(kit,'tools'),commandHome,{recursive:true});
for(const name of fs.readdirSync(commandHome).filter(n=>n.startsWith('mc-')&&!path.extname(n))){
  const wrapper=path.join(commandHome,name),source=fs.readFileSync(wrapper,'utf8');
  if(process.platform!=='win32')fs.chmodSync(wrapper,0o700);
  const target=source.match(/exec node "(?:\$\(dirname "\$0"\)|\$HERE)\/([^"\n]+)"/);
  if(process.platform==='win32'&&target)atomic(wrapper+'.cmd',cmd(at=>'set "GODSPEED_ROOT='+at(root)+'"\r\nset "GODSPEED_DIR='+at(root)+'"\r\n"'+at(process.execPath)+'" "%~dp0'+target[1]+'" %*\r\n'));
  else if(process.platform==='win32'&&source.startsWith('#!/usr/bin/env python3'))atomic(wrapper+'.cmd','@echo off\r\npython "%~dp0'+name+'" %*\r\n');
  else if(process.platform==='win32')atomic(wrapper+'.cmd',cmd(at=>'set "GODSPEED_ROOT='+at(root)+'"\r\nset "GODSPEED_DIR='+at(root)+'"\r\nset "PATH='+at(path.dirname(process.execPath))+';%PATH%"\r\nset "GODSPEED_BASH="\r\nfor /f "delims=" %%G in (\'where git.exe 2^>nul\') do if exist "%%~dpG..\\bin\\bash.exe" set "GODSPEED_BASH=%%~dpG..\\bin\\bash.exe"\r\nif not defined GODSPEED_BASH (echo Git Bash is required for this Godspeed command. & exit /b 1)\r\n"%GODSPEED_BASH%" "%~dp0'+name+'" %*\r\n'));
}
// The assistant's terminal is a shell on every system (Git Bash on Windows), and a shell never runs
// a .cmd by its plain name: until 9 October 2026 a command written only as a .cmd on Windows was
// missing in Hermes' terminal, and mc-goals, mc-work, mc-forecast, mc-due and mc-mail there ran
// the kit's own copies instead of the notebook's (Linux and a Mac always ran the notebook's). So
// every command gets a shell form on every system too, with its paths written C:/... on Windows:
// Hermes switches off Git Bash's own translation of paths for the programs it starts
// (MSYS_NO_PATHCONV=1), and that form needs none.
const posix=p=>process.platform==='win32'?p.replaceAll('\\','/'):p;
const quote=s=>"'"+posix(s).replaceAll("'","'\\''")+"'";
const shellCommand=(file,words,after='')=>{atomic(file,'#!/bin/sh\nexec '+words.map(quote).join(' ')+' "$@"'+after+'\n');if(process.platform!=='win32')fs.chmodSync(file,0o700);};
const rulesScript=path.join(kit,'tools/compile-rules.js');
if(process.platform==='win32')atomic(path.join(commandHome,'mc-compile-rules.cmd'),cmd(at=>'"'+at(process.execPath)+'" "'+at(rulesScript)+'" --godspeed "'+at(root)+'" %*\r\n'));
shellCommand(path.join(commandHome,'mc-compile-rules'),[process.execPath,rulesScript,'--godspeed',root]);
// Developer assistants opened on this folder reach the same integrated memory.
const mcpFile=path.join(root,'.mcp.json'),mcp=JSON.parse(fs.readFileSync(mcpFile,'utf8').replace(/^\uFEFF/,''));
mcp.mcpServers??={};
// The shared .mcp.json names the standard address; a machine whose notebook
// listens elsewhere says so in its own untracked settings. Until 6 October 2026
// every machine wrote its own port into the shared file, which then changed
// back and forth between machines.
const NOTEBOOK_URL='${GODSPEED_NOTEBOOK_URL:-http://127.0.0.1:47831/mcp}';
const writeIfChanged=(file,text)=>{if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==text){fs.mkdirSync(path.dirname(file),{recursive:true});atomic(file,text);}};
if(process.env.GODSPEED_DEVICE!=='vps'){
  if(mcp.mcpServers.godspeed?.url?.startsWith('http://127.0.0.1:'))delete mcp.mcpServers.godspeed;
  if(!mcp.mcpServers.notebook||/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(mcp.mcpServers.notebook.url||''))mcp.mcpServers.notebook={type:'http',url:NOTEBOOK_URL};
  writeIfChanged(mcpFile,JSON.stringify(mcp,null,2)+'\n');
  const localFile=path.join(root,'.claude','settings.local.json');let local={};
  try{local=JSON.parse(fs.readFileSync(localFile,'utf8').replace(/^\uFEFF/,''));}catch{}
  const own=port===47831?undefined:`http://127.0.0.1:${port}/mcp`;
  if(local.env?.GODSPEED_NOTEBOOK_URL!==own){local.env={...local.env};if(own)local.env.GODSPEED_NOTEBOOK_URL=own;else delete local.env.GODSPEED_NOTEBOOK_URL;writeIfChanged(localFile,JSON.stringify(local,null,2)+'\n');}
  const codexFile=path.join(root,'.codex/config.toml');
  if(!fs.existsSync(codexFile)||/^\[mcp_servers\.(godspeed|notebook)\]\r?\nurl = "http:\/\/127\.0\.0\.1:\d+\/mcp"\s*$/.test(fs.readFileSync(codexFile,'utf8')))atomic(codexFile,`[mcp_servers.notebook]\nurl = "http://127.0.0.1:${port}/mcp"\n`);
  const vscodeFile=path.join(root,'.vscode/settings.json');
  if(!fs.existsSync(vscodeFile))atomic(vscodeFile,JSON.stringify({'terminal.integrated.env.windows':{GODSPEED_WORKSPACE:root,GODSPEED_ROOT:root,GODSPEED_DIR:root,HERMES_HOME:home,PATH:commandHome+';'+path.dirname(process.execPath)+';${env:PATH}'},'terminal.integrated.env.linux':{GODSPEED_WORKSPACE:root,GODSPEED_ROOT:root,GODSPEED_DIR:root,HERMES_HOME:home,PATH:commandHome+':'+path.dirname(process.execPath)+':${env:PATH}'}},null,2)+'\n');
}
// A Windows junction stores an absolute target, so after the folder was moved by hand
// it pointed at a folder that is gone: existsSync follows the link and said false,
// making the link again failed with EEXIST, and the notebook did not start (until
// 6 October 2026). A link that does not lead to this folder's skills is replaced; a
// real folder in its place belongs to the owner and is left alone.
const skills=path.join(root,'skills'),samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
for(const folder of ['.claude','.agents']){
  const alias=path.join(root,folder,'skills');fs.mkdirSync(path.dirname(alias),{recursive:true});
  let link=null;try{link=fs.lstatSync(alias);}catch{}
  if(link&&!link.isSymbolicLink())continue;
  if(link){
    let leads=false;try{leads=samePath(fs.realpathSync(alias),fs.realpathSync(skills));}catch{}
    if(leads)continue;
    fs.unlinkSync(alias);
  }
  fs.symlinkSync(process.platform==='win32'?skills:'../skills',alias,process.platform==='win32'?'junction':'dir');
}
// What stays out of the folder's Git history; the list lives in core/first-commit.mjs.
keepOutOfGit(root);
// With the original assistant, mc-goals, mc-work, mc-forecast and mc-due are the kit's own commands
// (copied from tools/ above). mc-watch and mc-subs have no such command, and until 9 October 2026
// they were not installed there at all: the watch and subscription-review recipes name them, and
// a live run's routine reported "mc-watch not available". They write the notebook's own records
// on every installation.
for(const command of (process.env.GODSPEED_ORIGINAL_RUNTIME==='on'?['mail','watch','subs']:['goals','work','forecast','due','subs','watch','mail'])){
 const bin=path.join(home,'bin','mc-'+command),script=command==='mail'?path.join(kit,'tools','mc-mail.js'):path.join(kit,'notebook','bin','personal-command.mjs'),args=command==='mail'?[]:[command];
 if(process.platform==='win32')atomic(bin+'.cmd',cmd(at=>'"'+at(process.execPath)+'" "'+at(script)+'" '+args.join(' ')+' %*\r\n'));
 shellCommand(bin,[process.execPath,script,...args]);
}
{
 const script=path.join(kit,'third-party/addons/mc-video/bin/mc-video.mjs'),bin=path.join(home,'bin','mc-video');
 if(process.platform==='win32')atomic(bin+'.cmd',cmd(at=>'"'+at(process.execPath)+'" "'+at(script)+'" %* --godspeed "'+at(root)+'"\r\n'));
 shellCommand(bin,[process.execPath,script],' --godspeed '+quote(root));
}
const packagedSkills=[['coach','coach'],['journal','interstitial-journal'],['headache','headache-tracker']];
for(const [addon,skill] of packagedSkills){
 const source=path.join(kit,'third-party/addons/godspeed-'+addon);
 fs.cpSync(path.join(source,'hermes/plugin/godspeed-'+addon),path.join(home,'plugins/godspeed-'+addon),{recursive:true});
 atomic(path.join(home,'plugins/godspeed-'+addon,'mission-control.txt'),root+'\n');
  if(addon==='coach')atomic(path.join(home,'plugins/godspeed-coach','progress-renderer.txt'),path.join(kit,'notebook/scripts/habit-progress-image.mjs')+'\n');
 // Packaged skills use the maintained complete workflow. User-customised
 // workspace skills are preserved by the installer's normal conflict policy.
 installSkillTree(store,path.join(source,'skill',skill),path.join(home,'skills',skill));
 const script=path.join(source,'bin/godspeed-'+addon+'.mjs'),bin=path.join(home,'bin','godspeed-'+addon);
 if(process.platform==='win32')atomic(bin+'.cmd',cmd(at=>'"'+at(process.execPath)+'" "'+at(script)+'" %* --godspeed "'+at(root)+'"\r\n'));
 // The coach's talk brief tells the assistant to type `godspeed-coach ...` in that shell.
 shellCommand(bin,[process.execPath,script],' --godspeed '+quote(root));
}
// THE SKILLS THE OWNER ASKED THEIR ASSISTANT TO SAVE BEFORE create_dir WAS SET (core/assistant-skills.mjs):
// they are in the Hermes home, where they are in nobody's files and in no backup, so each one the
// owner made comes over to the mission control's skills/ here, with a copy kept first in
// .godspeed/backups/. After the packaged skills above, so the ledger that tells theirs from ours is
// current. What the reader must hear goes to standard error, as the installer's other notices do:
// the server's start throws this script's standard output away.
try{for(const line of moveSavedSkills({home,root:store.root,state:store.state,packaged:packagedSkills.map(([,skill])=>skill)}).lines)console.error(line);}
catch(error){console.error('The skills your assistant saved in its own folder were left there: '+error.message);}
// The getting-to-know-you chat's own plugin (core/context-setup.mjs): it tells the assistant, before
// each turn, that its owner was invited to that chat and has not answered yet, since an invitation a
// scheduled job delivered is not part of the chat the assistant sees next.
fs.cpSync(path.join(kit,'notebook','assistant-files','godspeed-context'),path.join(home,'plugins','godspeed-context'),{recursive:true,filter:source=>!/__pycache__/.test(source)});
atomic(path.join(home,'plugins','godspeed-context','mission-control.txt'),root+'\n');
let text=fs.existsSync(file)?fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''):`terminal:\n  cwd: ${JSON.stringify(root)}\nskills:\n  external_dirs: [${JSON.stringify(path.join(root,'skills'))}]\nmemory:\n  memory_enabled: false\n`;
// WHERE A SKILL THE OWNER ASKS FOR IN A CHAT IS MADE. external_dirs above only lets Hermes read the
// mission control's skills; it creates a new one in its own home unless skills.create_dir names
// another folder, so "Save this as a skill called check-my-email" wrote it where nothing of the
// owner's ever reaches (27 October 2026). The same folder as external_dirs, written absolute as
// that one is, because Hermes reads a relative value against its own home. On every wiring, not
// only when this file is made: an install that already had a config.yaml would never get it
// otherwise, and an update runs this.
text=setConfigValue(text,['skills','create_dir'],JSON.stringify(path.join(root,'skills')));
if(!/^plugins:/m.test(text))text+='\nplugins:\n  enabled: ["godspeed-coach", "godspeed-journal", "godspeed-headache", "godspeed-context"]\n';
else{
 const block=text.match(/^plugins:[^\n]*\n(?:[ \t]+[^\n]*\n|\n)*/m)?.[0]||'';
 const disabled=block.match(/  disabled:\s*\[([^\]]*)\]/)?.[1]||'';
 const names=['godspeed-coach','godspeed-journal','godspeed-headache','godspeed-context'].filter(n=>!disabled.includes(n));
 let updated=block;
 if(/  enabled:\s*\[([^\]]*)\]/.test(block))updated=block.replace(/  enabled:\s*\[([^\]]*)\]/,(_m,old)=>'  enabled: ['+[old.trim(),...names.filter(n=>!old.includes(n)).map(n=>JSON.stringify(n))].filter(Boolean).join(', ')+']');
 else if(/^  enabled:\s*\n/m.test(block))updated=block.replace(/^  enabled:\s*\n((?:    - [^\n]*\n)*)/m,(_m,old)=>'  enabled:\n'+old+names.filter(n=>!old.includes(n)).map(n=>'    - '+JSON.stringify(n)+'\n').join(''));
 else if(!/  enabled:/.test(block))updated=block+'  enabled: ['+names.map(n=>JSON.stringify(n)).join(', ')+']\n';
 else throw Error('The existing plugin configuration needs review before enabling personal workflows');
 text=text.replace(block,updated);
}
const notebookTool=()=>{
  let headers='';if(process.env.GODSPEED_DEVICE==='vps'){
    const keyFile=path.join(store.state,'assistant-mcp.json');let key;
    // Its name is what Settings, Connect other assistants lists; until 18 October 2026 it was
    // "Candidate assistant", a word from the test channel, and a key made then is renamed here.
    const keys=new ApiKeys(notebook()),rows=keys.rows(),own=rows.map(r=>r.name==='Candidate assistant'?{...r,name:ASSISTANT_KEY_NAME}:r);if(own.some((r,i)=>r!==rows[i]))keys.write(own);
    if(fs.existsSync(keyFile))key=JSON.parse(fs.readFileSync(keyFile)).key;else{key=keys.invoke('mc-api-keys/generate',{name:ASSISTANT_KEY_NAME,scopes:['notes','contacts','world','collections','media','profile','actions','stats']}).api_key;atomic(keyFile,JSON.stringify({key}));fs.chmodSync(keyFile,0o600);}
    headers=`    headers:\n      Authorization: ${JSON.stringify('Bearer '+key)}\n`;
  }
  return `  notebook:\n    url: http://127.0.0.1:${port}/mcp\n${headers}`;
};
if(/^mcp_servers:/m.test(text)){
  // The original Godspeed keep-a-note recipe names this connection notebook.
  if(!/^  notebook:/m.test(text))text=text.replace(/^  godspeed:\s*$/m,'  notebook:');
  // Re-running setup with a new local port must not retain the old endpoint.
  text=text.replace(/(^  notebook:\s*\n\s+url: )http:\/\/127\.0\.0\.1:\d+\/mcp/m,`$1http://127.0.0.1:${port}/mcp`);
  // A section without the notebook gets it added inside. On a Mac or Linux the shared installer
  // adds the mail tool to ~/.hermes first, which makes this section holding only mc-mail, and
  // until 18 October 2026 the notebook was added only when there was no section at all: that
  // assistant had no notebook tools and answered "make a note" with "not connected".
  if(!text.endsWith('\n'))text+='\n';
  const section=text.match(/^mcp_servers:[ \t]*(?:\{\}[ \t]*)?\r?\n(?:[ \t]+[^\n]*\n|\r?\n)*/m);
  if(section&&!/^  notebook:/m.test(section[0]))text=text.replace(section[0],section[0].replace(/^mcp_servers:[ \t]*\{\}[ \t]*/,'mcp_servers:').replace(/(?:\r?\n)+$/,'\n')+notebookTool());
}
else text+=`\nmcp_servers:\n${notebookTool()}`;
// The computer connection is a setting, not a one-time choice. Its tool used to
// be written only while the assistant's configuration was being created, so a
// server already set up could never gain it: switch the connection on, ask for a
// connection code, and the answer was that no such tool exists. Reconcile it on
// every wiring instead, both ways, so off leaves behind no tool that cannot work.
const computerTool=`  godspeed_computer:\n    command: ${JSON.stringify(process.execPath)}\n    args: ["/opt/godspeed/kit/computer/mcp.js"]\n    env:\n      GODSPEED_COMPUTER_DIR: "/opt/data/full-candidate/computer"\n`;
text=text.replace(/^  godspeed_computer:[^\n]*\n(?:[ \t]{4,}[^\n]*\n)*/m,'');
if(process.env.GODSPEED_COMPUTER==='on'){
  const section=text.match(/^mcp_servers:[^\n]*\n(?:[ \t]+[^\n]*\n|\n)*/m);
  if(section)text=text.replace(section[0],section[0].replace(/\n+$/,'\n')+computerTool);
  else text+=`\nmcp_servers:\n${computerTool}`;
}
// Hermes' own clock follows the reader's (hermes-config.mjs): until 8 October 2026 a Linux server
// read "every weekday at seven" from the chat on the server's clock, usually UTC. Only for a
// mission control made from the starter, and only where no zone was chosen yet.
if(starterBorn(root))text=withTimezone(text,store.get('settings','installation')?.timezone);
// What the assistant of a mission control made from the starter needs from Hermes, found by a live
// run of the book's prompts on 9 October 2026 (hermes-config.mjs says why for each): no Hermes
// memory beside the notebook, no clarify tool in a chat nobody can answer it in, the notebook's
// tools offered directly, and a scheduler Hermes knows is running. An adopted mission control is
// the owner's and keeps its assistant as it was.
if(starterBorn(root)){
 text=godspeedHermesSettings(text);
 // The voice the assistant answers voice notes with (core/voice-replies.mjs): the multilingual free
 // voice, or the ElevenLabs voice chosen in Settings with its command where this version keeps it.
 text=godspeedVoiceSettings(text,{home,state:store.state});
 const provider=path.join(home,'plugins',CRON_PROVIDER,'__init__.py'),source=fs.readFileSync(path.join(kit,'notebook','assistant-files','godspeed-cron-provider.py'),'utf8').replace(/\r\n/g,'\n');
 if(!fs.existsSync(provider)||fs.readFileSync(provider,'utf8')!==source){fs.mkdirSync(path.dirname(provider),{recursive:true});atomic(provider,source);}
}
// /backupai in Telegram on the one-click server, where its Telegram runner hands the chat to the
// backup AI setup (hermes-config.mjs, core/backup-ai.mjs); on every other installation a backup AI
// is connected in Settings. The context plugin names the way that exists here when someone asks.
{
 const runner=process.env.GODSPEED_ORIGINAL_RUNTIME==='on'&&!!process.env.GODSPEED_TELEGRAM_DIR&&!['on','off'].includes(process.env.GODSPEED_TELEGRAM||'');
 text=backupQuickCommand(text,runner?{node:process.execPath,script:path.join(kit,'notebook','scripts','backup-ai.mjs'),dir:process.env.GODSPEED_TELEGRAM_DIR}:null);
 const marker=path.join(home,'plugins','godspeed-context','backup-command.txt');
 if(runner)atomic(marker,'/'+BACKUP_COMMAND+'\n');else fs.rmSync(marker,{force:true});
}
atomic(file,text);fs.chmodSync(file,0o600);
// A voice note in the owner's Telegram chat is answered with a voice note and the text, by default and
// only there (core/voice-replies.mjs says why not through voice.auto_tts); a chat's own choice stays.
// The gateway reads it when it starts next.
if(starterBorn(root))try{chatVoiceDefaults({home,chats:ownerChats({home}),config:text});}catch(error){console.error('Voice replies were not switched on for the Telegram chat: '+error.message);}
// Hermes reads its own SOUL.md before AGENTS.md, as the assistant's identity, and seeds it with
// "You are Hermes Agent, built by Nous Research ..." (core/assistant-soul.mjs says why and how).
// It is written from the persona paragraph of AGENTS.md, the one place the name and character are
// stated, and the owner's extra instructions after it (assistant/extra-instructions.md), unless
// its owner wrote their own SOUL.md, which the notebook's page for these then shows and offers to
// bring in among the extra instructions.
try{const persona=personaOf(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'));if(persona)syncSoul({home,persona,extra:readExtra(root)});}catch(error){console.error('The assistant\'s identity file was not brought in step with AGENTS.md and the extra instructions: '+error.message);}
// When this mission control first met this Hermes, once: a routine the reader already had in it is
// theirs, one made afterwards was made for this mission control (core/starting-routines.mjs,
// ownRoutines). At an install this comes before anything is made in it.
if(starterBorn(root))try{noteHermesMet(notebook(),{home:path.resolve(home)});}catch{}
console.log(JSON.stringify({wired:true,isolated:true,port}));
