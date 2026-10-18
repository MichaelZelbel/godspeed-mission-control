import fs from 'node:fs';
import path from 'node:path';
import {STOPWORDS} from './index/stopwords.mjs';

// One fixed name per kind of fact, for every notebook (D-298, 8 October 2026).
// Facts had been filed under whatever name the writer chose: "where he lives"
// was `location`, `current-city` and `Current city`, each read as its own fact,
// and a new value closed an older one only under the same name, so the
// notebook showed both. Per kind a `name`, the `aliases` it has been written
// under, and `one` when it has one current value at a time (where someone
// lives, a birthday, an employer). Only kinds that truly have one value at a
// time are `one`; the rest keep every value and only get one name.
//
// This list ships with the notebook, so a new install has it. A workspace's
// own world/fields.json is read over it: its entries win (their `one` and
// `says`), a shipped kind it names by its name or one of its aliases becomes
// that entry with both sets of aliases, and an alias it claims leaves every
// other kind. "occupation" is left out of job-title on purpose: what someone
// does and their title at work are both true.
export const DEFAULT_FIELDS = Object.freeze([
  {name: 'lives-in', one: true, says: 'the town or city someone lives in now',
    aliases: ['location', 'current-city', 'city', 'home-city', 'residence', 'current-location', 'wohnort', 'current-residence']},
  {name: 'current-country', one: true, says: 'the country someone lives in now', aliases: ['country', 'country-of-residence', 'land']},
  {name: 'address', one: true, says: 'street and number someone lives at now', aliases: ['current-street', 'street', 'home-address', 'street-address', 'current-address']},
  {name: 'postal-code', one: true, says: 'postcode of where someone lives now', aliases: ['zip', 'zip-code', 'postcode', 'plz']},
  {name: 'date-of-birth', one: true, says: 'the day someone was born', aliases: ['birthday', 'birth-date', 'born', 'geburtstag']},
  {name: 'place-of-birth', one: true, says: 'where someone was born', aliases: ['birthplace', 'born-in', 'geburtsort']},
  {name: 'full-name', one: true, says: 'someone\'s full name', aliases: ['legal-name', 'complete-name']},
  {name: 'married-surname', one: true, says: 'the surname someone took when they married', aliases: ['married-name']},
  {name: 'nationality', one: true, says: 'someone\'s nationality', aliases: ['citizenship']},
  {name: 'gender', one: true, says: 'someone\'s gender', aliases: ['sex']},
  {name: 'height', one: true, says: 'how tall someone is', aliases: ['body-height']},
  {name: 'current-weight', one: true, says: 'what someone weighs now', aliases: ['weight', 'body-weight', 'gewicht']},
  {name: 'age', one: true, says: 'how old someone is', aliases: ['alter']},
  {name: 'marital-status', one: true, says: 'married, single and the like', aliases: ['familienstand']},
  {name: 'employer', one: true, says: 'who someone works for now', aliases: ['current-employer', 'works-at', 'company-employed-by']},
  {name: 'job-title', one: true, says: 'someone\'s job or position now', aliases: ['job', 'position', 'current-job-title', 'current-position']},
  {name: 'uses-tool', one: false, says: 'a tool, app or platform someone uses',
    aliases: ['tool-/-platform', 'tool-platform', 'tool', 'tools', 'tool-usage', 'ai-tool-usage', 'software', 'app']},
  {name: 'social-handle', one: false, says: 'a social media account', aliases: ['social-media-handle', 'handle', 'social-media-account']},
  {name: 'hobbies', one: false, says: 'a hobby', aliases: ['hobby']},
  {name: 'topic-of-interest', one: false, says: 'a topic someone is interested in', aliases: ['interest', 'interests', 'topics-of-interest']},
  {name: 'email', one: false, says: 'an email address', aliases: ['email-address', 'e-mail']},
  {name: 'phone', one: false, says: 'a phone number', aliases: ['phone-number', 'mobile', 'telephone']},
  {name: 'website', one: false, says: 'a website someone runs or owns', aliases: ['personal-website', 'homepage', 'web-site']},
].map(f => Object.freeze({...f, aliases: Object.freeze(f.aliases)})));

// The form every name is compared in: "Current City", "current_city" and
// "current-city" are one name (the engine's world_fields.slug, same rule).
export const fieldSlug = s => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9/äöüß-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

// The shipped list with the workspace's read over it (see above).
export function mergeFields(shipped = DEFAULT_FIELDS, own = []) {
  const kinds = new Map();
  for (const f of shipped) {
    const name = fieldSlug(f?.name);
    if (name) kinds.set(name, {name, one: !!f.one, says: String(f.says || ''), aliases: new Set([name, ...(Array.isArray(f.aliases) ? f.aliases : []).map(fieldSlug).filter(Boolean)])});
  }
  for (const f of Array.isArray(own) ? own : []) {
    const name = fieldSlug(f?.name);
    if (!name) continue;
    const aliases = new Set([name, ...(Array.isArray(f.aliases) ? f.aliases : []).map(fieldSlug).filter(Boolean)]);
    let one = typeof f.one === 'boolean' ? f.one : undefined, says = String(f.says || '');
    for (const [other, kind] of [...kinds]) {
      if (other !== name && !aliases.has(other)) continue;
      for (const a of kind.aliases) aliases.add(a);
      if (one === undefined) one = kind.one;
      if (!says) says = kind.says;
      kinds.delete(other);
    }
    for (const kind of kinds.values()) for (const a of aliases) kind.aliases.delete(a);
    kinds.set(name, {name, one: !!one, says, aliases});
  }
  return [...kinds.values()].map(k => ({name: k.name, one: k.one, says: k.says, aliases: [...k.aliases].filter(a => a !== k.name)}));
}

// What every writer and reader asks of the list.
export function fieldsOf(list) {
  const byAlias = new Map(), kinds = new Map();
  for (const k of list) { kinds.set(k.name, k); byAlias.set(k.name, k.name); for (const a of k.aliases) byAlias.set(a, k.name); }
  // The words of each kind's names, and the kinds each word belongs to: a word
  // of three kinds or more ("current", "home") names none of them.
  const wordKinds = new Map();
  for (const [alias, name] of byAlias) for (const w of alias.split(/[^a-z0-9äöüß]+/).filter(w => w.length >= 3)) wordKinds.set(w, new Set([...(wordKinds.get(w) || []), name]));
  const fields = {
    kinds: [...kinds.values()],
    // The fixed name of a listed kind; any other attribute as its slug.
    canonical: a => byAlias.get(fieldSlug(a)) || fieldSlug(a),
    listed: a => byAlias.has(fieldSlug(a)),
    // true or false for a listed kind, undefined for one the list does not name.
    one: a => kinds.get(byAlias.get(fieldSlug(a)))?.one,
    // The kinds as a model is told them, one line each.
    promptLines: () => [...kinds.values()].sort((x, y) => x.name.localeCompare(y.name)).map(k => k.name + (k.one ? ' (one at a time)' : '') + (k.says ? ': ' + k.says : '')),
    // The kinds a question names by one of their names: "where do I live" is
    // lives-in, "when is her birthday" date-of-birth. A word is the start of
    // one of a kind's words or, failing that, that word with an ending
    // ("birthdays"), so "birthday" is not also "birth" of place-of-birth.
    asked: text => {
      const words = [...String(text || '').normalize('NFC').toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map(m => m[0]).filter(w => w.length >= 3 && !STOPWORDS.has(w));
      const found = new Set(), kindsWhere = test => new Set([...wordKinds].filter(([w]) => test(w)).flatMap(([, names]) => [...names]));
      for (const word of words) {
        let hit = kindsWhere(w => w.startsWith(word));
        if (!hit.size) hit = kindsWhere(w => w.length >= 4 && word.startsWith(w) && word.length - w.length <= 3);
        if (hit.size && hit.size < 3) for (const n of hit) found.add(n);
      }
      return [...found];
    },
  };
  return fields;
}

// The list for a workspace, read again only when its world/fields.json changed.
// Without a workspace, the shipped list alone.
const cache = new Map();
let shippedOnly = null;
export function fieldList(root) {
  if (!root) return shippedOnly ||= fieldsOf(mergeFields(DEFAULT_FIELDS, []));
  const file = path.join(root, 'world', 'fields.json');
  let stat = null; try { stat = fs.statSync(file); } catch {}
  const sig = stat ? stat.mtimeMs + ':' + stat.size : 'none', held = cache.get(file);
  if (held?.sig === sig) return held.fields;
  let own = []; if (stat) try { own = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).fields || []; } catch {}
  const fields = fieldsOf(mergeFields(DEFAULT_FIELDS, own));
  cache.set(file, {sig, fields});
  return fields;
}
