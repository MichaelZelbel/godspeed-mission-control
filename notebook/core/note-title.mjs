// The title a note gets when whoever saved it gave none: its first words, cut
// where a person would cut them. Until 9 October 2026 every such note was
// called "Captured note", so two notes about the same supplement were two
// "Captured note"s, the reader could not tell them apart in a list, and an
// assistant that saw the earlier one named it as a link it never made.

// Words a title does not end on ("Dr. Aydin says magnesium is fine with my").
const TRAILING = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'my', 'your', 'his', 'her', 'our', 'their', 'its', 'that', 'this', 'it', 'i', 'we', 'so', 'if', 'than', 'then', 'not', 'very',
  'under', 'over', 'after', 'before', 'into', 'onto', 'near', 'without', 'within', 'during', 'until', 'since', 'because', 'which', 'who', 'when', 'where', 'while', 'will', 'would', 'can', 'could', 'should', 'has', 'have', 'had', 'do', 'does', 'did',
  'der', 'die', 'das', 'und', 'oder', 'aber', 'mit', 'von', 'zu', 'im', 'in', 'am', 'an', 'auf', 'für', 'ist', 'mein', 'meine', 'ein', 'eine', 'dass', 'nicht']);
// A full stop after one of these does not end the sentence ("Dr. Aydin", "z.B. Tee").
const ABBREVIATIONS = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'mt', 'no', 'nr', 'vs', 'etc', 'eg', 'ie', 'e.g', 'i.e', 'z.b', 'bzw', 'ca', 'usw', 'jr', 'sr', 'approx', 'min', 'max', 'tel', 'str']);
const MAX_WORDS = 8, MAX_LENGTH = 80;

function firstLine(content) {
  for (const raw of String(content ?? '').split(/\r?\n/)) {
    const line = raw
      .replace(/!?\[\[([^\]|#]+)[^\]]*\]\]/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
      .replace(/[*_`~]+/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (line && !/^related:/i.test(line)) return line;
  }
  return '';
}

// Where the first sentence ends: a . ! or ? followed by a space or the end,
// unless it follows an abbreviation, a single letter or a number ("400 mg. ").
function firstSentence(line) {
  const re = /[.!?…]+(?=\s|$)/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[0] === '.') {
      const before = line.slice(0, m.index).split(/\s/).pop().toLowerCase();
      if (ABBREVIATIONS.has(before) || /^[\p{L}]$/u.test(before) || /^[\p{L}](\.[\p{L}])+$/u.test(before)) continue;
    }
    return line.slice(0, m.index);
  }
  return line;
}

export function titleFromContent(content, {fallbackDate = null} = {}) {
  const line = firstLine(content);
  const url = line.match(/^(https?:\/\/[^\s]+)$/i)?.[1];
  if (url) { try { return 'Link from ' + new URL(url).hostname.replace(/^www\./, ''); } catch {} }
  let text = firstSentence(line.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim());
  // A clause mark ends a title when there are words enough before it
  // ("Greta's tip for my sleep: magnesium glycinate, 400 mg" is "Greta's tip for my sleep").
  const clause = text.search(/\s[-–—]\s|[:;,(]/);
  if (clause > 0 && text.slice(0, clause).trim().split(/\s+/).length >= 2) text = text.slice(0, clause);
  let words = text.split(/\s+/).filter(Boolean);
  if (words.length > MAX_WORDS) words = words.slice(0, MAX_WORDS);
  const bare = w => w.toLowerCase().replace(/[^\p{L}\p{N}.']/gu, '');
  while (words.length > 2 && TRAILING.has(bare(words.at(-1)))) words.pop();
  let title = words.join(' ').replace(/[\s.,;:!?…'"“”‘’)(\[\]-]+$/u, '').replace(/^["“‘'(\[]+/u, '').trim();
  if (title.length > MAX_LENGTH) title = title.slice(0, MAX_LENGTH).replace(/\s+\S*$/, '').trim();
  if (!title) return fallbackDate ? 'Note of ' + fallbackDate : 'Note';
  return title.charAt(0).toLocaleUpperCase() + title.slice(1);
}
