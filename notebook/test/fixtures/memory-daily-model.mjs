import fs from 'node:fs';

if(process.argv.includes('--check')){
 if(process.env.FIXTURE_MEMORY_MODEL_CHECK_FAIL)process.exitCode=1;
 else process.stdout.write(JSON.stringify({configured:!process.env.FIXTURE_MEMORY_MODEL_UNCONFIGURED})+'\n');
}else{
 if(process.env.FIXTURE_MEMORY_MODEL_LOG)fs.appendFileSync(process.env.FIXTURE_MEMORY_MODEL_LOG,fs.readFileSync(0,'utf8')+'\n');
 if(process.env.FIXTURE_MEMORY_MODEL_FAIL)process.exitCode=3;
 else process.stdout.write(JSON.stringify({text:process.env.FIXTURE_MEMORY_MODEL_RESPONSE||'{}'})+'\n');
}
