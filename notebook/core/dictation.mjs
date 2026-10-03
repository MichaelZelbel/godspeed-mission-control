import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {assistantEnvironment} from './assistant-files.mjs';

export async function transcribeRecording(descriptor,workspace,audio,type){
  const extension={'audio/webm':'.webm','audio/ogg':'.ogg','audio/mp4':'.mp4','audio/wav':'.wav'}[type.split(';')[0]];
  if(!extension)throw new Error('This audio format is not supported');
  if(!audio.length||audio.length>8*1024*1024)throw new Error('Record up to one minute of speech');
  if(!descriptor?.verified)throw new Error('Connect Hermes to use dictation');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'godspeed-dictation-'));
  const filename=path.join(directory,'recording'+extension);
  try{
    await fs.writeFile(filename,audio,{mode:0o600});
    const python=process.platform==='win32'?path.join(descriptor.sourceRoot,'venv','Scripts','python.exe'):path.resolve(descriptor.executable,'../../.venv/bin/python3');
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(python,[fileURLToPath(new URL('../assistant-files/dictate.py',import.meta.url)),filename],{cwd:descriptor.sourceRoot||path.resolve(descriptor.executable,'../..'),windowsHide:true,env:assistantEnvironment({home:descriptor.home,workspace}),stdio:['ignore','pipe','ignore']});
      let output='';const timeout=setTimeout(()=>{child.kill();reject(new Error('Dictation took too long. Try a shorter recording.'));},90000);
      child.on('error',()=>{clearTimeout(timeout);reject(new Error('Dictation could not start'));});
      child.stdout.on('data',chunk=>{output+=chunk;if(output.length>100000){child.kill();}});
      child.on('close',code=>{clearTimeout(timeout);try{if(code)throw new Error();const value=JSON.parse(output.trim().split(/\r?\n/).at(-1));if(!value.ok)throw new Error();resolve(value);}catch{reject(new Error('Dictation could not transcribe this recording. Please try again.'));}});
    });
    if(!result.text)throw new Error('No speech was heard. Please try again.');
    return result;
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}
