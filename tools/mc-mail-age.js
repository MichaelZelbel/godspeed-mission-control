/*
 * mc-mail-age.js - fetch age, the small program that locks mail keys away, when this computer
 * has none. A module of mc-mail, not a command.
 *
 * WHY (8 October 2026). Every mail key mc-mail keeps is locked with age. The installers fetched
 * age only for the old notebook connection (Menerio), so on a computer install the first
 * `mc-mail connect agentmail`, the step Chapter 31 of the book teaches, stopped with "the small
 * program called age is not on this computer. Ask your assistant to install age". Almost every
 * reader would have met that. Now mc-mail fetches it the way it fetches Himalaya for Gmail
 * (mc-mail-imap.js): one release, one archive per kind of computer, refused unless its SHA-256
 * matches mc-mail-age.json, kept in ~/.godspeed/mail/age and never upgraded by itself.
 *
 * An age the person installed is used first (mc-mail-gmail.js findAge); this copy is only the
 * fallback, so nothing changes for a computer that already had one.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const MANIFEST = require("./mc-mail-age.json");
const EXE = process.platform === "win32" ? ".exe" : "";
const PROGRAMS = ["age", "age-keygen"];

const home = () => process.env.GODSPEED_MAIL_HOME || os.homedir();
const dir = () => path.join(home(), ".godspeed", "mail", "age");
const platformKey = () => process.platform + "-" + process.arch;
const asset = () => MANIFEST.assets[platformKey()] || null;

// The fetched copy of one program, or "" when there is none (or it is not the pinned one).
function local(name) {
  const p = path.join(dir(), name + EXE);
  if (!fs.existsSync(p)) return "";
  try {
    const done = JSON.parse(fs.readFileSync(path.join(dir(), "installed.json"), "utf8"));
    return done.version === MANIFEST.version ? p : "";
  } catch (e) { return ""; }
}

// A .tar.gz is gzip around tar, and tar is 512-byte headers: the same few lines as
// mc-mail-imap.js, for several files at once.
function untar(tgz, wanted) {
  const buf = zlib.gunzipSync(tgz), out = {};
  let off = 0, longName = "";
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    let name = str(0, 100);
    const prefix = str(345, 500);
    if (prefix) name = prefix + "/" + name;
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = data.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (longName) { name = longName; longName = ""; }
    name = name.replace(/^\.\//, "");
    if ((type === "0" || type === "\0") && wanted.includes(name)) out[name] = Buffer.from(data);
  }
  return out;
}

// A .zip, read from its central directory. Only "stored" and "deflated" entries, which is all
// the age release uses; the archive's SHA-256 was checked before this runs.
function unzip(zip, wanted) {
  const out = {};
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("the archive is not a zip file");
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("the zip file's table of contents is damaged");
    const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28), extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42), name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.includes(name)) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("the zip file is damaged at " + name);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + csize);
    if (method === 0) out[name] = Buffer.from(data);
    else if (method === 8) out[name] = zlib.inflateRawSync(data);
    else throw new Error("the zip file packs " + name + " in a way this program does not read");
  }
  return out;
}

// Makes sure this computer has the pinned age, fetching it once. Returns the folder it is in.
// `say` gets the one line a person sees while it downloads.
async function ensure(say = () => {}) {
  if (PROGRAMS.every(n => local(n))) return dir();
  const a = asset();
  if (!a) {
    throw Object.assign(new Error(`the small program called age, which locks your key away, is not on this computer, and there is no copy of it for this kind of computer (${platformKey()}). Install age from https://github.com/FiloSottile/age and run the same command again. Nothing was changed.`), { kind: "unsupported" });
  }
  let archive;
  if (process.env.GODSPEED_MAIL_AGE_ARCHIVE) archive = fs.readFileSync(process.env.GODSPEED_MAIL_AGE_ARCHIVE);
  else {
    say(`Fetching the small program that locks your key away (age ${MANIFEST.version}) from its official release page. This happens once.`);
    let res;
    try { res = await fetch(MANIFEST.download + a.asset, { signal: AbortSignal.timeout(120000) }); }
    catch (e) { throw Object.assign(new Error("the small program called age, which locks your key away, could not be downloaded (" + (e.cause && e.cause.code || e.message) + "). Check this computer is online and run the same command again. Nothing was changed."), { kind: "network" }); }
    if (!res.ok) throw Object.assign(new Error("the small program called age, which locks your key away, could not be downloaded (GitHub answered " + res.status + "). Run the same command again later. Nothing was changed."), { kind: "network" });
    archive = Buffer.from(await res.arrayBuffer());
  }
  const sum = crypto.createHash("sha256").update(archive).digest("hex");
  if (sum !== a.sha256) throw Object.assign(new Error(`the downloaded copy of age is not the pinned one (SHA-256 ${sum.slice(0, 16)}..., expected ${a.sha256.slice(0, 16)}...). Nothing was installed and nothing was changed.`), { kind: "integrity" });
  const names = PROGRAMS.map(n => "age/" + n + EXE).concat("age/LICENSE");
  const files = a.asset.endsWith(".zip") ? unzip(archive, names) : untar(archive, names);
  for (const n of PROGRAMS) if (!files["age/" + n + EXE]) throw new Error("the age release archive does not contain " + n + ". Nothing was installed.");
  const d = dir();
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const placed = [];
  for (const n of PROGRAMS) {
    const target = path.join(d, n + EXE), tmp = target + ".new";
    fs.writeFileSync(tmp, files["age/" + n + EXE], { mode: 0o755 });
    placed.push([tmp, target]);
  }
  // It has to start here before it is kept: a copy that cannot run would only move the
  // failure to the moment a key is locked.
  const v = spawnSync(placed[0][0], ["--version"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  if (v.status !== 0 || !(v.stdout || "").includes(MANIFEST.version)) {
    for (const [tmp] of placed) { try { fs.unlinkSync(tmp); } catch (e) { /* */ } }
    throw new Error("the small program called age did not start on this computer (" + ((v.stderr || v.error && v.error.message || "").trim().split(/\r?\n/)[0] || "no answer") + "). Nothing was installed.");
  }
  for (const [tmp, target] of placed) fs.renameSync(tmp, target);
  if (files["age/LICENSE"]) fs.writeFileSync(path.join(d, "LICENSE"), files["age/LICENSE"]);
  fs.writeFileSync(path.join(d, "installed.json"), JSON.stringify({ version: MANIFEST.version, asset: a.asset, sha256: a.sha256, at: new Date().toISOString() }, null, 1));
  return d;
}

module.exports = { ensure, local, dir, untar, unzip, MANIFEST };
