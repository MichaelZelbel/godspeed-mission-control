import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,atomic} from '../core/records/store.mjs';
import {ApiKeys} from '../core/api-keys.mjs';
import {installSkillTree} from '../core/packaged-skills.mjs';
const root=process.env.GODSPEED_WORKSPACE,home=process.argv[2];if(!root||!home)throw new Error('Choose the candidate workspace and isolated assistant home');
const store=new Store(root),port=Number(process.env.GODSPEED_PORT||47831),file=path.join(home,'config.yaml');fs.mkdirSync(home,{recursive:true});
const kit=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// Keep the original main-branch command suite available as well as the
// integrated adapters below. Dependencies stay beside their original wrappers.
const commandHome=path.join(home,'bin');
fs.mkdirSync(commandHome,{recursive:true});
fs.cpSync(path.join(kit,'tools'),commandHome,{recursive:true});
for(const name of fs.readdirSync(commandHome).filter(n=>n.startsWith('mc-')&&!path.extname(n))){
  const wrapper=path.join(commandHome,name),source=fs.readFileSync(wrapper,'utf8');
  if(process.platform!=='win32')fs.chmodSync(wrapper,0o700);
  const target=source.match(/exec node "\$\(dirname "\$0"\)\/([^"\n]+)"/);
  if(process.platform==='win32'&&target)atomic(wrapper+'.cmd','@echo off\r\nset "GODSPEED_ROOT='+root+'"\r\nset "GODSPEED_DIR='+root+'"\r\n"'+process.execPath+'" "%~dp0'+target[1]+'" %*\r\n');
  else if(process.platform==='win32'&&source.startsWith('#!/usr/bin/env python3'))atomic(wrapper+'.cmd','@echo off\r\npython "%~dp0'+name+'" %*\r\n');
  else if(process.platform==='win32')atomic(wrapper+'.cmd','@echo off\r\nset "GODSPEED_ROOT='+root+'"\r\nset "GODSPEED_DIR='+root+'"\r\nset "PATH='+path.dirname(process.execPath)+';%PATH%"\r\nset "GODSPEED_BASH="\r\nfor /f "delims=" %%G in (\'where git.exe 2^>nul\') do if exist "%%~dpG..\\bin\\bash.exe" set "GODSPEED_BASH=%%~dpG..\\bin\\bash.exe"\r\nif not defined GODSPEED_BASH (echo Git Bash is required for this Godspeed command. & exit /b 1)\r\n"%GODSPEED_BASH%" "%~dp0'+name+'" %*\r\n');
}
const rulesScript=path.join(kit,'tools/compile-rules.js');
if(process.platform==='win32')atomic(path.join(commandHome,'mc-compile-rules.cmd'),'@echo off\r\n"'+process.execPath+'" "'+rulesScript+'" --godspeed "'+root+'" %*\r\n');
else {const rulesCommand=path.join(commandHome,'mc-compile-rules');atomic(rulesCommand,'#!/bin/sh\nexec '+[process.execPath,rulesScript,'--godspeed',root].map(s=>"'"+s.replaceAll("'","'\\''")+"'").join(' ')+' "$@"\n');fs.chmodSync(rulesCommand,0o700);}
// Developer assistants opened on this folder reach the same integrated memory.
const mcpFile=path.join(root,'.mcp.json'),mcp=JSON.parse(fs.readFileSync(mcpFile,'utf8').replace(/^\uFEFF/,''));
mcp.mcpServers??={};
if(process.env.GODSPEED_DEVICE!=='vps'){
  if(mcp.mcpServers.godspeed?.url?.startsWith('http://127.0.0.1:'))delete mcp.mcpServers.godspeed;
  mcp.mcpServers.notebook={type:'http',url:`http://127.0.0.1:${port}/mcp`};
  atomic(mcpFile,JSON.stringify(mcp,null,2)+'\n');
  const codexFile=path.join(root,'.codex/config.toml');
  if(!fs.existsSync(codexFile)||/^\[mcp_servers\.(godspeed|notebook)\]\r?\nurl = "http:\/\/127\.0\.0\.1:\d+\/mcp"\s*$/.test(fs.readFileSync(codexFile,'utf8')))atomic(codexFile,`[mcp_servers.notebook]\nurl = "http://127.0.0.1:${port}/mcp"\n`);
  const vscodeFile=path.join(root,'.vscode/settings.json');
  if(!fs.existsSync(vscodeFile))atomic(vscodeFile,JSON.stringify({'terminal.integrated.env.windows':{GODSPEED_WORKSPACE:root,GODSPEED_ROOT:root,GODSPEED_DIR:root,HERMES_HOME:home,PATH:commandHome+';'+path.dirname(process.execPath)+';${env:PATH}'},'terminal.integrated.env.linux':{GODSPEED_WORKSPACE:root,GODSPEED_ROOT:root,GODSPEED_DIR:root,HERMES_HOME:home,PATH:commandHome+':'+path.dirname(process.execPath)+':${env:PATH}'}},null,2)+'\n');
}
for(const folder of ['.claude','.agents']){
  const alias=path.join(root,folder,'skills');fs.mkdirSync(path.dirname(alias),{recursive:true});
  if(!fs.existsSync(alias))fs.symlinkSync(process.platform==='win32'?path.join(root,'skills'):'../skills',alias,process.platform==='win32'?'junction':'dir');
}
const ignoreFile=path.join(root,'.gitignore');let ignores=fs.readFileSync(ignoreFile,'utf8');
for(const entry of ['/.godspeed/','/.codex/','/.vscode/','/.agents/','/.claude/skills'])if(!ignores.split(/\r?\n/).includes(entry))ignores+='\n'+entry+'\n';
atomic(ignoreFile,ignores);
for(const command of ['goals','work','forecast','due','subs','watch','mail']){
 const bin=path.join(home,'bin','mc-'+command),script=command==='mail'?path.join(kit,'tools','mc-mail.js'):path.join(kit,'notebook','bin','personal-command.mjs'),args=command==='mail'?[]:[command];
 if(process.platform==='win32')atomic(bin+'.cmd','@echo off\r\n"'+process.execPath+'" "'+script+'" '+args.join(' ')+' %*\r\n');
 else {atomic(bin,'#!/bin/sh\nexec '+[process.execPath,script,...args].map(s=>"'"+s.replaceAll("'","'\\''")+"'").join(' ')+' "$@"\n');fs.chmodSync(bin,0o700);}
}
{
 const script=path.join(kit,'third-party/addons/mc-video/bin/mc-video.mjs'),bin=path.join(home,'bin','mc-video');
 if(process.platform==='win32')atomic(bin+'.cmd','@echo off\r\n"'+process.execPath+'" "'+script+'" %* --godspeed "'+root+'"\r\n');
 else {atomic(bin,'#!/bin/sh\nexec '+[process.execPath,script].map(s=>"'"+s.replaceAll("'","'\\''")+"'").join(' ')+' "$@" --godspeed '+"'"+root.replaceAll("'","'\\''")+"'"+'\n');fs.chmodSync(bin,0o700);}
}
for(const [addon,skill] of [['coach','coach'],['journal','interstitial-journal'],['headache','headache-tracker']]){
 const source=path.join(kit,'third-party/addons/godspeed-'+addon);
 fs.cpSync(path.join(source,'hermes/plugin/godspeed-'+addon),path.join(home,'plugins/godspeed-'+addon),{recursive:true});
 atomic(path.join(home,'plugins/godspeed-'+addon,'mission-control.txt'),root+'\n');
 // Packaged skills use the maintained complete workflow. User-customised
 // workspace skills are preserved by the installer's normal conflict policy.
 installSkillTree(store,path.join(source,'skill',skill),path.join(home,'skills',skill));
 const script=path.join(source,'bin/godspeed-'+addon+'.mjs'),bin=path.join(home,'bin','godspeed-'+addon);
 if(process.platform==='win32')atomic(bin+'.cmd','@echo off\r\n"'+process.execPath+'" "'+script+'" %* --godspeed "'+root+'"\r\n');
 else {atomic(bin,'#!/bin/sh\nexec '+[process.execPath,script].map(s=>"'"+s.replaceAll("'","'\\''")+"'").join(' ')+' "$@" --godspeed '+"'"+root.replaceAll("'","'\\''")+"'"+'\n');fs.chmodSync(bin,0o700);}
}
let text=fs.existsSync(file)?fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''):`terminal:\n  cwd: ${JSON.stringify(root)}\nskills:\n  external_dirs: [${JSON.stringify(path.join(root,'skills'))}]\nmemory:\n  memory_enabled: false\n`;
if(!/^plugins:/m.test(text))text+='\nplugins:\n  enabled: ["godspeed-coach", "godspeed-journal", "godspeed-headache"]\n';
else{
 const block=text.match(/^plugins:[^\n]*\n(?:[ \t]+[^\n]*\n|\n)*/m)?.[0]||'';
 const disabled=block.match(/  disabled:\s*\[([^\]]*)\]/)?.[1]||'';
 const names=['godspeed-coach','godspeed-journal','godspeed-headache'].filter(n=>!disabled.includes(n));
 let updated=block;
 if(/  enabled:\s*\[([^\]]*)\]/.test(block))updated=block.replace(/  enabled:\s*\[([^\]]*)\]/,(_m,old)=>'  enabled: ['+[old.trim(),...names.filter(n=>!old.includes(n)).map(n=>JSON.stringify(n))].filter(Boolean).join(', ')+']');
 else if(/^  enabled:\s*\n/m.test(block))updated=block.replace(/^  enabled:\s*\n((?:    - [^\n]*\n)*)/m,(_m,old)=>'  enabled:\n'+old+names.filter(n=>!old.includes(n)).map(n=>'    - '+JSON.stringify(n)+'\n').join(''));
 else if(!/  enabled:/.test(block))updated=block+'  enabled: ['+names.map(n=>JSON.stringify(n)).join(', ')+']\n';
 else throw Error('The existing plugin configuration needs review before enabling personal workflows');
 text=text.replace(block,updated);
}
if(/^mcp_servers:/m.test(text)){
  // The original Godspeed keep-a-note recipe names this connection notebook.
  if(!/^  notebook:/m.test(text))text=text.replace(/^  godspeed:\s*$/m,'  notebook:');
  // Re-running setup with a new local port must not retain the old endpoint.
  text=text.replace(/(^  notebook:\s*\n\s+url: )http:\/\/127\.0\.0\.1:\d+\/mcp/m,`$1http://127.0.0.1:${port}/mcp`);
}
if(!/^mcp_servers:/m.test(text)){
  let headers='';if(process.env.GODSPEED_DEVICE==='vps'){
    const keyFile=path.join(store.state,'assistant-mcp.json');let key;
    if(fs.existsSync(keyFile))key=JSON.parse(fs.readFileSync(keyFile)).key;else{key=new ApiKeys(store).invoke('mc-api-keys/generate',{name:'Candidate assistant',scopes:['notes','contacts','world','collections','media','profile','actions','stats']}).api_key;atomic(keyFile,JSON.stringify({key}));fs.chmodSync(keyFile,0o600);}
    headers=`    headers:\n      Authorization: ${JSON.stringify('Bearer '+key)}\n`;
  }
  text+=`\nmcp_servers:\n  notebook:\n    url: http://127.0.0.1:${port}/mcp\n${headers}`;
  if(process.env.GODSPEED_COMPUTER==='on')text+=`  godspeed_computer:\n    command: ${JSON.stringify(process.execPath)}\n    args: ["/opt/godspeed/kit/computer/mcp.js"]\n    env:\n      GODSPEED_COMPUTER_DIR: "/opt/data/full-candidate/computer"\n`;
}
atomic(file,text);fs.chmodSync(file,0o600);
console.log(JSON.stringify({wired:true,isolated:true,port}));
