export const durableRoots=['records','coach','journal','routines/journal','routines/headache','profile','rules','observations','goals','work','due','world','prompts','ideas','inbox','forecasts','skills','assistant-state'];
export const durableFiles=['AGENTS.md','CLAUDE.md','README.md','procedures.md','decisions.md','MEMORY.md','FULL-ALPHA.md'];
export function durable(name){return !name.split('/').some(p=>p==='..'||p.startsWith('.')||/^(secrets|node_modules)$/i.test(p))&&(durableRoots.some(root=>name.startsWith(root+'/'))||durableFiles.includes(name));}
