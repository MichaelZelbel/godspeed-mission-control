import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {atomic} from './records/store.mjs';

// What never enters the folder's Git history: the notebook's own state on this
// computer (.godspeed: keys, the search databases, media, backups), the
// assistant's own undo archive, the notebook's review copies, and the links and
// settings the AI apps on this computer keep in the folder. wire-assistant.mjs
// writes the same list on every install and update.
export const keptOutOfGit=['/.godspeed/','/.codex/','/.vscode/','/.agents/','/.claude/skills','/.claude/settings.local.json','/assistant-state/history/','/conflicts/'];

// Adds to the folder's .gitignore the lines of keptOutOfGit it does not have yet,
// and never removes or changes a line of the owner's. Returns the lines it added.
export function keepOutOfGit(root,entries=keptOutOfGit){
  const file=path.join(root,'.gitignore');let text='';
  try{text=fs.readFileSync(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  const lines=new Set(text.split(/\r?\n/)),missing=entries.filter(entry=>!lines.has(entry));
  if(missing.length)atomic(file,(text?text.replace(/\n*$/,'\n'):'')+missing.join('\n')+'\n');
  return missing;
}

// A NEW MISSION CONTROL STARTS WITH ITS FIRST COMMIT (18 October 2026). The installers make the
// folder a Git repository and committed nothing, so `git ls-files` was empty and mc-search, which
// searches the files Git keeps, found nothing at all on a new installation, not even
// procedures.md. Its branch was also `master` (Ubuntu's Git), and the notebook syncs only on
// `main`. Now `godspeed.mjs init`, which every installer runs after laying the folder down and
// every update runs again, commits everything once when the folder is the top of a repository
// with no commit yet, on `main`. A folder with any commit, a folder inside another repository,
// a folder with no repository, and a Git that is busy are left exactly as they are. The commit
// never stops an installation: what went wrong is reported and the folder is left as it was.
export function firstCommit(root){
  const git=(args,options={})=>spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:120000,...options});
  if(!fs.existsSync(path.join(root,'.git')))return {made:false,reason:'no repository'};
  const top=git(['rev-parse','--show-cdup']);
  if(top.error)return {made:false,reason:'Git is not on this computer'};
  if(top.status!==0||top.stdout.trim())return {made:false,reason:'not the top of its own repository'};
  if(git(['rev-parse','--verify','-q','HEAD']).status===0)return {made:false,reason:'already has commits'};
  const gitDir=git(['rev-parse','--absolute-git-dir']).stdout.trim();
  if(gitDir&&fs.existsSync(path.join(gitDir,'index.lock')))return {made:false,reason:'Git is busy in this folder'};
  keepOutOfGit(root);
  // Before the first commit nothing points at the branch's name yet, so it can still be main.
  const branch=git(['symbolic-ref','--quiet','HEAD']).stdout.trim();
  if(branch==='refs/heads/master')git(['symbolic-ref','HEAD','refs/heads/main']);
  const added=git(['add','-A']);
  if(added.status!==0)return {made:false,reason:'git add failed: '+String(added.stderr||'').trim().slice(0,300)};
  // A new computer often has no Git name yet; the commit then carries the notebook's, as the
  // conversation archive's commits do (tools/prompt-harvest.js).
  const has=key=>Boolean(git(['config',key]).stdout.trim());
  const env=has('user.name')&&has('user.email')?process.env:{...process.env,GIT_AUTHOR_NAME:'Godspeed Mission Control',GIT_AUTHOR_EMAIL:'godspeed@localhost',GIT_COMMITTER_NAME:'Godspeed Mission Control',GIT_COMMITTER_EMAIL:'godspeed@localhost'};
  // The owner's own Git hooks belong to their commits, not to this one.
  const hooks=path.join(root,'.godspeed','no-hooks');fs.mkdirSync(hooks,{recursive:true});
  const committed=git(['-c','core.hooksPath='+hooks,'commit','-q','-m','Start my mission control'],{env});
  if(committed.status!==0){git(['read-tree','--empty']);return {made:false,reason:'git commit failed: '+String(committed.stderr||committed.stdout||'').trim().slice(0,300)};}
  return {made:true,branch:git(['symbolic-ref','--quiet','--short','HEAD']).stdout.trim(),files:git(['ls-files']).stdout.split('\n').filter(Boolean).length};
}
