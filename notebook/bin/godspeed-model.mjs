#!/usr/bin/env node
import {addonModel} from '../core/addon-model.mjs';

try{
 const args=process.argv.slice(2),at=args.indexOf('--workspace');
 const root=at>=0?args[at+1]:process.env.GODSPEED_MODEL_WORKSPACE||process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_ROOT||process.env.GODSPEED_DIR;
 if(!root||args.some((arg,i)=>arg!=='--workspace'&&!(at>=0&&i===at+1)&&!['--check','--describe'].includes(arg)))throw Error('Use godspeed-model --workspace FOLDER [--check]');
 const describe=args.includes('--check')||args.includes('--describe');let text='';
 if(!describe)for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>600000)throw Error('The model request is too large');}
 const result=await addonModel({root,describe,...(!describe?{input:JSON.parse(text)}:{})});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){process.stderr.write((error?.message||'The Godspeed model request failed')+'\n');process.exitCode=1;}
