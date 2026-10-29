// The notebook's records (notes, people, facts and everything imported from
// Menerio) live in one folder of the mission control, named for what it is. It
// was records/ until 2026-10-05; Store moves an older folder here once.
export const recordsFolder='notebook';
export const legacyRecordsFolder='records';
// assistant: the owner's extra instructions for the assistant (assistant/extra-instructions.md),
// which its program reads right after "who it is" (assistant-soul.mjs).
export const durableRoots=[recordsFolder,'coach','journal','routines/journal','routines/headache','profile','rules','observations','goals','work','due','world','prompts','ideas','inbox','forecasts','skills','assistant-state','assistant'];
// The note at the top of the folder that says it is a mission control with the notebook
// (core/notebook-note.mjs): NOTEBOOK.md, and FULL-ALPHA.md until 2.0.0-beta.11, which the notebook
// renames only where it never leaves this computer through Git. syncedFiles are the files a copy
// made in Settings carries (sync/git.mjs), the same list as in 2.0.0-beta.10: NOTEBOOK.md stays
// out of it in this release, so a computer of the same copy that still runs beta.10 sees nothing
// change. With it in (ticket 08's first review, 29 October 2026), that computer deleted its note
// and untracked the new one, and both computers pushed their own ignore file every minute.
// durableFiles adds NOTEBOOK.md, so this machine's backups and the copy before an update hold it.
export const notebookNote='NOTEBOOK.md';
export const retiredNotebookNote='FULL-ALPHA.md';
export const syncedFiles=['AGENTS.md','CLAUDE.md','README.md','procedures.md','decisions.md','MEMORY.md',retiredNotebookNote];
export const durableFiles=[...syncedFiles,notebookNote];
// Inside a durable root but device-private: kept on this machine, never put in
// the knowledge repository and never indexed. assistant-state/history is the
// assistant's own undo archive. It holds every previous version of its state,
// it grows without a bound, and nothing ever reads it back. On a working server
// it reached several gigabytes, and because the sync commit holds the workspace
// lock while Git hashes what it stages, every dashboard write queued behind it
// and then failed.
export const devicePrivatePaths=['assistant-state/history'];
export function devicePrivate(name){const value=String(name).split('\\').join('/');return devicePrivatePaths.some(p=>value===p||value.startsWith(p+'/'));}
// What an update can change, and so all that the copy an installer makes before one has to hold
// (core/update-copy.mjs): every durable path but work/, and never the assistant's undo archive.
// work/ is the owner's work in progress and what it produced (recordings, installers, downloads,
// build copies); no update writes there (test/update-copy.test.mjs runs the real init and holds
// it to that), and it is where a grown mission control keeps its gigabytes: on one, 6.9 of the
// 8.3 GB a copy before each update took until 21 October 2026, most of it in no Git history.
export const updateUntouchedRoots=['work'];
export const updateCopyRoots=[...durableRoots.filter(root=>!updateUntouchedRoots.includes(root)),'conflicts'];
export const updateCopyFiles=durableFiles;
export function inUpdateCopy(name){
  const value=String(name).split('\\').join('/');
  if(devicePrivate(value)||updateUntouchedRoots.some(root=>value===root||value.startsWith(root+'/')))return false;
  return durable(value)||/^conflicts\/[\w-]+\.json$/.test(value);
}
// durable: may be written through the transaction writer and belongs in this
// machine's own backups. shared: also leaves this machine, into the knowledge
// repository, the search index and the AI's context. The archive is the first
// path that is one without being the other, so the two had to stop being the
// same question.
export function durable(name){return !name.split('/').some(p=>p==='..'||p.startsWith('.')||/^(secrets|node_modules)$/i.test(p))&&(durableRoots.some(root=>name.startsWith(root+'/'))||durableFiles.includes(name));}
export function shared(name){return durable(name)&&!devicePrivate(name)&&name!==notebookNote;}
// Bookkeeping a machine may delete outright: the scheduler prunes old run
// receipts and the earlier versions of jobs (jobs/scheduler.mjs prune), which
// nothing reads. Their removal travels as a removal, never turned into a
// tombstone and never asked about on the other machines. Until 7 October 2026
// sync wrote every pruned receipt back as a tombstone, which the next prune
// removed again, every round.
export const deletableTypes=new Set(['job_receipts','record_history']);
// A path Windows cannot hold: a part with <>:"\|?* or a control character,
// one ending in a dot or a space, or a device name (CON, PRN, AUX, NUL, COM1
// to COM9, LPT1 to LPT9, with any extension). The notebook names its own
// pages so they never are (records/layout.mjs); a file made on a Mac or on
// Linux can be, and Git on Windows cannot check it out.
export function windowsInvalid(name){return String(name).split('/').some(part=>/[<>:"\\|?*\u0000-\u001f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i.test(part));}
export function isRecordPath(name){return String(name).split('\\').join('/').startsWith(recordsFolder+'/');}
