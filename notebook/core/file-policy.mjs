// The notebook's records (notes, people, facts and everything imported from
// Menerio) live in one folder of the mission control, named for what it is. It
// was records/ until 2026-10-05; Store moves an older folder here once.
export const recordsFolder='notebook';
export const legacyRecordsFolder='records';
export const durableRoots=[recordsFolder,'coach','journal','routines/journal','routines/headache','profile','rules','observations','goals','work','due','world','prompts','ideas','inbox','forecasts','skills','assistant-state'];
export const durableFiles=['AGENTS.md','CLAUDE.md','README.md','procedures.md','decisions.md','MEMORY.md','FULL-ALPHA.md'];
// Inside a durable root but device-private: kept on this machine, never put in
// the knowledge repository and never indexed. assistant-state/history is the
// assistant's own undo archive. It holds every previous version of its state,
// it grows without a bound, and nothing ever reads it back. On a working server
// it reached several gigabytes, and because the sync commit holds the workspace
// lock while Git hashes what it stages, every dashboard write queued behind it
// and then failed.
export const devicePrivatePaths=['assistant-state/history'];
export function devicePrivate(name){const value=String(name).split('\\').join('/');return devicePrivatePaths.some(p=>value===p||value.startsWith(p+'/'));}
// durable: may be written through the transaction writer and belongs in this
// machine's own backups. shared: also leaves this machine, into the knowledge
// repository, the search index and the AI's context. The archive is the first
// path that is one without being the other, so the two had to stop being the
// same question.
export function durable(name){return !name.split('/').some(p=>p==='..'||p.startsWith('.')||/^(secrets|node_modules)$/i.test(p))&&(durableRoots.some(root=>name.startsWith(root+'/'))||durableFiles.includes(name));}
export function shared(name){return durable(name)&&!devicePrivate(name);}
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
