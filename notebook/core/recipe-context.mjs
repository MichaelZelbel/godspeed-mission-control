import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function recipeContext(store,name){
 if(!/^[a-z][a-z0-9-]{0,80}$/.test(name))throw Error('Invalid workflow name');
 const installed=path.join(store.root,'skills',name),bundled=fileURLToPath(new URL('../recipes/'+name+'/',import.meta.url));
 const root=fs.existsSync(path.join(installed,'SKILL.md'))?installed:bundled;
 if(!fs.existsSync(path.join(root,'SKILL.md')))throw Error('The selected workflow is not installed: '+name);
 if(fs.lstatSync(root).isSymbolicLink())throw Error('A workflow must not redirect to another installation');
 const base=fs.realpathSync(root),sources=[],limit=1024*1024;let bytes=0;
 if(root===installed){const relative=path.relative(fs.realpathSync(store.root),base);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('An installed workflow must stay in its selected workspace');}
 const read=file=>{if(fs.lstatSync(file).isSymbolicLink())throw Error('Workflow references must not redirect outside the installed workflow');const relative=path.relative(base,fs.realpathSync(file));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Workflow reference escaped its own folder');const text=fs.readFileSync(file,'utf8');bytes+=Buffer.byteLength(text);if(bytes>limit)throw Error('The full workflow exceeds its context limit; do not silently truncate it');sources.push({path:relative.replaceAll('\\','/'),content:text});};
 read(path.join(root,'SKILL.md'));
 const visit=folder=>{
  if(fs.lstatSync(folder).isSymbolicLink())throw Error('Workflow references must stay in the installed folder');
  for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   if(entry.name.startsWith('.')||['vendor','node_modules'].includes(entry.name))continue;
   const file=path.join(folder,entry.name);
   if(entry.isSymbolicLink())throw Error('Workflow references must not redirect outside the installed workflow');
   if(entry.isDirectory())visit(file);
   else if(entry.isFile()&&entry.name.endsWith('.md')&&file!==path.join(root,'SKILL.md'))read(file);
  }
 };
 // Multi-stage methods keep sibling stage documents and nested playbooks.
 // Executable dependencies are separate from the complete authored method.
 visit(root);
 return {name,source:root===installed?'installed user workflow':'bundled workflow',complete_read:true,sources};
}
