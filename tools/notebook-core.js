"use strict";
//
// tools/notebook-core.js - where the notebook's code is, for the CommonJS programs that call it.
// Extracted from due.js (#90, second slice) when holds.js and check-built-on.js needed it too, so
// there is one copy of this search.
//
// THE BRIDGE: the notebook's store is an ES module and the tools are CommonJS. `require` of an ES
// module is on by default from Node 20.19 and from 22.12, and nothing in notebook/core waits at
// the top level, so the tools keep running on the Node the product's suite uses for them (20).
//
// WHERE THAT CODE IS, when a program is not standing in the kit. The installer copies every
// file in tools/ into the assistant's command folder as well, and there is no notebook folder
// beside it there (found in review, 30 October 2026). The mission control itself says where its
// installed version is: a computer keeps each one in
// <root>/.godspeed/integrated-runtime/versions/<commit>, and the start.mjs beside them names the
// one it runs (notebook/scripts/install-native-notebook.sh). The kit's own notebook comes first, so
// a developer's checkout and the Windows kit need nothing of this.
//
// AND THE KIT ITSELF, WHEREVER IT STANDS (#112, 31 October 2026). An install with no integrated
// notebook has neither of the two places above: the Docker image - what a Hostinger reader and the
// one-line server installer give you - installs no notebook, and the copied tools have none beside
// them. For two weeks 2.0.0-beta.12 therefore left that whole edition with no reminders at all.
// But the kit is there: the image carries the repository it was built from at /opt/godspeed/kit and
// names it in KB_KIT_DIR, and the installer puts the kit in KB_KIT_DIR or else $HOME/teach-it-once-kit
// (server/install.sh). So the kit is the last place looked at, named the way the installer names it.
// NOTHING IS COPIED AND NOTHING IS INSTALLED TWICE: the kit on that edition is the very commit the
// tools came from, and a notebook/core only works with the kit's own tools/ above it anyway
// (notebook/core/due-copy.mjs requires ../../tools/due-files.js), which is why a copy of the
// notebook code beside the copied tools would be half a kit that can drift.
// THE KIT COMES LAST on purpose: an install that has a notebook keeps using exactly the notebook it
// runs, as it did before this, and only a copy that would otherwise refuse ever reaches the kit.
// A place counts only when due-records.mjs is in it, so a wrong KB_KIT_DIR is passed over and a
// copy with the code nowhere still says so in one plain sentence.
const fs = require("fs");
const path = require("path");

const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch (e) { return ""; } };

// The notebook/core folder to load from, or "" when there is none that has `marker` (a file only
// that code has, so a wrong place is passed over).
function notebookCore(godspeed, marker) {
  const tries = [path.join(__dirname, "..", "notebook", "core")];
  const state = path.join(godspeed, ".godspeed", "integrated-runtime");
  const under = (name) => path.join(state, "versions", name, "notebook", "core");
  const running = readText(path.join(state, "start.mjs")).match(/versions[/\\]+([0-9a-f]{40})/);
  if (running) tries.push(under(running[1]));
  try {
    const versions = fs.readdirSync(state + path.sep + "versions", { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[0-9a-f]{40}$/.test(e.name)).map((e) => under(e.name))
      .filter((d) => fs.existsSync(path.join(d, marker)))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    tries.push(...versions);
  } catch (e) { /* no installed version beside the mission control: nothing more to try */ }
  // The kit, named as the installer names it: KB_KIT_DIR (the image sets it), else the folder the
  // installer uses when nothing names another. GODSPEED_KIT_DIR is this program's own name for it,
  // for an install that keeps the kit somewhere else.
  const home = process.env.HOME || process.env.USERPROFILE || "";
  for (const kit of [process.env.GODSPEED_KIT_DIR, process.env.KB_KIT_DIR,
                     home && path.join(home, "teach-it-once-kit")]) {
    const named = (kit || "").trim();
    if (named) tries.push(path.join(named, "notebook", "core"));
  }
  for (const dir of tries) if (fs.existsSync(path.join(dir, marker))) return dir;
  return "";
}

module.exports = { notebookCore };
