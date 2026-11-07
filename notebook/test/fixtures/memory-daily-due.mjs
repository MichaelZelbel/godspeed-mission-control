import fs from 'node:fs';

const [command,slug]=process.argv.slice(2);
if(command==='state'){
 if(process.env.FIXTURE_MEMORY_DUE_STATE_FAIL)process.exitCode=2;
 else process.stdout.write((process.env.FIXTURE_MEMORY_DUE_STATE||'[]')+'\n');
}else if(command==='done'){
 if(process.env.FIXTURE_MEMORY_DUE_LOG)fs.appendFileSync(process.env.FIXTURE_MEMORY_DUE_LOG,JSON.stringify(process.argv.slice(2))+'\n');
 if(process.env.FIXTURE_MEMORY_DUE_REFUSE)process.exitCode=2;
}else process.exitCode=2;
