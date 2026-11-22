import fs from 'node:fs';
import path from 'node:path';
import {briefingReads} from '../core/briefing.mjs';

// Exits 1 when a kept sparse-<table>.json snapshot holds anything the brief would read (#974).
const [folder,...files]=process.argv.slice(2);
const bad=files.filter(file=>{
 const state=JSON.parse(fs.readFileSync(path.join(folder,file),'utf8')),rows=Array.isArray(state)?state:state.data;
 return !Array.isArray(rows)||briefingReads(file.replace(/^sparse-|\.json$/g,'').replace(/-/g,'_'),rows).length;
});
if(bad.length){console.error('the brief would read '+bad.join(', '));process.exit(1);}
