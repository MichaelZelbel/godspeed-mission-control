import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {atomic} from './records/store.mjs';
import {notebookNote,retiredNotebookNote} from './file-policy.mjs';

// THE NOTE AT THE TOP OF A MISSION CONTROL WITH THE NOTEBOOK IS NOTEBOOK.md (2.0.0-beta.11). It
// says what the folder is, and its presence is how the move recipe, the mail tool and the sync
// tell such a folder from any other. Until this version it was FULL-ALPHA.md: the first file a
// newcomer saw in their folder, on every system, and a name the product no longer has. A new
// install writes NOTEBOOK.md. Whatever recognises the folder by its note accepts either name.
//
// An existing FULL-ALPHA.md is renamed only where it never leaves this computer through Git
// (noteTravels). Where it does, another computer of the same folder may still run 2.0.0-beta.10,
// which knows only FULL-ALPHA.md: run against that version's sync (ticket 08's first review, 29
// October 2026), a renamed note was deleted on both computers, they pushed their own ignore file
// every minute, and the older computer's mail tool, no longer seeing a notebook, committed the
// locked key store. There the note keeps its name in this release; a later release renames it
// once every computer of a copy runs 2.0.0-beta.11 or later.

// What `init` writes, and what earlier versions wrote. A note that still reads as one of those
// was written by the notebook and is brought up to date; one the owner changed is left alone.
// Until 6 October 2026 an existing copy was never updated, so machines kept saying records/ and
// forbade the owner's own Git.
const earlierTexts=['records/','notebook/'].map(folder=>'# Integrated notebook\n\nThis is the complete Godspeed Mission Control starter with an integrated notebook. AGENTS.md and the original folder workflow remain the operating manual. Notebook records live in '+folder+' alongside those folders. Use the notebook or its MCP tools for notebook edits; use the original commands and readable files for Godspeed work. Credentials and disposable SQLite indexes stay in .godspeed and never enter private Git sync. Connected file sync uses the conflict-preserving reconciler; do not run a second Git synchronizer on the same workspace.\n');
export const notebookNoteText='# Integrated notebook\n\nThis is the complete Godspeed Mission Control starter with an integrated notebook. AGENTS.md and the original folder workflow remain the operating manual. Notebook records live in notebook/ alongside those folders. Use the notebook or its MCP tools for notebook edits; use the original commands and readable files for Godspeed work. Credentials, media and the rebuildable search databases stay in .godspeed and never enter Git. When this folder is its own Git repository (godspeed sync folder), the notebook commits only its own paths and your commits and pushes go on as before; otherwise its connected file sync is the only synchronizer for this folder.\n';

/** Whether `root` is a mission control with the notebook: it holds the note under either name. */
export const hasNotebookNote=root=>[notebookNote,retiredNotebookNote].some(name=>fs.existsSync(path.join(root,name)));

const git=(root,args)=>spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000});

// Whether FULL-ALPHA.md reaches other computers through Git, now or with the owner's next commit:
// the folder's own repository has a remote and tracks it, or does not ignore it; or a copy made in
// Settings beside an owner's repository (.godspeed/sync.git) tracks it. A copy made in Settings in
// the folder itself is the folder's own repository, with a remote. When Git cannot answer, the
// note is taken to travel, so it keeps its name.
export function noteTravels(root){
  const copy=path.join(root,'.godspeed','sync.git');
  if(fs.existsSync(copy)){
    const listed=git(root,['--git-dir='+copy,'--work-tree='+root,'ls-files','-z','--',retiredNotebookNote]);
    if(listed.error||listed.status!==0||listed.stdout)return true;
  }
  // Git missing, or refusing a folder that has a repository (one another user owns, "dubious
  // ownership"), cannot tell; only a folder with no repository is one.
  const inside=git(root,['rev-parse','--is-inside-work-tree']);
  if(inside.error||inside.status!==0)return fs.existsSync(path.join(root,'.git'));
  if(inside.stdout.trim()!=='true')return false;
  const remotes=git(root,['remote']);
  if(remotes.status!==0)return true;
  if(!remotes.stdout.trim())return false;
  const tracked=git(root,['ls-files','-z','--',retiredNotebookNote]);
  if(tracked.status!==0||tracked.stdout)return true;
  return git(root,['check-ignore','-q','--',retiredNotebookNote]).status!==0;
}

// An owner's own repository keeps the note out of its commits with a line such as /FULL-ALPHA.md
// (folder mode asks for one: sync/git.mjs useFolderRepository). When Git ignores the old name and
// not the new one, the line for NOTEBOOK.md goes into the repository's own exclude file, which
// belongs to this clone alone, so every clone keeps what the folder did and nothing the owner's
// Git tracks changes. Written into the tracked .gitignore instead (the first build of this
// ticket), the line was an uncommitted change on every updated clone: a second clone's sync
// stopped on it and the owner's own pull failed. A FULL-ALPHA.md the folder tracks is not ignored
// in Git's eyes, so a folder that commits its note gets no line. Returns the file written, or null.
export function carryIgnoreLine(root){
  if(!fs.existsSync(path.join(root,'.git')))return null;
  if(git(root,['check-ignore','-q','--',retiredNotebookNote]).status!==0||git(root,['check-ignore','-q','--',notebookNote]).status===0)return null;
  const where=git(root,['rev-parse','--git-path','info/exclude']).stdout?.trim();if(!where)return null;
  const file=path.resolve(root,where);let text='';
  try{text=fs.readFileSync(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  atomic(file,(text?text.replace(/\n*$/,'\n'):'')+'/'+notebookNote+'\n');
  return file;
}

// Renames FULL-ALPHA.md to NOTEBOOK.md once where it never leaves this computer, and with `write`
// (init) writes the note or brings a generated one up to date, under the name the folder keeps.
// When both are there and FULL-ALPHA.md stays on this computer, the notebook keeps NOTEBOOK.md and
// leaves FULL-ALPHA.md as it is. When FULL-ALPHA.md is the name the folder shares through Git (a
// new device that connected from its own Settings to a copy made before 2.0.0-beta.11: its init
// wrote NOTEBOOK.md, the copy then brought FULL-ALPHA.md), the device's own NOTEBOOK.md goes while
// it still reads as the notebook wrote it, so the folder keeps FULL-ALPHA.md alone; one the owner
// edited stays beside it. With `say` (the notebook's start) a folder left with both is said in the
// log, once, and a shared FULL-ALPHA.md is never named as one to delete: the sync does not commit
// the removal of a top-level file, so deleting it left that device's sync pending for good.
// state: 'none' (no note yet, unless `write` made one), 'current' (NOTEBOOK.md only), 'renamed',
// 'both', 'shared' (FULL-ALPHA.md keeps its name: it leaves this computer through Git), or 'kept'
// (the rename failed, e.g. a file another program holds on Windows; the old note still marks the
// folder and the next start tries again).
export function settleNotebookNote(root,{write=false,say}={}){
  try{carryIgnoreLine(root);}catch{}
  const note=path.join(root,notebookNote),old=path.join(root,retiredNotebookNote);
  let state=fs.existsSync(note)?'current':'none',target=note;
  if(fs.existsSync(old)){
    const travels=noteTravels(root);
    if(state==='current'&&travels&&[notebookNoteText,...earlierTexts].includes(fs.readFileSync(note,'utf8'))){fs.rmSync(note,{force:true});state='none';}
    if(state==='current'){
      state='both';
      const said=path.join(root,'.godspeed','notebook-note-both-said');
      if(say&&!fs.existsSync(said)){say('Your mission control folder holds both '+notebookNote+' and '+retiredNotebookNote+'. '+(travels?retiredNotebookNote+' is the note your other computers share, so it stays; '+notebookNote+' has your own changes and is left as it is.':'The notebook uses '+notebookNote+' and leaves '+retiredNotebookNote+' as it is; delete it once you no longer need what it says.'));atomic(said,new Date().toISOString()+'\n');}
    }
    else if(travels){state='shared';target=old;}
    else {try{fs.renameSync(old,note);state='renamed';}catch(error){return {state:'kept',error:error.message};}}
  }
  if(write&&(!fs.existsSync(target)||earlierTexts.includes(fs.readFileSync(target,'utf8')))){atomic(target,notebookNoteText);if(state==='none')state='current';}
  return {state};
}
