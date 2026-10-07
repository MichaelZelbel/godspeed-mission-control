import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,atomic} from '../core/records/store.mjs';import {fileContext} from '../core/context.mjs';
test('ordinary assistant file context excludes private comparison keys and explicit JSON or frontmatter privacy before truncation',()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-private-file-context-')));
 const files={'work/lead-comparisons/fictional/blind-key.json':JSON.stringify({mapping:{A:'Fictional original author',B:'Fictional comparator'}}),'work/hidden.json':JSON.stringify({content:'Fictional private words '.repeat(100),ai_visibility:'hidden'}),'work/private.json':JSON.stringify({private:true,content:'Fictional private file'}),'work/private-frontmatter.md':'---\n'+JSON.stringify({visibility_scope:'private'})+'\n---\nFictional private frontmatter','work/visible.md':'Fictional visible source'};
 for(const [relative,text] of Object.entries(files))atomic(path.join(store.root,relative),text);
 const context=fileContext(store,100);assert.deepEqual(context.files,[{path:'work/visible.md',content:'Fictional visible source'}]);assert.equal(context.truncated,false);
 for(const [relative,text] of Object.entries(files))assert.equal(fs.readFileSync(path.join(store.root,relative),'utf8'),text,'Private retained files must stay untouched');
});
