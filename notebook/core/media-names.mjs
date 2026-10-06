// The one name a stored media file gets: its content hash and a short,
// readable form of the name it came with. Until 6 October 2026 upload,
// transfer, migration and the Drive import each built it their own way and
// checked it with the record-id rule, so "Ärztebrief.txt" and "notes..v2.txt"
// were refused, and a 120-character name saved but then stopped the server
// when it was read back (64+1+120 is longer than that rule allows).
const SUFFIX = 60, EXTENSION = 12;
export function mediaObjectName(digest, original) {
  if (!/^[a-f0-9]{64}$/.test(String(digest))) throw new Error('Invalid media content hash');
  const base = String(original ?? '').split(/[\\/]/).pop()
    .replace(/[äÄ]/g, m => m === 'ä' ? 'ae' : 'Ae').replace(/[öÖ]/g, m => m === 'ö' ? 'oe' : 'Oe').replace(/[üÜ]/g, m => m === 'ü' ? 'ue' : 'Ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[^a-zA-Z0-9]+/, '').replace(/[._-]+$/, '');
  const dot = base.lastIndexOf('.'), extension = dot > 0 && base.length - dot <= EXTENSION + 1 ? base.slice(dot) : '';
  const stem = (extension ? base.slice(0, dot) : base).slice(0, SUFFIX - extension.length).replace(/[._-]+$/, '');
  return digest + '-' + ((stem || 'media') + extension);
}
// A stored name as it is read back: a plain file name in the media folder.
// Names made before the rule above (up to 64+1+181 characters, and longer from
// a migration) stay readable.
export function mediaFileName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,250}$/.test(name)) throw Object.assign(new Error('Unknown media object'), { status: 404 });
  return name;
}
