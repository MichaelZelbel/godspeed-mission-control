import path from 'node:path';

// The text of a Windows command file (.cmd) whose paths reach the program intact.
//
// cmd.exe reads a command file in the console's code page (850 on a German Windows,
// 437 on an American one), not in UTF-8. A path written into the file as it is,
// "C:\Users\Müller\godspeed-v2", therefore arrived as "C:\Users\M├╝ller\godspeed-v2",
// the program said the folder does not exist, and the coach, journal and headache
// context silently disappeared for every reader whose name has an umlaut (until
// 6 October 2026). So a path is only ever written in letters every code page shares:
//
//   - as it is, when it is plain ASCII;
//   - else relative to the command file's own folder (%~dp0, which cmd fills in
//     itself, correctly), normalised once into a variable;
//   - else from the folder variables Windows sets for every program
//     (%LOCALAPPDATA%, %APPDATA%, %USERPROFILE%), when only the part under one of
//     them is plain;
//   - else, and only then, the file switches cmd to UTF-8 (chcp 65001) for its own
//     lines and puts the previous code page back when the program has finished.
//
// write(at) returns the file's command lines, ending in \r\n; at(somePath) gives
// the text to put between the double quotes where that path belongs.
const plain=text=>/^[\x20-\x7e]*$/.test(text);
const percent=text=>text.replaceAll('%','%%');
const FOLDERS=['LOCALAPPDATA','APPDATA','USERPROFILE'];

export function commandFile(write,{folder,env=process.env}={}){
  const win=path.win32,lines=[],names=new Map();let utf8=false;
  const variable=(target,value,normalise)=>{
    if(!names.has(target)){
      const name='GODSPEED_PATH_'+(names.size+1);names.set(target,name);
      lines.push(normalise?`for %%I in ("${value}") do set "${name}=%%~fI"`:`set "${name}=${value}"`);
    }
    return '%'+names.get(target)+'%';
  };
  const at=raw=>{
    const target=win.resolve(raw);
    if(plain(target))return percent(target);
    if(folder){
      const home=win.resolve(folder),relative=win.relative(home,target);
      if(!win.isAbsolute(relative)&&plain(relative))return variable(target,'%~dp0'+percent(relative||'.'),true);
    }
    for(const name of FOLDERS){
      const base=env[name]&&win.resolve(env[name]);
      if(!base||!target.toLowerCase().startsWith(base.toLowerCase().replace(/\\$/,'')+'\\'))continue;
      const rest=target.slice(base.replace(/\\$/,'').length);
      if(plain(rest))return variable(target,'%'+name+'%'+percent(rest),false);
    }
    utf8=true;return percent(target);
  };
  const body=write(at);
  if(!lines.length&&!utf8)return '@echo off\r\n'+body;
  if(!utf8)return '@echo off\r\nsetlocal\r\n'+lines.map(l=>l+'\r\n').join('')+body;
  return '@echo off\r\nsetlocal\r\n'
    +'for /f "tokens=2 delims=:" %%c in (\'chcp\') do for /f "tokens=1 delims=. " %%d in ("%%c") do set "GODSPEED_CODEPAGE=%%d"\r\n'
    +'chcp 65001 >nul\r\n'+lines.map(l=>l+'\r\n').join('')+body
    +'set "GODSPEED_EXIT=%ERRORLEVEL%"\r\nif defined GODSPEED_CODEPAGE chcp %GODSPEED_CODEPAGE% >nul\r\nexit /b %GODSPEED_EXIT%\r\n';
}
