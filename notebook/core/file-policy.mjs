export const durableRoots=['records','coach','journal','routines/journal','routines/headache','profile','rules','observations','goals','work','due','world','prompts','ideas','inbox','forecasts','skills','assistant-state'];
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
