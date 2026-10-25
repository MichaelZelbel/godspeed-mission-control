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

/** The value as a message says it: a string bare, anything else as JSON. */
function render(v) {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** The plain name of what a schema node describes; {} becomes the edition or add-on it is about. */
function nameOf(schema, path, key) {
  const title = typeof schema.title === "string" ? schema.title : path;
  return title.replace("{}", key === undefined ? "" : key);
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
  if (schema.type !== undefined && !typeOk(value, schema.type)) return false;
  if (schema.pattern !== undefined && typeof value === "string" && !new RegExp(schema.pattern).test(value)) return false;
  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength) return false;
  if ("const" in schema && value !== schema.const) return false;
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

  if (schema.type !== undefined && !typeOk(value, schema.type)) {
    refuse(`the ${name} in ${file} is not ${schema.description}: ${render(value)}.`);
  }
  if ("const" in schema && value !== schema.const) {
    refuse(`${file} says ${name} ${render(value)}, which this reader does not understand.`);
  }
  if (typeof value === "string") {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      refuse(`the ${name} in ${file} is not ${schema.description}: ${render(value)}.`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      refuse(`the ${name} in ${file} is not ${schema.description}: ${render(value)}.`);
    }
  }
  if (Array.isArray(value) && isObject(schema.items)) {
    for (const item of value) {
      if (!leafOk(item, schema.items)) {
        refuse(`the ${name} in ${file} holds ${render(item)}, which is not ${schema.items.description}.`);
      }
    }
  }
  if (!isObject(value)) return;

  const properties = isObject(schema.properties) ? schema.properties : {};
  const patterns = isObject(schema.patternProperties) ? Object.entries(schema.patternProperties) : [];

  for (const [child, childSchema] of Object.entries(properties)) {
    if (child in value) checkAgainst(value[child], childSchema, file, path ? `${path}.${child}` : child, key);
  }
  for (const want of Array.isArray(schema.required) ? schema.required : []) {
    if (!(want in value)) {
      refuse(`${file} names no ${nameOf(properties[want] ?? {}, want, key)}.`);
    }
  }
  for (const child of Object.keys(value)) {
    if (child in properties) continue;
    const childPath = path ? `${path}.${child}` : child;
    const match = patterns.find(([pattern]) => new RegExp(pattern).test(child));
    if (match) checkAgainst(value[child], match[1], file, childPath, child);
    else if (schema.additionalProperties === false) {
      refuse(`${file} holds ${childPath}, which a stage file does not name.`);
    }
  }
  if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
    refuse(`${file} names no ${name}.`);
  }
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
    if (!isObject(here) || !(step in here)) return undefined;
    here = here[step];
  }
  return here;
}

function versionOf(stage) {
  return stage.version;
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
    const versionRule = loadSchema().properties.version;
    if (!leafOk(asked, versionRule)) {
      refuse(`${asked} is not ${versionRule.description}.`);
    }
    const published = readStage(argv[2]);
    const listed = [...installed.withdrawn, ...published.withdrawn].includes(asked);
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
