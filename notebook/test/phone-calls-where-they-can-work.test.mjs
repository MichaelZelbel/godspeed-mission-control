import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';

// PHONE CALLS, 18 October 2026. The phone add-on (third-party/addons/mc-phone) installed only on the
// previous edition's server (account `ai`, its folder ~/godspeed), yet every mission control got its
// recipe, which told the assistant to place the call through a service that was not there. Now:
// - the add-on installs on a Linux machine set up with the Linux installer too: the copy that comes
//   with the product finds its own mission control and the account that owns it, and that account
//   owns the order socket, so no restart is needed before the assistant may place an order;
// - every mission control still gets the recipe, and the recipe asks the machine first: where no
//   call can go out (Windows, a Mac, the one-line server, or a Linux machine without the add-on) it
//   says so plainly and prepares the call for the person to make.
const kit=fileURLToPath(new URL('../../',import.meta.url));
const lf=file=>fs.readFileSync(file,'utf8').replaceAll('\r','');
const sha=text=>createHash('sha256').update(text).digest('hex');
const recipe=path.join(kit,'notebook','recipes','phone-errands'),addon=path.join(kit,'third-party','addons','mc-phone');

test('every mission control gets the phone recipe, the add-on\'s own text, as a known version',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-phone-recipe-'));
  execFileSync(process.execPath,['--no-warnings',path.join(kit,'notebook','bin','godspeed.mjs'),'init'],{env:{...process.env,GODSPEED_WORKSPACE:root},windowsHide:true});
  for(const file of ['SKILL.md','templates/reservation-order.json']){
    assert.equal(lf(path.join(root,'skills','phone-errands',file)),lf(path.join(recipe,file)),file+' is installed');
    assert.equal(lf(path.join(addon,'skill','phone-errands',file)),lf(path.join(recipe,file)),file+': the add-on installs the same text, so no review is filed');
  }
  const known=JSON.parse(fs.readFileSync(path.join(kit,'notebook','data','recipe-revisions.json'),'utf8'))['phone-errands/SKILL.md'];
  assert.ok(known.includes(sha(lf(path.join(recipe,'SKILL.md')))),'this text is a known revision');
  assert.ok(known.includes('6ad379aa414b950b2fbb518fde78f03bbdc0ebd704cebb5d3685393693bc10bc'),'the text before 18 October 2026 is still known, so installed copies update');
});

test('the recipe asks the machine first, says plainly where no call can go out, and prepares the call instead',()=>{
  const text=lf(path.join(recipe,'SKILL.md')),description=text.match(/^description: (.*)$/m)[1];
  assert.match(description,/Everywhere else, says plainly that calls cannot be made from here and prepares the call for the person to make/);
  assert.ok(text.indexOf('Run `mc-phone health` before anything else')<text.indexOf('## Build the order'),'the check comes before any order');
  assert.match(text,/The command is not found, or it says the order was NOT submitted because a socket does not\n  exist:\*\* calls cannot be made from here/);
  assert.match(text,/not on Windows, not on a Mac, and not on the one-line server/);
  assert.match(text,/"I can't make phone calls from here, but I can get the call ready\n  for you\."/);
  assert.match(text,/Do not look for another way to dial\./);
  assert.match(text,/`configured` is false:\*\* the add-on is installed and its setup is not\n  finished/);
  assert.match(text,/## Prepare the call instead/);
  assert.match(text,/Never say or suggest that a call took place\./);
  assert.doesNotMatch(text,/[–—]/,'no long dashes');
  assert.doesNotMatch(text,/server's mc-phone service|This mission control's server has a phone service/,'it no longer assumes a server');
});

// The installer's decisions, read without installing anything (MC_PHONE_INSTALLER_FUNCTIONS_ONLY).
// Linux only, as the add-on is.
const linux={skip:process.platform!=='linux'&&'mc-phone installs on Linux only'};
const bash=(file,env={})=>{
  const clean=Object.fromEntries(Object.entries(process.env).filter(([k])=>!['GODSPEED','AI_USER','HP_SRC','SUDO_USER'].includes(k)));
  const r=spawnSync('bash',['-c','MC_PHONE_INSTALLER_FUNCTIONS_ONLY=1; . "$0"; printf "%s\\n%s\\n%s\\n" "$GODSPEED" "$AI_USER" "$HP_SRC"',file],{env:{...clean,...env},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const [godspeed,user,source]=r.stdout.split('\n');return {godspeed,user,source};
};
const physical=dir=>execFileSync('bash',['-c','cd "$0" && pwd -P',dir],{encoding:'utf8'}).trim();
function copyAt(dir){
  fs.mkdirSync(path.join(dir,'service'),{recursive:true});
  fs.copyFileSync(path.join(addon,'install.sh'),path.join(dir,'install.sh'));
  fs.copyFileSync(path.join(addon,'service','service.py'),path.join(dir,'service','service.py'));
  return path.join(dir,'install.sh');
}

test('the copy that comes with the Linux installer finds its mission control, the account that owns it, and its own code',linux,()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-phone-home-')),root=path.join(home,'godspeed v2');
  fs.mkdirSync(root);fs.writeFileSync(path.join(root,'AGENTS.md'),'# mine\n');
  const here=path.join(root,'.godspeed','integrated-runtime','versions','0123456789abcdef0123456789abcdef01234567','third-party','addons','mc-phone');
  const found=bash(copyAt(here));
  assert.equal(found.godspeed,physical(root));
  assert.equal(found.user,os.userInfo().username,'the account that owns the folder');
  assert.equal(found.source,physical(here),'the code beside it, not a download');
});

test('what GODSPEED and AI_USER say wins',linux,()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-phone-given-')),root=path.join(home,'godspeed-v2');
  fs.mkdirSync(root);fs.writeFileSync(path.join(root,'AGENTS.md'),'# mine\n');
  const here=path.join(root,'.godspeed','integrated-runtime','versions','abc','third-party','addons','mc-phone');
  const found=bash(copyAt(here),{GODSPEED:'/srv/other',AI_USER:'someone'});
  assert.deepEqual([found.godspeed,found.user],['/srv/other','someone']);
});

test('a copy outside any mission control, on a machine without the previous edition\'s account, settles on nothing, so the installer stops before installing anything',{skip:linux.skip||(spawnSync('id',['ai']).status===0&&'this machine has an account called ai')},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-phone-loose-'));
  const found=bash(copyAt(dir));
  assert.deepEqual([found.godspeed,found.user],['','']);
  const script=fs.readFileSync(path.join(addon,'install.sh'),'utf8');
  const stop=script.indexOf('Found no mission control folder'),first=script.indexOf('install -d -m 755 /opt/mc-phone');
  assert.ok(stop>0&&first>stop,'the stop comes before the first thing installed');
  assert.ok(script.indexOf('the one-line server')<first,'the one-line server is named before anything is installed');
});

test('the assistant\'s account owns the order socket, so it needs no restart to place an order',()=>{
  const script=fs.readFileSync(path.join(addon,'install.sh'),'utf8');
  assert.match(script,/printf '\[Socket\]\\nSocketUser=%s\\n' "\$AI_USER" > \/etc\/systemd\/system\/mc-phone-rpc\.socket\.d\/assistant\.conf/);
  assert.match(script,/systemctl restart mc-phone-rpc\.socket/,'restarted, so a changed owner takes effect');
  assert.doesNotMatch(script,/AI_USER="\$\{AI_USER:-ai\}"/,'no longer assumes the account ai');
});
