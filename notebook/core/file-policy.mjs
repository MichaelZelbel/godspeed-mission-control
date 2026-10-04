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
export function durable(name){return !name.split('/').some(p=>p==='..'||p.startsWith('.')||/^(secrets|node_modules)$/i.test(p))&&!devicePrivate(name)&&(durableRoots.some(root=>name.startsWith(root+'/'))||durableFiles.includes(name));}
