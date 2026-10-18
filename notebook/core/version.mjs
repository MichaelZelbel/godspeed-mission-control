import fs from 'node:fs';

// The product's one name and one version, for everything a person sees: the health address, the
// notebook's own tools and its messages. Until 18 October 2026 the health address always said
// "2.0.0-alpha.1" and several names said "Full Alpha", whatever release was installed. The version
// lives in notebook/package.json and nowhere else. Folder, state and service names that existing
// installations depend on keep their older words; they are names, not what anybody reads.
export const PRODUCT='Godspeed Mission Control';
export const VERSION=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
