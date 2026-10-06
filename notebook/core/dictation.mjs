import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {assistantEnvironment} from './assistant-files.mjs';
import {runChild} from './child-process.mjs';

export async function transcribeRecording(descriptor,workspace,audio,type,{spawnProcess=spawn}={}){
  const extension={'audio/webm':'.webm','audio/ogg':'.ogg','audio/mp4':'.mp4','audio/wav':'.wav'}[type.split(';')[0]];
  if(!extension)throw new Error('This audio format is not supported');
  if(!audio.length||audio.length>8*1024*1024)throw new Error('Record up to one minute of speech');
  if(!descriptor?.verified)throw new Error('Connect Hermes to use dictation');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'godspeed-dictation-'));
  const filename=path.join(directory,'recording'+extension);
  try{
    await fs.writeFile(filename,audio,{mode:0o600});
    const python=process.platform==='win32'?path.join(descriptor.sourceRoot,'venv','Scripts','python.exe'):path.resolve(descriptor.executable,'../../.venv/bin/python3');
    // The transcript is decoded once, whole: decoding each piece of output on
    // its own broke a German letter split between two pieces (until 6 October 2026).
    const run=await runChild(python,[fileURLToPath(new URL('../assistant-files/dictate.py',import.meta.url)),filename],{cwd:descriptor.sourceRoot||path.resolve(descriptor.executable,'../..'),env:assistantEnvironment({home:descriptor.home,workspace}),timeoutMs:90000,maxBytes:100000,spawnProcess})
      .catch(error=>{throw new Error(error.code==='TIMEOUT'?'Dictation took too long. Try a shorter recording.':error.code==='SPAWN_FAILED'?'Dictation could not start':'Dictation could not transcribe this recording. Please try again.');});
    let result;
    try{if(run.code)throw new Error();result=JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));if(!result.ok)throw new Error();}catch{throw new Error('Dictation could not transcribe this recording. Please try again.');}
    if(!result.text)throw new Error('No speech was heard. Please try again.');
    return result;
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}
