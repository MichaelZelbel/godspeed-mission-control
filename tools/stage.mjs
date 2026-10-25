#!/usr/bin/env node
// The stage reader for Node. A stage file (stage.json at the root of this repository) says
// everything one published version is made of: the product commit, the kit-bootstrap commits,
// the server image of each edition, the Windows setup, the add-on pins, the stage it replaced
// and the versions that were taken back. This reader checks a stage file against
// stage.schema.json - the published schema itself, not a copy of its rules - and answers one
// question at a time, so an installer never parses JSON by hand.
//
// tools/stage.sh answers the same questions with the same words and the same exit codes, for
// installers that run before Node is installed. Keep the two in step; tools/test-stage-agree.sh
// proves they are.
//
//   node tools/stage.mjs <stage file> check          read it and check it; print nothing
//   node tools/stage.mjs <stage file> fields         every field it can read, one a line
//   node tools/stage.mjs <stage file> get <field>    print one field, for example productCommit,
//                                                    serverEditions.server.image, addons.mc-video
//   node tools/stage.mjs <stage file> json           the whole checked file as JSON
//   node tools/stage.mjs withdrawn <installed stage> <public stage> [version]
//                                                    yes when either file lists the version
//
// Exit: 0 answered, 1 the file is refused (one plain sentence on stderr), 2 the file is sound
// but holds no such field (and for a command line this reader does not understand). An
// installer goes on only when the withdrawn answer is exactly "no", so every failure fails closed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = [
  "usage: node tools/stage.mjs <stage file> check|fields|json",
  "       node tools/stage.mjs <stage file> get <field>",
  "       node tools/stage.mjs withdrawn <installed stage> <public stage> [version]",
].join("\n");

function refuse(sentence) {
  process.stderr.write(sentence + "\n");
  process.exit(1);
}
function noSuchField(sentence) {
  process.stderr.write(sentence + "\n");
  process.exit(2);
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * A field is a field only where the object really holds it. Every object JSON.parse builds also
 * carries the names JavaScript gives to all of them - toString, constructor, hasOwnProperty,
 * __proto__ and the rest - and a bare lookup finds those too, so it answers out of JavaScript
 * instead of out of the file: a stage file whose root field is named toString would be waved
 * through, and a reader asked for toString would print a built-in function. tools/stage.sh has no
 * such names to find and rightly refuses both. So every name this reader asks a stage file or
 * stage.schema.json about goes through these two, and nothing reads a name off a parsed object
 * any other way.
 */
const own = (o, k) => isObject(o) && Object.hasOwn(o, k);
const ownValue = (o, k) => (own(o, k) ? o[k] : undefined);

/**
 * A refusal is one plain sentence on one line, so whatever a stage file holds has to fit on one.
 * JSON lets a string hold a newline, a tab or any other control character as an escape, so a
 * sound JSON file can carry a value that would break the sentence that refuses it into two lines.
 * Such a value goes into the sentence the way the file writes it, quoted and escaped; anything a
 * line can hold goes in bare, so an ordinary refusal reads as plainly as it did before.
 */
function oneLine(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return JSON.stringify(s);
  }
  return s;
}

/** The value as a message says it: a string bare, anything else as JSON, always on one line. */
function render(v) {
  return typeof v === "string" ? oneLine(v) : JSON.stringify(v);
}

/** The plain name of what a schema node describes; {} becomes the edition or add-on it is about. */
function nameOf(schema, path, key) {
  const title = ownValue(schema, "title");
  const plain = typeof title === "string" ? title : oneLine(path);
  return plain.replace("{}", key === undefined ? "" : oneLine(key));
}

function typeOk(value, type) {
  const one = (t) => {
    switch (t) {
      case "object": return isObject(value);
      case "array": return Array.isArray(value);
      case "string": return typeof value === "string";
      case "integer": return Number.isInteger(value);
      case "number": return typeof value === "number";
      case "boolean": return typeof value === "boolean";
      case "null": return value === null;
      default: return true;
    }
  };
  return Array.isArray(type) ? type.some(one) : one(type);
}

/** True when a leaf value is what its schema says, used for the items of a list. */
function leafOk(value, schema) {
  const type = ownValue(schema, "type");
  const pattern = ownValue(schema, "pattern");
  const minLength = ownValue(schema, "minLength");
  if (type !== undefined && !typeOk(value, type)) return false;
  if (pattern !== undefined && typeof value === "string" && !new RegExp(pattern).test(value)) return false;
  if (minLength !== undefined && typeof value === "string" && value.length < minLength) return false;
  if (own(schema, "const") && value !== ownValue(schema, "const")) return false;
  return true;
}

/**
 * Checks one value against one node of the schema, and refuses with one plain sentence at the
 * first thing that is wrong. The order is the one tools/stage.sh keeps too: the type, then the
 * one value the schema fixes, then every field that is there in the order the schema names them,
 * then the fields that are missing, then the fields a stage file does not name.
 */
function checkAgainst(value, schema, file, path, key) {
  const name = nameOf(schema, path, key);
  const type = ownValue(schema, "type");
  const says = ownValue(schema, "description");
  const pattern = ownValue(schema, "pattern");
  const minLength = ownValue(schema, "minLength");
  const items = ownValue(schema, "items");

  if (type !== undefined && !typeOk(value, type)) {
    refuse(`the ${name} in ${file} is not ${says}: ${render(value)}.`);
  }
  if (own(schema, "const") && value !== ownValue(schema, "const")) {
    refuse(`${file} says ${name} ${render(value)}, which this reader does not understand.`);
  }
  if (typeof value === "string") {
    if (pattern !== undefined && !new RegExp(pattern).test(value)) {
      refuse(`the ${name} in ${file} is not ${says}: ${render(value)}.`);
    }
    if (minLength !== undefined && value.length < minLength) {
      refuse(`the ${name} in ${file} is not ${says}: ${render(value)}.`);
    }
  }
  if (Array.isArray(value) && isObject(items)) {
    for (const item of value) {
      if (!leafOk(item, items)) {
        refuse(`the ${name} in ${file} holds ${render(item)}, which is not ${ownValue(items, "description")}.`);
      }
    }
  }
  if (!isObject(value)) return;

  const named = ownValue(schema, "properties");
  const properties = isObject(named) ? named : {};
  const byPattern = ownValue(schema, "patternProperties");
  const patterns = isObject(byPattern) ? Object.entries(byPattern) : [];
  const required = ownValue(schema, "required");
  const closed = ownValue(schema, "additionalProperties") === false;
  const minProperties = ownValue(schema, "minProperties");

  for (const [child, childSchema] of Object.entries(properties)) {
    if (own(value, child)) checkAgainst(ownValue(value, child), childSchema, file, path ? `${path}.${child}` : child, key);
  }
  for (const want of Array.isArray(required) ? required : []) {
    if (!own(value, want)) {
      refuse(`${file} names no ${nameOf(ownValue(properties, want) ?? {}, want, key)}.`);
    }
  }
  for (const child of Object.keys(value)) {
    if (own(properties, child)) continue;
    const childPath = path ? `${path}.${child}` : child;
    const match = patterns.find(([shape]) => new RegExp(shape).test(child));
    if (match) checkAgainst(ownValue(value, child), match[1], file, childPath, child);
    else if (closed) {
      refuse(`${file} holds ${oneLine(childPath)}, which a stage file does not name.`);
    }
  }
  if (minProperties !== undefined && Object.keys(value).length < minProperties) {
    refuse(`${file} names no ${name}.`);
  }
}

/**
 * The field a file names twice, as a dotted path, or null when it names each of them once.
 * JSON.parse keeps the last of two fields with one name and tools/stage.sh keeps the first, so a
 * file like that reads differently in the two readers: both refuse it rather than answer from it.
 * The text came through JSON.parse already, so this walk only has to find the strings that are
 * field names, and in JSON a string a colon follows is a field's name and nothing else is.
 */
function namedTwice(text) {
  const open = [];
  const inner = () => open[open.length - 1];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      const parent = inner();
      let path = "";
      if (parent) path = parent.list ? `${parent.path}#${++parent.items}` : parent.field;
      open.push({ list: ch === "[", path, field: path, items: 0, named: new Set() });
      i++;
    } else if (ch === "}" || ch === "]") {
      open.pop();
      i++;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      let after = j + 1;
      while (after < text.length && " \t\r\n".includes(text[after])) after++;
      const here = inner();
      if (text[after] === ":" && here !== undefined && !here.list) {
        const name = JSON.parse(text.slice(i, j + 1));
        const path = here.path ? `${here.path}.${name}` : name;
        if (here.named.has(name)) return path;
        here.named.add(name);
        here.field = path;
        i = after + 1;
      } else {
        i = j + 1;
      }
    } else {
      i++;
    }
  }
  return null;
}

function loadSchema() {
  for (const candidate of [join(HERE, "..", "stage.schema.json"), join(HERE, "stage.schema.json")]) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  process.stderr.write("stage.schema.json is not beside stage.json or in tools/, so nothing can be checked.\n");
  process.exit(1);
}

/** Reads a stage file, checks it, and gives back what it holds. Refuses, it never guesses. */
function readStage(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    refuse(e.code === "ENOENT" ? `${file} cannot be read: there is no such file.` : `${file} cannot be read: ${e.message}.`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    refuse(`${file} is not JSON.`);
  }
  const twice = namedTwice(text);
  if (twice !== null) {
    refuse(`${file} names ${oneLine(twice)} twice; a stage file names each field once.`);
  }
  checkAgainst(value, loadSchema(), file, "", undefined);
  return value;
}

/** Every field a reader can print: a plain value, or a list as a whole. In the file's own order. */
function fieldsOf(value, path = "", into = []) {
  for (const [key, child] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (isObject(child)) fieldsOf(child, here, into);
    else into.push(here);
  }
  return into;
}

function valueAt(value, path) {
  let here = value;
  for (const step of path.split(".")) {
    if (!own(here, step)) return undefined;
    here = ownValue(here, step);
  }
  return here;
}

function versionOf(stage) {
  return ownValue(stage, "version");
}

function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    process.stdout.write(USAGE + "\n");
    return 0;
  }

  if (argv[0] === "withdrawn") {
    if (argv.length < 3 || argv.length > 4) {
      process.stderr.write(USAGE + "\n");
      return 2;
    }
    const installed = readStage(argv[1]);
    const asked = argv[3] !== undefined && argv[3] !== "" ? argv[3] : versionOf(installed);
    const versionRule = ownValue(ownValue(loadSchema(), "properties"), "version") ?? {};
    if (!leafOk(asked, versionRule)) {
      refuse(`${oneLine(asked)} is not ${ownValue(versionRule, "description")}.`);
    }
    const published = readStage(argv[2]);
    const takenBack = [...(ownValue(installed, "withdrawn") ?? []), ...(ownValue(published, "withdrawn") ?? [])];
    const listed = takenBack.includes(asked);
    process.stdout.write((listed ? "yes" : "no") + "\n");
    return 0;
  }

  if (argv.length < 2) {
    process.stderr.write(USAGE + "\n");
    return 2;
  }
  const file = argv[0];
  const command = argv[1];
  const stage = readStage(file);

  switch (command) {
    case "check":
      return 0;
    case "fields":
      for (const field of fieldsOf(stage)) process.stdout.write(field + "\n");
      return 0;
    case "json":
      process.stdout.write(JSON.stringify(stage, null, 2) + "\n");
      return 0;
    case "get": {
      if (argv.length !== 3) {
        process.stderr.write(USAGE + "\n");
        return 2;
      }
      const path = argv[2];
      const found = valueAt(stage, path);
      const missing = `${file} has no readable field ${path}; the fields command lists the ones it has.`;
      if (found === undefined || isObject(found)) noSuchField(missing);
      if (Array.isArray(found)) {
        for (const item of found) process.stdout.write(item + "\n");
        return 0;
      }
      process.stdout.write(String(found) + "\n");
      return 0;
    }
    default:
      process.stderr.write(USAGE + "\n");
      return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
