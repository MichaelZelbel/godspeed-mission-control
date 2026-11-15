#!/usr/bin/env node
// An ElevenLabs voice note for Hermes (core/voice-speech.mjs says why it exists). Hermes runs this as
// the command of its text-to-speech provider godspeed-elevenlabs (core/voice-replies.mjs writes it
// into config.yaml), with the text in a file and the path the sound goes to:
//
//   node elevenlabs-voice.mjs --voice <id> --model <model> --stability 0.5 --similarity 0.75
//     --style 0 --keys <Hermes home>/.env --state <mission control>/.godspeed <text file> <sound file>
//
// It exits with 0 when the sound file is written. Otherwise it says why on stderr and exits with 1,
// and Hermes sends the answer as text; the first failure of a stretch is told to the person once.
import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {elevenLabsSpeech,keyFrom,outputFormat,voiceSettings,noteVoiceFailed,noteVoiceWorked,VoiceProblem} from '../core/voice-speech.mjs';

let options,positionals;
try{({values:options,positionals}=parseArgs({allowPositionals:true,options:{voice:{type:'string'},model:{type:'string'},stability:{type:'string'},similarity:{type:'string'},style:{type:'string'},keys:{type:'string'},state:{type:'string'}}}));}
catch(error){console.error(error.message);process.exit(2);}
const [input,output]=positionals;
if(!input||!output){console.error('Name the text file and the sound file.');process.exit(2);}
const format=outputFormat(output);
if(!format){console.error('The sound file must end in .ogg, .opus or .mp3.');process.exit(2);}
try{
 const settings=voiceSettings({stability:options.stability,similarity_boost:options.similarity,style:options.style});
 const audio=await elevenLabsSpeech({key:keyFrom({keys:options.keys}),voice:options.voice,model:options.model,settings,text:fs.readFileSync(input,'utf8'),format,api:process.env.GODSPEED_ELEVENLABS_API||undefined});
 fs.writeFileSync(output,audio);
 noteVoiceWorked(options.state);
}catch(error){
 const problem=error instanceof VoiceProblem?error.message:'The voice note could not be written: '+String(error?.message||error);
 noteVoiceFailed(options.state,problem);
 console.error(problem);process.exit(1);
}
