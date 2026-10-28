import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {atomic} from './records/store.mjs';
import {notebookNote,retiredNotebookNote} from './file-policy.mjs';

// THE NOTE AT THE TOP OF A MISSION CONTROL WITH THE NOTEBOOK IS NOTEBOOK.md (2.0.0-beta.11). It
// says what the folder is, and its presence is how the move recipe, the mail tool and the sync
// tell such a folder from any other. Until this version it was FULL-ALPHA.md: the first file a
// newcomer saw in their folder, on every system, and a name the product no longer has. An
// install from before keeps working: whatever recognises the folder by its note accepts either
// name, and the notebook renames the old one once, at `init` (every install and update) and at
// its start.

// What `init` writes, and what earlier versions wrote. A note that still reads as one of those
// was written by the notebook and is brought up to date; one the owner changed is left alone.
// Until 6 October 2026 an existing copy was never updated, so machines kept saying records/ and
// forbade the owner's own Git.
const earlierTexts=['records/','notebook/'].map(folder=>'# Integrated notebook\n\nThis is the complete Godspeed Mission Control starter with an integrated notebook. AGENTS.md and the original folder workflow remain the operating manual. Notebook records live in '+folder+' alongside those folders. Use the notebook or its MCP tools for notebook edits; use the original commands and readable files for Godspeed work. Credentials and disposable SQLite indexes stay in .godspeed and never enter private Git sync. Connected file sync uses the conflict-preserving reconciler; do not run a second Git synchronizer on the same workspace.\n');
export const notebookNoteText='# Integrated notebook\n\nThis is the complete Godspeed Mission Control starter with an integrated notebook. AGENTS.md and the original folder workflow remain the operating manual. Notebook records live in notebook/ alongside those folders. Use the notebook or its MCP tools for notebook edits; use the original commands and readable files for Godspeed work. Credentials, media and the rebuildable search databases stay in .godspeed and never enter Git. When this folder is its own Git repository (godspeed sync folder), the notebook commits only its own paths and your commits and pushes go on as before; otherwise its connected file sync is the only synchronizer for this folder.\n';

/** Whether `root` is a mission control with the notebook: it holds the note under either name. */
export const hasNotebookNote=root=>[notebookNote,retiredNotebookNote].some(name=>fs.existsSync(path.join(root,name)));

const inside=(folder,file)=>{const relative=path.relative(folder,file);return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);};
// Git quotes a path with a backslash, a quote or a non-ASCII letter in it, C style (a Windows
// path to a global excludes file comes back as "C:\\Users\\..."); this gives back the path.
const unquote=name=>{if(!/^".*"$/.test(name))return name;const bytes=[];const body=name.slice(1,-1);for(let i=0;i<body.length;i++){if(body[i]!=='\\'){bytes.push(...Buffer.from(body[i]));continue;}const next=body[++i];if(/[0-7]/.test(next)){bytes.push(parseInt(body.slice(i,i+3),8));i+=2;}else bytes.push(...Buffer.from({a:'\x07',b:'\b',f:'\f',n:'\n',r:'\r',t:'\t',v:'\v'}[next]??next));}return Buffer.from(bytes).toString('utf8');};

// An owner's own repository keeps the note out of its commits with a line such as /FULL-ALPHA.md
// (folder mode asks for one: sync/git.mjs useFolderRepository). The renamed note keeps whatever
// the folder did: when Git ignores the old name and not the new one, the same line for the new
// name goes in right below the old one, in the file that holds it (an ignore rule from outside
// the folder goes into the repository's own exclude file instead). A FULL-ALPHA.md the folder
// tracks is not ignored in Git's eyes, so a folder that commits its note goes on committing it.
// No line of the owner's is changed or removed. Returns the file it wrote to, or null.
export function carryIgnoreLine(root){
  if(!fs.existsSync(path.join(root,'.git')))return null;
  const git=args=>spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:30000});
  const old=git(['check-ignore','-v','--',retiredNotebookNote]);
  if(old.status!==0||git(['check-ignore','-q','--',notebookNote]).status===0)return null;
  const match=/^(.*):(\d+):(.*)\t/.exec(old.stdout||'');if(!match)return null;
  const [,source,number,pattern]=match,twin=pattern.includes(retiredNotebookNote)?pattern.split(retiredNotebookNote).join(notebookNote):'/'+notebookNote;
  let file=path.resolve(root,unquote(source)),at=Number(number);
  if(!inside(root,file)){const exclude=git(['rev-parse','--git-path','info/exclude']).stdout.trim();if(!exclude)return null;file=path.resolve(root,exclude);at=0;}
  let text='';try{text=fs.readFileSync(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  const lines=text.split('\n');
  if(at>0&&at<=lines.length){lines.splice(at,0,twin+(lines[at-1].endsWith('\r')?'\r':''));atomic(file,lines.join('\n'));}
  else atomic(file,(text?text.replace(/\n*$/,'\n'):'')+twin+'\n');
  return file;
}

// Renames FULL-ALPHA.md to NOTEBOOK.md once, and with `write` (init) writes the note or brings a
// generated one up to date. When both are there the notebook keeps NOTEBOOK.md and leaves
// FULL-ALPHA.md as it is; with `say` (the notebook's start) it says so in its log, once.
// state: 'none' (no note yet, unless `write` made one), 'current' (NOTEBOOK.md only), 'renamed',
// 'both', or 'kept' (the rename failed, e.g. a file another program holds on Windows; the old
// note still marks the folder and the next start tries again).
export function settleNotebookNote(root,{write=false,say}={}){
  try{carryIgnoreLine(root);}catch{}
  const note=path.join(root,notebookNote),old=path.join(root,retiredNotebookNote);
  let state=fs.existsSync(note)?'current':'none';
  if(fs.existsSync(old)){
    if(state==='none'){try{fs.renameSync(old,note);state='renamed';}catch(error){return {state:'kept',error:error.message};}}
    else {
      state='both';
      const said=path.join(root,'.godspeed','notebook-note-both-said');
      if(say&&!fs.existsSync(said)){say('Your mission control folder holds both '+notebookNote+' and '+retiredNotebookNote+'. The notebook uses '+notebookNote+' and leaves '+retiredNotebookNote+' as it is; delete it once you no longer need what it says.');atomic(said,new Date().toISOString()+'\n');}
    }
  }
  if(write&&(!fs.existsSync(note)||earlierTexts.includes(fs.readFileSync(note,'utf8')))){atomic(note,notebookNoteText);if(state==='none')state='current';}
  return {state};
}
