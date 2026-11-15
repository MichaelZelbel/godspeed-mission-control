import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync,spawnSync} from 'node:child_process';
import {commandFile} from '../scripts/windows-command-file.mjs';
import {installStarter} from '../core/starter-workspace.mjs';

// cmd.exe reads a command file in the console's code page, so a reader called Müller got
// "C:\Users\M├╝ller\..." in every wrapper and the coach, journal and headache context
// silently disappeared. A command file may carry only letters every code page shares.
const ascii=text=>/^[\x00-\x7f]*$/.test(text);
const home='C:\\Users\\Müller\\AppData\\Local\\Godspeed State\\hermes\\bin';
const env={LOCALAPPDATA:'C:\\Users\\Müller\\AppData\\Local',USERPROFILE:'C:\\Users\\Müller'};

test('a plain path is written as it is, with its percent signs doubled',()=>{
  const text=commandFile(at=>'"'+at('C:\\Program Files\\node.exe')+'" "'+at('C:\\100%\\run.mjs')+'" %*\r\n',{folder:home,env});
  assert.equal(text,'@echo off\r\n"C:\\Program Files\\node.exe" "C:\\100%%\\run.mjs" %*\r\n');
});

test('a path beside the command file is reached from the file\'s own folder, once',()=>{
  const root='C:\\Users\\Müller\\godspeed-v2';
  const text=commandFile(at=>'set "GODSPEED_ROOT='+at(root)+'"\r\n"node" "x.mjs" --godspeed "'+at(root)+'"\r\n',{folder:home,env});
  assert.ok(ascii(text),text);
  assert.match(text,/^@echo off\r\nsetlocal\r\nfor %%I in \("%~dp0\.\.\\\.\.\\\.\.\\\.\.\\\.\.\\godspeed-v2"\) do set "GODSPEED_PATH_1=%%~fI"\r\n/);
  assert.equal(text.match(/GODSPEED_PATH_\d/g).filter((v,i,a)=>a.indexOf(v)===i).length,1,'the same path is one variable');
  assert.match(text,/--godspeed "%GODSPEED_PATH_1%"/);
});

test('a path on another drive under a Windows folder variable uses that variable',()=>{
  const text=commandFile(at=>'"'+at('C:\\Users\\Müller\\AppData\\Local\\Godspeed\\runtime\\node.exe')+'" %*\r\n',{folder:'D:\\Godspeed\\bin',env});
  assert.ok(ascii(text),text);
  assert.match(text,/set "GODSPEED_PATH_1=%LOCALAPPDATA%\\Godspeed\\runtime\\node\.exe"/);
});

test('only a path nothing else can carry switches the file to UTF-8, and back afterwards',()=>{
  const text=commandFile(at=>'"'+at('D:\\Größe\\run.mjs')+'" %*\r\n',{folder:'C:\\Godspeed\\bin',env});
  assert.match(text,/chcp 65001 >nul\r\n"D:\\Größe\\run\.mjs" %\*\r\n/);
  assert.match(text,/if defined GODSPEED_CODEPAGE chcp %GODSPEED_CODEPAGE% >nul\r\nexit \/b %GODSPEED_EXIT%\r\n$/);
});

const windows={skip:process.platform!=='win32'&&'cmd.exe is Windows only'};
// The installed layout: the reader's name is in the part every path shares
// (C:\Users\Müller\...), the command files sit in one folder below it.
function probeFolder(){
  const base=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-cmd-')),'Müller Größe'),odd=path.join(base,'work'),bin=path.join(base,'assistant','bin');
  fs.mkdirSync(odd,{recursive:true});fs.mkdirSync(bin,{recursive:true});
  const probe=path.join(odd,'probe.mjs');
  fs.writeFileSync(probe,"console.log(JSON.stringify({args:process.argv.slice(2),root:process.env.GODSPEED_ROOT}));process.exit(3);\n");
  return {base,odd,bin,probe};
}
// Quoted the way Node's own shell:true does it, since the file's folder has a space.
function run(file,env=process.env){
  const result=spawnSync('cmd.exe',['/d','/s','/c',`""${file}" "one arg""`],{env,encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true});
  return {status:result.status,out:JSON.parse(result.stdout.trim().split(/\r?\n/).pop()),raw:result.stdout+result.stderr};
}
const body=(at,{probe,odd})=>'set "GODSPEED_ROOT='+at(odd)+'"\r\n"'+at(process.execPath)+'" "'+at(probe)+'" %* --godspeed "'+at(odd)+'"\r\n';

test('cmd.exe hands the program the exact path, through the command file\'s own folder',windows,()=>{
  const f=probeFolder(),file=path.join(f.bin,'probe.cmd');
  fs.writeFileSync(file,commandFile(at=>body(at,f),{folder:f.bin,env:{}}));
  assert.ok(ascii(fs.readFileSync(file,'utf8')));
  const r=run(file);
  assert.equal(r.status,3,'the program\'s exit code comes back');
  assert.deepEqual(r.out,{args:['one arg','--godspeed',f.odd],root:f.odd},r.raw);
});

test('cmd.exe hands over the exact path through a Windows folder variable',windows,()=>{
  const f=probeFolder(),other=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-cmd-other-')),file=path.join(other,'probe.cmd');
  // No relative road: the command file names a folder unrelated to it.
  fs.writeFileSync(file,commandFile(at=>body(at,f),{folder:'Z:\\elsewhere',env:{LOCALAPPDATA:f.base}}));
  assert.ok(ascii(fs.readFileSync(file,'utf8')));
  const r=run(file,{...process.env,LOCALAPPDATA:f.base});
  assert.equal(r.status,3);
  assert.deepEqual(r.out,{args:['one arg','--godspeed',f.odd],root:f.odd},r.raw);
});

test('cmd.exe hands over the exact path when the file has to switch to UTF-8',windows,()=>{
  const f=probeFolder(),file=path.join(f.bin,'probe.cmd');
  fs.writeFileSync(file,commandFile(at=>body(at,f),{folder:'Z:\\elsewhere',env:{}}));
  assert.match(fs.readFileSync(file,'utf8'),/chcp 65001/);
  const r=run(file);
  assert.equal(r.status,3,'the program\'s exit code survives putting the code page back');
  assert.deepEqual(r.out,{args:['one arg','--godspeed',f.odd],root:f.odd},r.raw);
});

test('every wrapper the wiring writes for a folder under an umlaut carries only ASCII, and works',windows,()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-Müller-')),root=path.join(base,'workspace'),assistant=path.join(base,'assistant');installStarter(root);
  const script=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
  execFileSync(process.execPath,[script,assistant],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41993',GODSPEED_DEVICE:'local'},windowsHide:true});
  const files=fs.readdirSync(path.join(assistant,'bin')).filter(n=>n.endsWith('.cmd'));
  assert.ok(files.length>5,files.join(', '));
  for(const name of files)assert.ok(ascii(fs.readFileSync(path.join(assistant,'bin',name),'utf8')),name);
  // Before the fix this said: There is no rules/ folder in ...\M├╝ller...
  const result=spawnSync('cmd.exe',['/d','/c',path.join(assistant,'bin','mc-compile-rules.cmd')],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
});

// Hermes' terminal on Windows is Git Bash, and Hermes starts it with MSYS_NO_PATHCONV=1 and
// MSYS2_ARG_CONV_EXCL=*, so Git Bash no longer turns /c/... into C:\... for node.exe. Until
// 9 October 2026 every command there failed: a command written only as a .cmd does not exist for
// a shell, and the kit's launchers handed node /c/... ("Cannot find module", and mc-work-run said
// "mc-work is not installed"). Each command now also has a shell form that works with those settings.
function gitBash(){
  const local=process.env.LOCALAPPDATA||'',files=process.env.ProgramFiles||'C:\Program Files';
  for(const candidate of [process.env.HERMES_GIT_BASH_PATH,path.join(local,'hermes','git','bin','bash.exe'),path.join(files,'Git','bin','bash.exe'),path.join(local,'Programs','Git','bin','bash.exe')])if(candidate&&fs.existsSync(candidate))return candidate;
  return null;
}
test('every command the wiring writes runs by its plain name in Hermes\' Windows terminal',windows,t=>{
  const bash=gitBash();if(!bash)return t.skip('Git Bash is not on this computer');
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-shell-')),root=path.join(base,'workspace'),assistant=path.join(base,'assistant'),bin=path.join(assistant,'bin');installStarter(root);
  const script=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
  execFileSync(process.execPath,[script,assistant],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41994',GODSPEED_DEVICE:'local'},windowsHide:true});
  for(const name of fs.readdirSync(bin).filter(n=>n.endsWith('.cmd')).map(n=>n.slice(0,-4)))assert.ok(fs.existsSync(path.join(bin,name)),name+' has a shell form beside its .cmd');
  const env={...process.env,PATH:bin+';'+path.dirname(process.execPath)+';'+process.env.PATH,MSYS_NO_PATHCONV:'1',MSYS2_ARG_CONV_EXCL:'*',GODSPEED_WORKSPACE:root,GODSPEED_ROOT:root,GODSPEED_DIR:root,HERMES_HOME:assistant,HOME:base};
  const run=command=>{const r=spawnSync(bash,['-c',command],{cwd:root,env,encoding:'utf8',windowsHide:true});return {status:r.status,out:r.stdout+r.stderr};};
  for(const command of ['mc-compile-rules','mc-goals list','mc-due list','mc-check-keys --help','mc-work-run --dry-run','godspeed-coach help']){
    const r=run(command);
    assert.doesNotMatch(r.out,/Cannot find module|command not found|not installed/,command+': '+r.out);
    assert.equal(r.status,0,command+': '+r.out);
  }
  assert.match(run('mc-work-run --dry-run').out,/nothing runnable now/);
  assert.match(fs.readFileSync(path.join(bin,'mc-goals'),'utf8'),/personal-command\.mjs' 'goals' "\$@"/,'in Hermes\' terminal mc-goals is the notebook\'s, as on Linux and a Mac');
});
