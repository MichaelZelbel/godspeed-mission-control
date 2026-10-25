#!/usr/bin/env node
// The gate for stage/stage.mjs, the stage reader for Node. It reads the real stage.json, every
// field of it, the whole file as checked JSON, and the withdrawn answer in all four pairs; then
// it holds the reader to the malformed files in stage/stage-cases/, which stage/test-stage-sh.sh
// holds the shell reader to as well, so the two cannot drift apart.
// Run: node stage/test-stage.mjs   (from the root of a checkout of this kit)
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
require("../tools/test-guard.cjs"); // never a real mission control (test-guard.bash says why)

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const READER = join(HERE, "stage.mjs");
const CASES = join(HERE, "stage-cases");
const STAGE = join(ROOT, "stage.json");

let pass = 0;
let fail = 0;
const ok = (name) => { pass++; console.log("  ok   " + name); };
const bad = (name, why) => { fail++; console.log(`  FAIL ${name}${why ? " (" + why + ")" : ""}`); };
const same = (name, got, want) => (got === want ? ok(name) : bad(name, `wanted [${want}], got [${got}]`));
const holds = (name, text, words) => (String(text).includes(words) ? ok(name) : bad(name, `[${text}] does not hold [${words}]`));

function reader(...args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [READER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), err: "" };
  } catch (e) {
    return { code: e.status, out: String(e.stdout ?? ""), err: String(e.stderr ?? "") };
  }
}

const work = mkdtempSync(join(tmpdir(), "godspeed-stage-"));
process.on("exit", () => { try { rmSync(work, { recursive: true, force: true }); } catch {} });

console.log("the stage reader for Node");

// ------------------------------------------------------------------- the real stage.json
const checked = reader(STAGE, "check");
same("the real stage.json is read and checked", checked.code, 0);
same("  and check prints nothing", checked.out + checked.err, "");

const fields = reader(STAGE, "fields");
same("fields leaves 0", fields.code, 0);
const list = fields.out.split("\n").filter(Boolean);
if (list.length >= 12) ok(`fields names ${list.length} fields`);
else bad("fields names at least twelve fields", `only ${list.length}`);
for (const want of ["version", "productCommit", "kitBootstrap.unixEngineCommit", "kitBootstrap.windowsBootstrapCommit", "serverEditions.server.image", "windowsSetup.file", "windowsSetup.releaseTag", "windowsSetup.sha256", "addons.mc-video", "previous", "withdrawn", "stageFormat"]) {
  if (list.includes(want)) ok(`  fields names ${want}`);
  else bad(`fields names ${want}`, "it does not");
}

const stage = JSON.parse(readFileSync(STAGE, "utf8"));
const at = (path) => path.split(".").reduce((o, k) => (o === undefined ? o : o[k]), stage);
for (const path of list) {
  const got = reader(STAGE, "get", path);
  const want = at(path);
  const wanted = Array.isArray(want) ? want.map((v) => v + "\n").join("") : String(want) + "\n";
  if (got.code === 0 && got.out === wanted) ok(`  get ${path} prints ${JSON.stringify(got.out.replace(/\n$/, ""))}`);
  else bad(`get ${path}`, `exit ${got.code}, wanted [${wanted.trim()}], got [${got.out.trim()}]`);
}

const asJson = reader(STAGE, "json");
same("json leaves 0", asJson.code, 0);
same("  and prints the file it checked, byte for byte", asJson.out, readFileSync(STAGE, "utf8"));

// A sound file that holds no such field is not a refused file: it is exit 2.
for (const path of ["thereIsNoSuchField", "kitBootstrap", "addons.not-an-addon", "serverEditions.server"]) {
  const got = reader(STAGE, "get", path);
  same(`get ${path} leaves 2, not the refusal 1`, got.code, 2);
  holds(`  and says so in one sentence`, got.err, "has no readable field");
  same("  and prints nothing", got.out, "");
}

// ------------------------------------------------------------------ every malformed file
console.log("  the malformed files of stage/stage-cases/");
const expected = readFileSync(join(CASES, "expected.txt"), "utf8")
  .split("\n")
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("|"));
if (expected.length >= 8) ok(`  ${expected.length} malformed cases are listed`);
else bad("at least eight malformed cases are listed", `only ${expected.length}`);
for (const [file, words] of expected) {
  const got = reader(join(CASES, file), "check");
  same(`  ${file} is refused with exit 1`, got.code, 1);
  same(`    and prints nothing on stdout`, got.out, "");
  const lines = got.err.split("\n").filter(Boolean);
  same(`    and one sentence on stderr`, lines.length, 1);
  holds(`    saying what is wrong`, got.err, words);
}

// --------------------------------------- no name JavaScript gives every object is a field
// A stage file's fields are the ones it names itself. The names every JavaScript object carries -
// toString, constructor, __proto__ and the rest - are not among them, and this reader builds its
// objects with JSON.parse, which hands it every one of those names for free: a lookup that does
// not ask for an own field would wave such a field through and would print a built-in function
// when asked for it. stage/stage-cases/inherited-names.txt is the one list this test,
// stage/test-stage-sh.sh and stage/test-stage-agree.sh all sweep.
console.log("  no name JavaScript gives every object is a field");
const inherited = readFileSync(join(CASES, "inherited-names.txt"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
if (inherited.length >= 12) ok(`  ${inherited.length} inherited names are swept`);
else bad("at least twelve inherited names are swept", `only ${inherited.length}`);
const ends = (name, text, words) =>
  (String(text).replace(/\n+$/, "").endsWith(words) ? ok(name) : bad(name, `[${text}] does not end in [${words}]`));
const written = JSON.parse(readFileSync(join(ROOT, "stage.schema.json"), "utf8")).neverNamedFields;
same("  stage.schema.json writes the list down, so the reader reads it rather than invents it",
  (written && Array.isArray(written.names) ? written.names : []).join(" "), inherited.join(" "));

// Every value put in below is one no rule can object to - the pin of a real add-on, the image of
// the real edition - so each refusal is about the name and nothing else. It has to be: addons and
// serverEditions name their children by a pattern, and a lowercase inherited name is a name that
// pattern matches, so a wrong value would refuse the file for the wrong reason and prove nothing.
const COMMIT = "fecb22dd6f0376ebec810fa733a50eb880484f2e";
const DIGEST = stage.serverEditions.server.image;
const stageText = readFileSync(STAGE, "utf8");
const copy = join(work, "inherited.json");
const places = (name) => [
  [name, stageText.replace("{\n", `{\n  "${name}": "${COMMIT}",\n`)],
  [`kitBootstrap.${name}`, stageText.replace('"kitBootstrap": {\n', `"kitBootstrap": {\n    "${name}": "${COMMIT}",\n`)],
  [`windowsSetup.${name}`, stageText.replace('"windowsSetup": {\n', `"windowsSetup": {\n    "${name}": "${COMMIT}",\n`)],
  [`addons.${name}`, stageText.replace('"addons": {\n', `"addons": {\n    "${name}": "${COMMIT}",\n`)],
  [`serverEditions.${name}`, stageText.replace('"serverEditions": {\n', `"serverEditions": {\n    "${name}": {\n      "image": "${DIGEST}"\n    },\n`)],
  [`serverEditions.server.${name}`, stageText.replace('"server": {\n', `"server": {\n      "${name}": "${DIGEST}",\n`)],
];
for (const name of inherited) {
  for (const [where, text] of places(name)) {
    writeFileSync(copy, text);
    const got = reader(copy, "check");
    same(`  a stage file holding ${where} is refused with exit 1`, got.code, 1);
    same("    and prints nothing on stdout", got.out, "");
    same("    and one sentence on stderr", got.err.split("\n").filter(Boolean).length, 1);
    ends("    saying a stage file does not name it", got.err, `holds ${where}, which a stage file does not name.`);
  }
  for (const path of [name, `kitBootstrap.${name}`, `windowsSetup.${name}`, `addons.${name}`,
                      `serverEditions.${name}`, `serverEditions.server.${name}`]) {
    const got = reader(STAGE, "get", path);
    same(`  get ${path} leaves 2, so nothing is answered out of JavaScript`, got.code, 2);
    same("    and prints nothing", got.out, "");
    holds("    and says it has no such field", got.err, "has no readable field");
  }
}

// A refusal is one sentence on one line, and it names the value that is wrong - so a value that
// holds a newline of its own has to be named the way the file writes it, escaped, or the sentence
// arrives as two lines and a caller reading one line of it reads half a sentence. JSON lets a
// string hold any control character as an escape, so a file can be sound JSON and hold one. The
// version in bad-control-character.json opens with a sound version, so a reader that stopped at
// the newline would take the file.
console.log("  a value, a field name and a version asked for that hold a newline");
const twoLines = '"2.0.0-beta.6\\nand a second line"';
const controlChar = reader(join(CASES, "bad-control-character.json"), "check");
same("  a value holding a newline is refused", controlChar.code, 1);
same("    on one line", controlChar.err.split("\n").filter(Boolean).length, 1);
holds("    naming the value the way the file writes it", controlChar.err, twoLines);
same("    and prints nothing on stdout", controlChar.out, "");

// The same for a field's name, which reaches a sentence by another road than a field's value.
const oddName = join(work, "odd-field-name.json");
const renamed = JSON.parse(readFileSync(STAGE, "utf8"));
renamed.serverEditions = { "ser\nver": renamed.serverEditions.server };
writeFileSync(oddName, JSON.stringify(renamed, null, 2) + "\n");
const oddRun = reader(oddName, "check");
same("  a field named with a newline in it is refused", oddRun.code, 1);
same("    on one line", oddRun.err.split("\n").filter(Boolean).length, 1);
holds("    naming the field the way the file writes it", oddRun.err, '"serverEditions.ser\\nver"');

// ------------------------------------------------------------------ the withdrawn answer
console.log("  the withdrawn answer");
const clean = join(CASES, "ok-clean.json");
const listed = join(CASES, "ok-withdrawn.json");
for (const [installed, published, want] of [[clean, clean, "no"], [clean, listed, "yes"], [listed, clean, "yes"], [listed, listed, "yes"]]) {
  const got = reader("withdrawn", installed, published);
  same(`  installed ${installed.endsWith("ok-clean.json") ? "clean" : "lists it"}, public ${published.endsWith("ok-clean.json") ? "clean" : "lists it"}`, got.out, want + "\n");
  same("    and leaves 0", got.code, 0);
}
same("  a version nobody withdrew is not withdrawn", reader("withdrawn", listed, listed, "2.0.0-beta.5").out, "no\n");
same("  a version the public stage lists is withdrawn", reader("withdrawn", clean, listed, "2.0.0-beta.6").out, "yes\n");
const notAVersion = reader("withdrawn", clean, clean, "beta six");
same("  a version that is not one is refused", notAVersion.code, 1);
holds("    with a plain sentence", notAVersion.err, "is not a version like 2.0.0-beta.6");
const askedTwoLines = reader("withdrawn", clean, clean, "2.0.0-beta.6\nand a second line");
same("  a version asked for that holds a newline is refused", askedTwoLines.code, 1);
same("    on one line", askedTwoLines.err.split("\n").filter(Boolean).length, 1);
holds("    naming it the way it was handed over", askedTwoLines.err, twoLines);
const refusedPair = reader("withdrawn", join(CASES, "bad-pattern.json"), clean);
same("  a malformed installed stage is refused, so the answer fails closed", refusedPair.code, 1);
same("    and no answer is printed", refusedPair.out, "");

// JSON.parse keeps the last of two fields with one name and stage/stage.sh keeps the first, so a
// file that names withdrawn twice would read differently in the two readers. Neither answers from
// it: the withdrawn question fails closed, whichever of the two stages holds the duplicate.
const duplicate = join(CASES, "bad-duplicate-field.json");
for (const [installed, published, which] of [[duplicate, clean, "installed"], [clean, duplicate, "public"]]) {
  const got = reader("withdrawn", installed, published, "2.0.0-beta.6");
  same(`  a ${which} stage that names a field twice is refused`, got.code, 1);
  same("    and no answer is printed", got.out, "");
  holds("    with a plain sentence", got.err, "names withdrawn twice; a stage file names each field once.");
}
const duplicateFields = reader(duplicate, "get", "withdrawn");
same("  and no field of it can be read either", duplicateFields.code, 1);
same("    with nothing on stdout", duplicateFields.out, "");

// ------------------------------------------------------------- a later stage, with a previous
const later = join(CASES, "ok-later-stage.json");
same("a stage that replaced another is read", reader(later, "check").code, 0);
same("  and names its previous version", reader(later, "get", "previous.version").out, "2.0.0-beta.6\n");
same("  and the commit of the stage file it came from", reader(later, "get", "previous.stageCommit").out, "9390da492a0035a41b0eb02584234e269bca6dc8\n");

// ----------------------------------------------------------- a candidate's own release tag
// The freeze publishes a candidate's Windows setup on the tag candidate/<version>, and writes
// that tag into the stage file. A release tag may therefore hold one slash between two parts.
const candidate = join(CASES, "ok-candidate-tag.json");
same("a candidate's stage file, whose release tag holds one slash, is read", reader(candidate, "check").code, 0);
same("  and its release tag reads back whole", reader(candidate, "get", "windowsSetup.releaseTag").out, "candidate/2.0.0-beta.7\n");

// ------------------------------------------------------------------------- the command line
same("no arguments prints the usage and leaves 0 through --help", reader("--help").code, 0);
same("a command it does not know leaves 2", reader(STAGE, "sing").code, 2);
same("a file that is not there is refused", reader(join(work, "nowhere.json"), "check").code, 1);
holds("  with a plain sentence", reader(join(work, "nowhere.json"), "check").err, "there is no such file");

// --------------------------------------------------------------------- the published schema
const schema = JSON.parse(readFileSync(join(ROOT, "stage.schema.json"), "utf8"));
same("the schema fixes the format number", schema.properties.stageFormat.const, 1);
same("  names the commit pattern", schema.properties.productCommit.pattern, "^[0-9a-f]{40}$");
same("  names the SHA-256 pattern", schema.properties.windowsSetup.properties.sha256.pattern, "^[0-9a-f]{64}$");
holds("  names the digest pattern", Object.values(schema.properties.serverEditions.patternProperties)[0].properties.image.pattern, "@sha256:[0-9a-f]{64}$");
holds("  names the version pattern", schema.properties.version.pattern, "^[0-9]+\\.[0-9]+\\.[0-9]+");

// The release tag rule itself, not only the files that break it: a tag is one part, or two parts
// joined by exactly one slash, because a candidate's setup is published on candidate/<version>.
// A part is never empty, never starts with a dot, and no tag holds two dots in a row, because a
// tag is a Git ref and Git takes none of those.
const tagRule = new RegExp(schema.properties.windowsSetup.properties.releaseTag.pattern);
for (const tag of ["godspeed-v2-integrated-2026-10-24-2", "candidate/2.0.0-beta.7", "v2.0.0", "2.0.0-beta.7"]) {
  if (tagRule.test(tag)) ok(`  a release tag may be ${tag}`);
  else bad(`a release tag may be ${tag}`, "the schema's pattern does not take it");
}
for (const tag of ["candidate//x", "/x", "x/", "a/b/c", "candidate/2..0", "a..b", "candidate/.hidden", ".hidden", ""]) {
  if (!tagRule.test(tag)) ok(`  a release tag is not ${JSON.stringify(tag)}`);
  else bad(`a release tag is not ${JSON.stringify(tag)}`, "the schema's pattern takes it");
}

// The Windows setup's file name is a file name, not a ref: it keeps the rule it had, with no slash.
const fileRule = new RegExp(schema.properties.windowsSetup.properties.file.pattern);
same("  and the Windows setup file name takes no slash", fileRule.test("Godspeed/Setup.exe"), false);
same("    while it still takes GodspeedSetup.exe", fileRule.test("GodspeedSetup.exe"), true);

// The reader reads the published schema, it does not carry a copy: bend the schema and the
// reader must bend with it.
const bentRoot = mkdtempSync(join(tmpdir(), "godspeed-stage-schema-"));
process.on("exit", () => { try { rmSync(bentRoot, { recursive: true, force: true }); } catch {} });
const bent = JSON.parse(readFileSync(join(ROOT, "stage.schema.json"), "utf8"));
bent.properties.stageFormat.const = 7;
writeFileSync(join(bentRoot, "stage.schema.json"), JSON.stringify(bent, null, 2) + "\n");
const bentTools = join(bentRoot, "tools");
require("node:fs").mkdirSync(bentTools);
writeFileSync(join(bentTools, "stage.mjs"), readFileSync(READER, "utf8"));
const bentRun = (() => {
  try {
    return { code: 0, err: "", out: execFileSync(process.execPath, [join(bentTools, "stage.mjs"), STAGE, "check"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout ?? ""), err: String(e.stderr ?? "") };
  }
})();
same("the reader checks the published schema, not a copy of its rules", bentRun.code, 1);
holds("  so a schema that wants format 7 refuses this file", bentRun.err, "which this reader does not understand");

// The names a stage file never gives a field are read out of the schema too: a schema that adds
// the edition's own name to the list must refuse the real stage.json for naming it.
const bentNames = JSON.parse(readFileSync(join(ROOT, "stage.schema.json"), "utf8"));
bentNames.neverNamedFields.names = [...bentNames.neverNamedFields.names, "server"];
writeFileSync(join(bentRoot, "stage.schema.json"), JSON.stringify(bentNames, null, 2) + "\n");
const bentNamesRun = (() => {
  try {
    return { code: 0, err: "", out: execFileSync(process.execPath, [join(bentTools, "stage.mjs"), STAGE, "check"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout ?? ""), err: String(e.stderr ?? "") };
  }
})();
same("  the names a stage file never gives a field are read out of the schema as well", bentNamesRun.code, 1);
holds("    so a schema that adds server to the list refuses the real stage.json", bentNamesRun.err, "holds serverEditions.server, which a stage file does not name.");

console.log(`${pass} of ${pass + fail} pass.`);
process.exitCode = fail ? 1 : 0;
