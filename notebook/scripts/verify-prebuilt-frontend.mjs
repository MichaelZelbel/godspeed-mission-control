import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function verifyFrontend(root,revision){
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error('A verified frontend requires an exact committed source revision');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'godspeed-prebuilt-frontend.json'),'utf8').replace(/^\uFEFF/,''));
 if(manifest.kitCommit!==revision)throw Error('Frontend manifest belongs to another source revision');
 const prefix='kit/notebook/ui/dist/',expected=new Map();
 for(const entry of manifest.files.filter(f=>f.path.startsWith(prefix))){
  const name=entry.path.slice(prefix.length);
  if(!name||name.split('/').some(p=>!p||p==='.'||p==='..')||name.includes('\\')||expected.has(name)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid frontend manifest path or digest');
  expected.set(name,entry.sha256);
 }
 if(!expected.has('index.html'))throw Error('Frontend manifest contains no entry page');
 const base=path.join(root,'dist'),actual=new Map();
 const walk=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Frontend files must not redirect outside the build');if(stat.isDirectory())walk(file);else if(stat.isFile())actual.set(path.relative(base,file).split(path.sep).join('/'),createHash('sha256').update(fs.readFileSync(file)).digest('hex'));else throw Error('Unsupported frontend file');}};
 if(fs.lstatSync(base).isSymbolicLink())throw Error('Frontend folder must not redirect outside the build');walk(base);
 if(actual.size!==expected.size||[...expected].some(([name,digest])=>actual.get(name)!==digest))throw Error('Frontend bytes differ from the verified package manifest');
 return {revision,verified_files:actual.size};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyFrontend(path.resolve(process.argv[2]),process.argv[3])));
