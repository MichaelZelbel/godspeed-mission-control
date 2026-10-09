import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import {atomic} from './records/store.mjs';
const notebook=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// What the assistant and its tools may see of this server's environment.
// Until 6 October 2026 they were handed all of it, and the assistant runs
// tools: the web sign-in token, the Telegram bot's key, the notebook's own
// model and embeddings keys, a setup code and whatever else the machine had
// set were one shell command away from any prompt it read. Now it gets the
// operating system's basics, locale, proxies and certificates, Python and uv,
// Hermes' own settings, the model keys Hermes reads from its environment, and
// Godspeed's settings except anything named like a secret.
const passed=new Set(['PATH','PATHEXT','SYSTEMROOT','SYSTEMDRIVE','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','COMMONPROGRAMFILES','COMMONPROGRAMFILES(X86)','COMMONPROGRAMW6432','ALLUSERSPROFILE','PUBLIC','USERNAME','USER','LOGNAME','USERDOMAIN','COMPUTERNAME','HOSTNAME','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','PROCESSOR_IDENTIFIER','OS','SHELL','TERM','COLORTERM','NO_COLOR','FORCE_COLOR','LANG','LANGUAGE','TZ','DISPLAY','WAYLAND_DISPLAY','DBUS_SESSION_BUS_ADDRESS','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','ALL_PROXY','SSL_CERT_FILE','SSL_CERT_DIR','REQUESTS_CA_BUNDLE','CURL_CA_BUNDLE','NODE_EXTRA_CA_CERTS','VIRTUAL_ENV','PLAYWRIGHT_BROWSERS_PATH','CODEX_HOME','HF_HOME','GODSPEED_AGE_KEY','MENERIO_API_KEY','MENERIO_BASE_URL','MENERIO_MCP_URL',
  // Where the owner's own tools live, for the assistant's terminal (locations, not keys).
  'JAVA_HOME','GOPATH','GOROOT','CARGO_HOME','RUSTUP_HOME','NVM_HOME','NVM_SYMLINK','NVM_DIR','VOLTA_HOME','PNPM_HOME','BUN_INSTALL','DENO_DIR','ANDROID_HOME','CONDA_PREFIX','CONDA_DEFAULT_ENV','PIPX_HOME','SSH_AUTH_SOCK','GIT_SSH','GIT_SSH_COMMAND','EDITOR','VISUAL','PAGER',
  'PSMODULEPATH','SESSIONNAME','LOGONSERVER','USERDOMAIN_ROAMINGPROFILE','PROCESSOR_LEVEL','PROCESSOR_REVISION','DRIVERDATA','ONEDRIVE','WSLENV']);
const prefixes=['HERMES_','LC_','XDG_','PYTHON','UV_','GODSPEED_'];
const modelKey=/^(OPENAI|ANTHROPIC|OPENROUTER|GEMINI|GOOGLE|DEEPSEEK|XAI|MISTRAL|GROQ|OLLAMA|AZURE_FOUNDRY|NVIDIA|KIMI|MINIMAX|DASHSCOPE|GLM|ZAI|FIREWORKS|NEBIUS|HF|LM|AI_GATEWAY)_(API_KEY|BASE_URL)$/;
const secretName=/(TOKEN|SECRET|PASSWORD|PASSPHRASE|COOKIE|CREDENTIALS?|_KEY|_CODE)$/;
export function passedEnvironment(env=process.env){
  const out={};
  for(const [name,value] of Object.entries(env)){
    const upper=name.toUpperCase();if(value===undefined)continue;
    if(passed.has(upper)||modelKey.test(upper)||prefixes.some(p=>upper.startsWith(p))&&!(upper.startsWith('GODSPEED_')&&secretName.test(upper)))out[name]=value;
  }
  return out;
}
// Windows names a variable in any case ("Path"); a second spelling beside it
// leaves which one a program reads to chance.
const named=(env,name)=>{const key=Object.keys(env).find(k=>k.toUpperCase()===name);return key===undefined?undefined:env[key];};
const without=(env,names)=>Object.fromEntries(Object.entries(env).filter(([k])=>!names.includes(k.toUpperCase())));
// Mail and video live where a terminal on this computer keeps them, so what the
// person sets up in a terminal (as the book teaches: a key is never typed into
// the chat) is what the assistant finds. Until 8 October 2026 the assistant was
// sent to folders of its own inside the mission control: GODSPEED_MAIL_HOME
// <folder>/.godspeed/device-home and GODSPEED_VIDEO_HOME <folder>/.godspeed/video,
// while `mc-mail` and `mc-video setup` in a terminal used the home folder. A key
// connected in a terminal was then invisible to the assistant, and so was the
// video kit. Mail is no longer redirected at all; mc-mail moves what an assistant
// kept in the old folder to the home folder once (mc-mail-gmail.js adoptOldHome).
// Video cannot be moved (its Python environment remembers where it was made), so
// an assistant that set it up in the old folder keeps using it until the home
// folder has one of its own.
const userHome=env=>(process.platform==='win32'?named(env,'USERPROFILE'):named(env,'HOME'))||os.homedir();
export function videoHome(workspace,env=process.env){
  if(named(env,'GODSPEED_VIDEO_HOME'))return {};
  const old=path.join(workspace,'.godspeed','video');
  return !fs.existsSync(path.join(userHome(env),'.mc-video'))&&fs.existsSync(old)?{GODSPEED_VIDEO_HOME:old}:{};
}
export function assistantEnvironment({home,workspace,env=process.env}={}){
  const path_=named(env,'PATH'),pythonPath=named(env,'PYTHONPATH');env=without(passedEnvironment(env),['PATH','PYTHONPATH']);
  return {...env,HERMES_HOME:home,GODSPEED_DIR:workspace,GODSPEED_ROOT:workspace,...videoHome(workspace,env),GODSPEED_WORKSPACE:workspace,GODSPEED_FILE_HERMES:env.GODSPEED_ORIGINAL_RUNTIME==='on'?'0':'1',GODSPEED_NODE:process.execPath,GODSPEED_HEADACHE_DIR:workspace,GODSPEED_HEADACHE_SCRIPT:path.resolve(notebook,'../third-party/addons/godspeed-headache/bin/godspeed-headache.mjs'),GODSPEED_HEADACHE_GIT_SYNC:'off',GODSPEED_COACH_DIR:workspace,GODSPEED_JOURNAL_DIR:workspace,GODSPEED_COACH_SCRIPT:path.resolve(notebook,'../third-party/addons/godspeed-coach/bin/godspeed-coach.mjs'),GODSPEED_JOURNAL_SCRIPT:path.resolve(notebook,'../third-party/addons/godspeed-journal/bin/godspeed-journal.mjs'),GODSPEED_COACH_GIT_SYNC:'off',GODSPEED_JOURNAL_GIT_SYNC:'off',PATH:[path.join(home,'bin'),path_].filter(Boolean).join(path.delimiter),GODSPEED_ASSISTANT_PUBLISHER:path.join(notebook,'scripts','save-assistant-state.mjs'),PYTHONPATH:[path.join(notebook,'assistant-files'),pythonPath].filter(Boolean).join(path.delimiter)};
}
export function assistantProfiles(store){
  const directory=path.join(store.root,'assistant-state');if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory).filter(id=>/^[a-f0-9-]{36}$/.test(id)&&fs.statSync(path.join(directory,id)).isDirectory()).map(id=>({id,databases:fs.readdirSync(path.join(directory,id)).filter(n=>n.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(directory,id,name),'utf8')).database)}));
}
export function validateAssistantFiles(root){
  const directory=path.join(root,'assistant-state');if(!fs.existsSync(directory))return;
  for(const id of fs.readdirSync(directory).filter(id=>/^[a-f0-9-]{36}$/.test(id))){
    for(const name of fs.readdirSync(path.join(directory,id)).filter(name=>name.endsWith('.json'))){
      const snapshot=JSON.parse(fs.readFileSync(path.join(directory,id,name),'utf8'));
      if(![1,2].includes(snapshot.format)||snapshot.profile!==id||typeof snapshot.database!=='string'||!Array.isArray(snapshot.tables))throw new Error('Assistant state identity needs review: '+id+'/'+name);
    }
  }
}
export function selectAssistantProfile(store,id){
  if(!assistantProfiles(store).some(profile=>profile.id===id))throw new Error('The restored assistant profile was not found');
  const descriptor=JSON.parse(fs.readFileSync(path.join(store.state,'assistant.json'),'utf8').replace(/^\uFEFF/,'')),home=path.resolve(descriptor.home);
  if(home===path.resolve(process.env.USERPROFILE||process.env.HOME||'/'))throw new Error('Use the configured isolated candidate assistant home');
  const hasDatabase=directory=>fs.existsSync(directory)&&fs.readdirSync(directory,{withFileTypes:true}).some(entry=>entry.isDirectory()?hasDatabase(path.join(directory,entry.name)):entry.name.endsWith('.db'));
  if(hasDatabase(home))throw new Error('Select restored assistant history before first opening the new candidate assistant. Existing assistant database caches require a separate backed-up reset');
  fs.mkdirSync(home,{recursive:true});atomic(path.join(home,'godspeed-file-profile.json'),JSON.stringify({format:1,id}));return {selected:id,home};
}
