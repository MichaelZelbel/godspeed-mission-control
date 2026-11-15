#!/usr/bin/env node
// The gate for "no book chapter in what a person is shown" (product issue #81, 27 October 2026).
// Somebody who installed from the website has no book, and the numbers the programs named had
// drifted from the book's own (the deadlines chapter was 27 in the installer and 30 here; Gmail
// was 30 there and 32 in the mail tool). On 20 August 2026 Michael decided the installer names no
// book chapters; they came back with the Gmail change of 22 September.
//
// It reads what the installers and the programs print or write for a person: the installers, the
// programs in tools/, the server's and the Docker image's scripts, and the notebook's server,
// scripts, pages and recipes (the deadlines text among them, which was a README in the old
// reminders folder until 30 October 2026). Comments may name a chapter, and so
// may the files written for the book (the starter mission control's other files, living/,
// procedures/, profile/, skills/, mail/), which a reader opens beside the book. It fails on
// "Chapter <n>" or "Kapitel <n>". Reads files only; first it proves on a throwaway folder that it
// catches such a line and lets a comment through.
//
// THE RECIPES THE ASSISTANT READS (28 October 2026). The email recipe sent people to "Chapter 31"
// and the morning brief's to "Chapter 25", and the assistant repeats what its recipe says. So the
// Markdown of every recipe is read too, every line of it, comments included, because the assistant
// reads all of it: the starter's starter-godspeed/skills/ and the notebook's own copies
// (notebook/recipes, and notebook/reusable-recipes they are made from). A recipe's other files
// (frame presets, scripts, pictures) are templates and programs, not words for the person. Not read:
// a carried add-on's own copy under third-party/addons/ (it changes in its own repository) and the
// book kit's companion files (the root skills/ and the folders named above).
// Usage: node tools/test-no-chapters.js
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const CODE = /\.(js|cjs|mjs|ts|tsx|py|sh|ps1|cmd)$/;
const TEST = /(^|\/)(test|tests|__tests__|fixtures)\/|(^|\/)test[-_][^/]*$|[._-]test\.[a-z]+$|\.spec\.[a-z]+$/;
const COMMENT = /^(\/\/|\/\*|\*|#|<!--|REM\b|::)/;
const CHAPTER = /\b(chapter|kapitel)\s+[0-9]/i;
const RECIPES = ["starter-godspeed/skills", "notebook/recipes", "notebook/reusable-recipes"];

function walk(root, dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = path.posix.join(dir, e.name);
    // __pycache__ holds what Python compiled while the tests ran, never something that ships.
    if (e.isDirectory()) { if (!["node_modules", "dist", ".git", "__pycache__"].includes(e.name)) walk(root, rel, out); }
    else out.push(rel);
  }
  return out;
}

function shownFiles(root) {
  return [
    "install-godspeed.sh", "install-godspeed-dev.sh",
    ...walk(root, "tools").filter(f => !/\.(md|json)$/.test(f)),
    ...walk(root, "server").filter(f => CODE.test(f)),
    ...walk(root, "docker/server").filter(f => CODE.test(f)),
    ...walk(root, "docker/rootfs"),
    ...["notebook/server", "notebook/core", "notebook/scripts", "notebook/ui/src"].flatMap(d => walk(root, d).filter(f => CODE.test(f))),
    ...RECIPES.flatMap(d => walk(root, d).filter(f => f.endsWith(".md"))),
  ].filter(f => !TEST.test(f) && fs.existsSync(path.join(root, f)));
}

function scan(root) {
  const files = shownFiles(root);
  const bad = [];
  for (const f of files) {
    let text = fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
    if (text.includes("\0")) continue;   // a compiled or binary file is nobody's text
    // A Python docstring is not shown to anybody; blank it out, keeping the line numbers.
    if (f.endsWith(".py") || /^#!.*python|^''''/m.test(text.slice(0, 300))) text = text.replace(/("""|''')[\s\S]*?\1/g, m => m.replace(/[^\n]/g, " "));
    text.split("\n").forEach((line, i) => {
      const t = line.trim();
      // In a Markdown file a line starting with # is a heading a person reads, not a comment.
      if ((f.endsWith(".md") || !COMMENT.test(t)) && CHAPTER.test(t)) bad.push(`${f}:${i + 1}: ${t.slice(0, 160)}`);
    });
  }
  return { files, bad };
}

let pass = 0, fail = 0;
const ok = m => { pass++; console.log("  ok   " + m); };
const no = m => { fail++; console.log("  FAIL " + m); };

console.log("no book chapters in what a person is shown");

// The check itself, on a throwaway folder first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "no-chapters-"));
try {
  fs.mkdirSync(path.join(tmp, "tools"));
  fs.mkdirSync(path.join(tmp, "notebook", "core", "routine-scripts"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "tools", "quiet.js"), "// Chapter 30 explains why, in a comment\nconsole.log('done');\n");
  fs.writeFileSync(path.join(tmp, "notebook", "core", "routine-scripts", "doc.py"), 'def f():\n    """As in\n    Chapter 25 of the book."""\n    return 1\n');
  const quiet = scan(tmp);
  quiet.bad.length === 0 && quiet.files.length === 2
    ? ok("a chapter in a comment or a docstring is let through")
    : no("a comment or a docstring was refused: " + quiet.bad.join(" | "));
  fs.writeFileSync(path.join(tmp, "tools", "shown.js"), 'console.log("Siehe Kapitel 12 im Buch.");\n');
  fs.writeFileSync(path.join(tmp, "tools", "test-shown.js"), 'console.log("Chapter 3 of a test is nobody\'s business");\n');
  fs.mkdirSync(path.join(tmp, "tools", "__pycache__"));
  fs.writeFileSync(path.join(tmp, "tools", "__pycache__", "mc-x.cpython-312.pyc"), "\0\0compiled: Chapter 2 of the book\n");
  const loud = scan(tmp);
  loud.bad.length === 1 && loud.bad[0].startsWith("tools/shown.js:1:")
    ? ok("a printed line naming a chapter is caught, in German too, and a test or a compiled file is not read")
    : no("the check missed a printed chapter, or read a test: " + JSON.stringify(loud.bad));
  // A recipe the assistant reads: every line of its Markdown, comments too, in all three places.
  // Its frame presets, a carried add-on's own copy and the book kit's companion files are not read.
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), text); };
  put("starter-godspeed/skills/demo/SKILL.md", "---\nname: demo\n---\n\nOffer forwarding to its own address (Chapter 30).\n");
  put("notebook/recipes/demo/reference/more.md", "<!-- Chapter 30 shows it -->\n");
  put("notebook/reusable-recipes/demo/SKILL.md", "# Kapitel 30\n");
  put("notebook/recipes/frames/showcase.html", "<div>CHAPTER 02</div>\n");
  put("third-party/addons/demo-addon/skill/demo/SKILL.md", "Chapter 30 shows it.\n");
  put("skills/companion.md", "# The skill interview (Chapter 16)\n");
  const recipes = scan(tmp).bad.map(b => b.split(":")[0]).sort();
  JSON.stringify(recipes) === JSON.stringify(["notebook/recipes/demo/reference/more.md", "notebook/reusable-recipes/demo/SKILL.md", "starter-godspeed/skills/demo/SKILL.md", "tools/shown.js"])
    ? ok("a recipe naming a chapter is caught in all three places, and a frame preset, an add-on's own copy and a book companion file are not read")
    : no("the recipes were checked wrongly: " + JSON.stringify(recipes));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// This repository.
const root = path.resolve(__dirname, "..");
const real = scan(root);
if (real.bad.length === 0) ok(`none of the ${real.files.length} files a person is shown names a book chapter`);
else no(`these lines show a book chapter to a person:\n       ${real.bad.join("\n       ")}`);
real.files.length > 100 ? ok("and it read the installers and programs, not an empty list") : no(`it read only ${real.files.length} files`);

console.log(`\nno chapters: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
