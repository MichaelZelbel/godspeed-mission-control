import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';import {installStarter} from '../core/starter-workspace.mjs';
test('original Godspeed skills and commands reach the integrated notebook in developer assistants',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-wiring-')),root=path.join(base,'workspace'),home=path.join(base,'assistant');installStarter(root);
  const script=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
  const wire=port=>execFileSync(process.execPath,[script,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:String(port),GODSPEED_DEVICE:'local'},windowsHide:true});wire(41987);
  // The shared file names the standard address; this machine's own port is in its untracked settings.
  const shared=fs.readFileSync(path.join(root,'.mcp.json'),'utf8'),local=()=>JSON.parse(fs.readFileSync(path.join(root,'.claude','settings.local.json'),'utf8')).env||{};
  assert.equal(JSON.parse(shared).mcpServers.notebook.url,'${GODSPEED_NOTEBOOK_URL:-http://127.0.0.1:47831/mcp}');
  assert.equal(local().GODSPEED_NOTEBOOK_URL,'http://127.0.0.1:41987/mcp');
  for(const alias of ['.claude','.agents'])assert.equal(fs.realpathSync(path.join(root,alias,'skills')),fs.realpathSync(path.join(root,'skills')));
  for(const command of ['mc-search','mc-check-brief','mc-decide','mc-goals','mc-work-run','mc-compile-rules'])assert.ok(fs.existsSync(path.join(home,'bin',command+(process.platform==='win32'?'.cmd':''))),command);
  const ignored=fs.readFileSync(path.join(root,'.gitignore'),'utf8');
  wire(41988);
  assert.equal(fs.readFileSync(path.join(root,'.mcp.json'),'utf8'),shared,'another port leaves the shared file as it was');
  assert.equal(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),ignored,'and the ignore list too');
  assert.equal(local().GODSPEED_NOTEBOOK_URL,'http://127.0.0.1:41988/mcp');
  assert.match(fs.readFileSync(path.join(root,'.codex/config.toml'),'utf8'),/41988\/mcp/);
  assert.match(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),/notebook:\s*\n\s+url: http:\/\/127\.0\.0\.1:41988\/mcp/);
  assert.match(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),/\/\.godspeed\//);
  wire(47831);assert.equal(local().GODSPEED_NOTEBOOK_URL,undefined,'the standard port needs no override');
});
// A Windows junction keeps an absolute target: after a move by hand it led nowhere,
// and wiring again failed with EEXIST, so the notebook did not start.
test('a folder moved by hand is wired again, and a real skills folder in a link\'s place is kept',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-moved-')),before=path.join(base,'before'),root=path.join(base,'after'),home=path.join(base,'assistant');installStarter(before);
  const script=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
  const wire=workspace=>execFileSync(process.execPath,[script,home],{env:{...process.env,GODSPEED_WORKSPACE:workspace,GODSPEED_PORT:'41989',GODSPEED_DEVICE:'local'},windowsHide:true});
  wire(before);fs.renameSync(before,root);
  wire(root);
  for(const alias of ['.claude','.agents'])assert.equal(fs.realpathSync(path.join(root,alias,'skills')),fs.realpathSync(path.join(root,'skills')));
  fs.unlinkSync(path.join(root,'.agents','skills'));fs.mkdirSync(path.join(root,'.agents','skills'));fs.writeFileSync(path.join(root,'.agents','skills','mine.md'),'kept');
  wire(root);
  assert.equal(fs.lstatSync(path.join(root,'.agents','skills')).isSymbolicLink(),false);
  assert.equal(fs.readFileSync(path.join(root,'.agents','skills','mine.md'),'utf8'),'kept');
});
