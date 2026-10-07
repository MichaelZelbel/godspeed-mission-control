// The YAML the notebook writes into a note's frontmatter, and the YAML it reads
// back. Obsidian shows frontmatter as properties and rewrites it in its own
// style when the owner edits one, so the reader takes ordinary block YAML:
// mappings, sequences (also "- key: value" items), flow [] and {}, plain,
// single- and double-quoted scalars, | and > blocks and comments. Anchors,
// aliases, tags and multiple documents are refused rather than guessed.
//
// The writer emits a subset the reader returns exactly: a string that could be
// read as anything other than that string is double-quoted with JSON escapes.

const RESERVED = /^(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|y|Y|n|N|\.inf|\.Inf|\.INF|\.nan|\.NaN|\.NAN|<<|=)$/;
const NUMBERISH = /^[-+]?(?:(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d+)?|0[xX][\da-fA-F_]+|0[oObB][0-7_]+|\d[\d_]*(?::[0-5]?\d)+(?:\.\d*)?|\.(?:inf|Inf|INF|nan|NaN|NAN))$/;
// Characters YAML does not allow unescaped, plus the line separators some
// readers treat as line breaks.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff\ud800-\udfff]/;

function plainSafe(text) {
  return text.length > 0 && text === text.trim() && !UNSAFE.test(text) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) &&
    !/:(?:\s|$)|\s#/.test(text) && !RESERVED.test(text) && !NUMBERISH.test(text);
}
function quote(text) {
  return JSON.stringify(text).replace(/[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
function scalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Frontmatter cannot hold ' + value);
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'string') return plainSafe(value) ? value : quote(value);
  throw new Error('Frontmatter cannot hold a ' + typeof value);
}
function keyText(key) { return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) && !RESERVED.test(key) ? key : quote(key); }
const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && typeof value !== 'function' && typeof value !== 'symbol';
// JSON drops undefined object values and turns undefined array items into
// null; the frontmatter keeps the same meaning.
const item = value => present(value) ? value : null;

function emitMap(object, indent, out) {
  for (const [key, value] of Object.entries(object)) {
    if (!present(value)) continue;
    emitEntry(' '.repeat(indent) + keyText(key) + ':', value, indent, out);
  }
}
function emitEntry(head, value, indent, out) {
  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') value = value.toJSON();
  if (Array.isArray(value)) {
    if (!value.length) return out.push(head + ' []');
    out.push(head);
    for (const entry of value) emitItem(item(entry), indent + 2, out);
  } else if (isMap(value)) {
    if (!Object.keys(value).some(key => present(value[key]))) return out.push(head + ' {}');
    out.push(head); emitMap(value, indent + 2, out);
  } else out.push(head + ' ' + scalar(value));
}
function emitItem(value, indent, out) {
  const dash = ' '.repeat(indent) + '-';
  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') value = value.toJSON();
  if (Array.isArray(value)) {
    if (!value.length) return out.push(dash + ' []');
    out.push(dash);
    for (const entry of value) emitItem(item(entry), indent + 2, out);
  } else if (isMap(value)) {
    const entries = Object.entries(value).filter(([, v]) => present(v));
    if (!entries.length) return out.push(dash + ' {}');
    // The first entry shares the dash's line, the rest line up under it.
    const lines = [];
    emitMap(Object.fromEntries(entries), indent + 2, lines);
    lines[0] = dash + ' ' + lines[0].slice(indent + 2);
    out.push(...lines);
  } else out.push(dash + ' ' + scalar(value));
}
export function stringify(object) {
  if (!isMap(object)) throw new Error('Frontmatter must be a mapping');
  const out = []; emitMap(object, 0, out);
  return out.length ? out.join('\n') + '\n' : '';
}

// ---- Reading -------------------------------------------------------------

class YamlError extends Error {}
// A key read is set as data: "__proto__" is a key like any other, as JSON.parse
// has it, not the map's prototype (until 6 October 2026 it became one, and an
// "isAdmin" under it was then inherited by the whole map).
function setKey(map, key, value) { if (key === '__proto__') Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true }); else map[key] = value; }
const fail = (message, line) => { throw new YamlError(message + (line === undefined ? '' : ' (frontmatter line ' + (line + 1) + ')')); };

function resolvePlain(text) {
  if (text === '' || /^(?:null|Null|NULL|~)$/.test(text)) return null;
  if (/^(?:true|True|TRUE)$/.test(text)) return true;
  if (/^(?:false|False|FALSE)$/.test(text)) return false;
  if (/^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(text) || /^[-+]?(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) return Number(text);
  if (/^[-+]?\d+$/.test(text)) return Number(text);
  if (/^0x[\da-fA-F]+$/.test(text)) return parseInt(text.slice(2), 16);
  if (/^0o[0-7]+$/.test(text)) return parseInt(text.slice(2), 8);
  if (/^[-+]?\.(?:inf|Inf|INF)$/.test(text)) return text.startsWith('-') ? -Infinity : Infinity;
  if (/^\.(?:nan|NaN|NAN)$/.test(text)) return NaN;
  return text;
}
const ESCAPES = { '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\u0085', _: '\u00a0', L: '\u2028', P: '\u2029' };

export function parse(text) {
  const lines = String(text).replace(/^\ufeff/, '').split(/\r?\n/);
  let row = 0;
  const indentOf = line => { const m = line.match(/^ */)[0].length; if (line[m] === '\t' && line.slice(m).trim()) fail('Tabs cannot indent YAML', row); return m; };
  const blank = line => { const t = line.trim(); return t === '' || t.startsWith('#'); };
  const skip = () => { while (row < lines.length && blank(lines[row])) row++; };
  if (lines.some(line => /^(?:---|\.\.\.)(?:\s|$)/.test(line))) fail('Only one YAML document is allowed');

  // A key at the start of `rest`: the key and the text after its colon, or null.
  function keyAt(rest) {
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const end = quotedEnd(rest, 0);
      if (end < 0) return null;
      const after = rest.slice(end + 1).match(/^\s*:(?:\s|$)/);
      if (!after) return null;
      return { key: rest[0] === '"' ? unescapeDouble(rest.slice(1, end)) : rest.slice(1, end).replaceAll("''", "'"), value: rest.slice(end + 1 + after[0].length) };
    }
    if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(rest) && !/^[-?:][^\s]/.test(rest)) return null;
    const m = rest.match(/^(.*?)\s*:(?:\s+|$)/);
    if (!m || m[1].includes(' #') || /^\s*$/.test(m[1])) return null;
    return { key: m[1], value: rest.slice(m[0].length) };
  }
  function quotedEnd(textValue, start) {
    const q = textValue[start];
    for (let i = start + 1; i < textValue.length; i++) {
      if (q === '"' && textValue[i] === '\\') { i++; continue; }
      if (textValue[i] === q) { if (q === "'" && textValue[i + 1] === "'") { i++; continue; } return i; }
    }
    return -1;
  }
  function unescapeDouble(raw) {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c !== '\\') { out += c; continue; }
      const e = raw[++i];
      if (e in ESCAPES) out += ESCAPES[e];
      else if (e === 'x') { out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; }
      else if (e === 'u') { out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16)); i += 4; }
      else if (e === 'U') { out += String.fromCodePoint(parseInt(raw.slice(i + 1, i + 9), 16)); i += 8; }
      else fail('Unknown escape \\' + e, row);
    }
    return out;
  }
  // Folds the lines of a multi-line flow scalar: one break is a space, each
  // further empty line a newline.
  function fold(parts) {
    let out = '', pending = 0;
    parts.forEach((part, i) => {
      if (i === 0) { out = part; return; }
      if (part === '') { pending++; return; }
      out += pending ? '\n'.repeat(pending) : ' '; out += part; pending = 0;
    });
    return out + '\n'.repeat(pending);
  }
  // The index of the quote closing a scalar that opened before `source`.
  function closeIndex(source, q) {
    for (let i = 0; i < source.length; i++) {
      if (q === '"' && source[i] === '\\') { i++; continue; }
      if (source[i] === q) { if (q === "'" && source[i + 1] === "'") { i++; continue; } return i; }
    }
    return -1;
  }
  // A quoted scalar starting at column `col` of the current row, possibly over
  // several rows. A line break folds to a space, each empty line to a newline,
  // and in double quotes a trailing backslash joins two lines without either.
  function readQuoted(col) {
    const q = lines[row][col], startRow = row, parts = [];
    let source = lines[row].slice(col + 1);
    for (;;) {
      const end = closeIndex(source, q);
      if (end >= 0) {
        const tail = source.slice(end + 1).trim();
        if (tail && !tail.startsWith('#')) fail('Text after a quoted value', row);
        parts.push(source.slice(0, end)); break;
      }
      parts.push(source);
      if (++row >= lines.length) fail('Unterminated quoted value', startRow);
      source = lines[row];
    }
    row++;
    let out = '', pending = null, empties = 0;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      let piece = i ? part.replace(/^[ \t]+/, '') : part, escaped = false;
      if (!last) {
        const slashes = q === '"' ? piece.match(/\\+$/) : null;
        if (slashes && slashes[0].length % 2) { escaped = true; piece = piece.slice(0, -1); }
        else piece = piece.replace(/[ \t]+$/, '');
      }
      if (i && piece === '' && !last) { empties++; return; }
      if (pending) out += empties ? '\n'.repeat(empties) : pending === 'fold' ? ' ' : '';
      out += q === '"' ? unescapeDouble(piece) : piece.replaceAll("''", "'");
      pending = escaped ? 'join' : 'fold'; empties = 0;
    });
    return out;
  }
  // A flow collection starting at column `col`; it may run over several rows.
  function readFlow(col) {
    let source = lines[row].slice(col), startRow = row, depth = 0, quote = null, end = -1;
    for (;;) {
      for (let i = end + 1; i < source.length; i++) {
        const c = source[i];
        if (quote) { if (quote === '"' && c === '\\') i++; else if (c === quote) { if (quote === "'" && source[i + 1] === "'") i++; else quote = null; } continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') { if (--depth === 0) { end = i; break; } }
        else if (c === '#' && /\s/.test(source[i - 1] || ' ')) { source = source.slice(0, i); break; }
      }
      if (depth === 0 && end >= 0) break;
      end = source.length - 1;
      if (++row >= lines.length) fail('Unterminated flow collection', startRow);
      source += ' ' + lines[row].trim();
    }
    const tail = source.slice(end + 1).trim();
    if (tail && !tail.startsWith('#')) fail('Text after a flow collection', row);
    row++;
    let i = 0;
    const space = () => { while (i < source.length && /\s/.test(source[i])) i++; };
    function value() {
      space();
      const c = source[i];
      if (c === '[') {
        i++; const list = [];
        for (;;) { space(); if (source[i] === ']') { i++; return list; } list.push(value()); space(); if (source[i] === ',') i++; else if (source[i] !== ']') fail('Expected , or ] in a flow list', startRow); }
      }
      if (c === '{') {
        i++; const map = {};
        for (;;) {
          space(); if (source[i] === '}') { i++; return map; }
          const key = String(value()); space();
          let v = null;
          if (source[i] === ':') { i++; space(); v = source[i] === ',' || source[i] === '}' ? null : value(); }
          if (Object.hasOwn(map, key)) fail('Duplicate key ' + key, startRow);
          setKey(map, key, v); space();
          if (source[i] === ',') i++; else if (source[i] !== '}') fail('Expected , or } in a flow mapping', startRow);
        }
      }
      if (c === '"' || c === "'") {
        const close = quotedEnd(source, i), raw = source.slice(i + 1, close); i = close + 1;
        return c === '"' ? unescapeDouble(raw) : raw.replaceAll("''", "'");
      }
      const m = source.slice(i).match(/^(?:[^,[\]{}:#]|:(?=[^\s,[\]{}])|#(?<!\s#))*/);
      i += m[0].length;
      return resolvePlain(m[0].trim());
    }
    return value();
  }
  // A | or > block whose header is `header`; content lines are indented
  // deeper than `parent`.
  function readBlock(header, parent) {
    const m = header.match(/^([|>])([-+]?)(\d?)([-+]?)\s*(?:#.*)?$/);
    if (!m) fail('Invalid block scalar header', row);
    const literal = m[1] === '|', chomp = m[2] || m[4], explicit = m[3] ? Number(m[3]) : 0;
    row++;
    let indent = explicit ? parent + explicit : 0;
    const body = [];
    while (row < lines.length) {
      const line = lines[row];
      if (line.trim() === '') { body.push(''); row++; continue; }
      const own = line.match(/^ */)[0].length;
      if (!indent) { if (own <= parent) break; indent = own; }
      if (own < indent) break;
      body.push(line.slice(indent)); row++;
    }
    let trailing = 0; while (body.length && body[body.length - 1] === '') { body.pop(); trailing++; }
    let content;
    if (literal) content = body.join('\n');
    else {
      let lead = 0; while (lead < body.length && body[lead] === '') lead++;
      const rest = body.slice(lead);
      content = '';
      rest.forEach((line, i, body) => {
        if (i === 0) { content = line; return; }
        const prev = body[i - 1], spaced = /^\s/.test(line) || /^\s/.test(prev);
        if (line === '') { content += '\n'; return; }
        content += prev === '' || spaced ? (prev === '' && !spaced ? '' : '\n') : ' ';
        content += line;
      });
      content = '\n'.repeat(lead) + content;
    }
    if (!body.length) return chomp === '+' ? '\n'.repeat(trailing) : '';
    if (chomp === '-') return content;
    if (chomp === '+') return content + '\n' + '\n'.repeat(trailing);
    return content + '\n';
  }
  // A plain scalar starting with `first` that may continue on deeper rows.
  function readPlain(first, parent) {
    const parts = [first.replace(/\s+#.*$/, '').trim()];
    row++;
    while (row < lines.length) {
      const line = lines[row];
      if (line.trim() === '') { parts.push(''); row++; continue; }
      if (line.trim().startsWith('#') || indentOf(line) <= parent) break;
      const rest = line.trim();
      if (keyAt(rest) || /^-(?:\s|$)/.test(rest)) break;
      parts.push(rest.replace(/\s+#.*$/, '')); row++;
    }
    while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    return resolvePlain(fold(parts));
  }
  // The value that follows "key:" or "- " on the current row at column `col`,
  // where the owning node sits at indent `parent`.
  function inlineValue(rest, col, parent, mapValue = false) {
    const textValue = rest.trim();
    if (textValue === '' || textValue.startsWith('#')) {
      row++; skip();
      if (row >= lines.length) return null;
      const next = indentOf(lines[row]);
      if (next > parent) return node(next);
      // "key:\n- item" is a sequence at the key's own indentation.
      if (mapValue && next === parent && /^-(?:\s|$)/.test(lines[row].slice(next))) return sequence(next);
      return null;
    }
    const at = col + rest.indexOf(textValue[0]);
    if (/^[&*!]/.test(textValue)) fail('Anchors, aliases and tags are not supported', row);
    if (textValue[0] === '"' || textValue[0] === "'") return readQuoted(at);
    if (textValue[0] === '[' || textValue[0] === '{') return readFlow(at);
    if (textValue[0] === '|' || textValue[0] === '>') return readBlock(textValue, parent);
    return readPlain(textValue, parent);
  }
  function mapping(indent) {
    const map = {};
    for (;;) {
      skip();
      if (row >= lines.length) return map;
      const line = lines[row], own = indentOf(line);
      if (own < indent) return map;
      if (own > indent) fail('Unexpected indentation', row);
      const entry = keyAt(line.slice(own));
      if (!entry) return map;
      if (Object.hasOwn(map, entry.key)) fail('Duplicate key ' + entry.key, row);
      setKey(map, entry.key, inlineValue(entry.value, line.length - entry.value.length, indent, true));
    }
  }
  function sequence(indent) {
    const list = [];
    for (;;) {
      skip();
      if (row >= lines.length) return list;
      const line = lines[row], own = indentOf(line);
      if (own !== indent || !/^-(?:\s|$)/.test(line.slice(own))) { if (own > indent) fail('Unexpected indentation', row); return list; }
      const rest = line.slice(own + 1), content = rest.trim();
      if (content === '' || content.startsWith('#')) { list.push(inlineValue('', own + 1, indent)); continue; }
      const col = own + 1 + rest.indexOf(content[0]);
      // "- key: value" and "- - item" open a node at the content's column.
      if (keyAt(content) || /^-(?:\s|$)/.test(content)) { lines[row] = ' '.repeat(col) + content; list.push(node(col)); continue; }
      list.push(inlineValue(rest, own + 1, indent));
    }
  }
  function node(indent) {
    skip();
    const content = lines[row].slice(indent);
    if (/^-(?:\s|$)/.test(content)) return sequence(indent);
    if (keyAt(content)) return mapping(indent);
    return inlineValue(content, indent, indent - 1);
  }
  skip();
  if (row >= lines.length) return {};
  if (indentOf(lines[row]) !== 0) fail('Frontmatter must start at the first column', row);
  const result = node(0);
  skip();
  if (row < lines.length) fail('Unexpected content', row);
  if (!isMap(result)) fail('Frontmatter must be a mapping');
  return result;
}
export { YamlError };
