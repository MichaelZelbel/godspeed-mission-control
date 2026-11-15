#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {checkVoice} from '../core/voice-check.mjs';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('check-voice --workspace <workspace> --check <file> [--long-form]\nReads the chosen user voice-rules block. Reports missing rules honestly. Long-form sentence length hits are advisory.');process.exit(0);}
const workspace=args[args.indexOf('--workspace')+1],target=args[args.indexOf('--check')+1];
if(!args.includes('--workspace')||!args.includes('--check')||!workspace||!target)throw Error('Choose the workspace and actual text file');
const voice=path.join(path.resolve(workspace),'profile','voice.md'),profile=fs.existsSync(voice)?fs.readFileSync(voice,'utf8'):'',result=checkVoice(fs.readFileSync(path.resolve(target),'utf8'),profile,{longForm:args.includes('--long-form')});
console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
