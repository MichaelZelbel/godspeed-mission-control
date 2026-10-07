import path from 'node:path';
import {MenerioSource} from '../core/migration-source.mjs';
import {copyAccount,verifyBundle,stageAccount} from '../core/migration.mjs';

const [command,...args]=process.argv.slice(2),flags={};
for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])throw new Error('Use --option value');flags[args[i].slice(2)]=args[i+1];}
try{
  if(command==='copy'){
    if(!flags.output)throw new Error('Choose a new private --output directory');
    const source=new MenerioSource({project:flags.project,token:process.env.SUPABASE_ACCESS_TOKEN,apiKey:process.env.MENERIO_API_KEY,user:flags.user});
    await source.identify();const result=await copyAccount(source,path.resolve(flags.output),{resume:flags.resume==='true',onProgress:row=>console.log(JSON.stringify({copiedTable:row.table,rows:row.count}))});
    console.log(JSON.stringify({verified:result.complete,tables:result.tables.length,rows:result.tables.reduce((n,t)=>n+t.count,0),notes:result.tables.find(t=>t.name==='notes')?.count,media:result.media.length}));
  }else if(command==='verify'){if(!flags.input)throw new Error('Choose --input');const result=verifyBundle(path.resolve(flags.input));console.log(JSON.stringify({verified:true,tables:result.tables.length,media:result.media.length}));}
  else if(command==='stage'){if(!flags.input||!flags.output)throw new Error('Choose --input and a new --output directory');console.log(JSON.stringify(stageAccount(path.resolve(flags.input),path.resolve(flags.output))));}
  else throw new Error('Use copy, verify, or stage. The migration never modifies the source account or overwrites an existing workspace.');
}catch(e){console.error(e.message);process.exitCode=1;}
