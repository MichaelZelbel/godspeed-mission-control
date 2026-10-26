import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Godspeed Mission Control ships this recipe and this README as they are here, and its own tests
// hold them to the same sentences. These pin what a copy into it must still say, so a change here
// that would fail there fails here first.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replaceAll("\r", "");
const flat = (t) => t.replace(/\s+/g, " ");
const recipe = read("skill/interstitial-journal/SKILL.md");
const description = recipe.match(/^description: (.*)$/m)[1];

test('"track journal" and "track Tagebuch" are journal entries, every other "track" goes to the trackers', () => {
  assert.match(description, /"journal", "j:", "log:", "Tagebuch", "track journal" or "track Tagebuch"/);
  assert.doesNotMatch(description, /"track"[^ ]/, "no bare track in the description");
  assert.match(flat(recipe), /A message that starts with "track" is not a journal entry, even when it reads like a task \("track starting the video edit"\): leave it to the tracker recipe\./);
  assert.match(flat(recipe), /One exception: a message that starts with "track journal" or "track Tagebuch" \(any case, spoken or typed, a full stop, colon or comma after it allowed\) IS a journal entry, because it names the journal/);
  assert.doesNotMatch(recipe, /never a journal entry/);
  const readme = flat(read("README.md"));
  assert.match(readme, /starts with "journal", "j:", "log:", "Tagebuch", "track journal" or "track Tagebuch"/);
  assert.doesNotMatch(readme, /"j:", "track", "log:"/);
});

test("the recipe has no long dashes and no decision numbers", () => {
  assert.doesNotMatch(recipe, /[–—]|D-\d{3}/);
});

test("the recipe says where check-ins arrive, and what happens where nothing can deliver them", () => {
  const t = flat(recipe);
  assert.match(t, /sends it within 15 minutes of its time: to Telegram when that is connected, otherwise as a note in "From your routines" in the notebook\. Say where it will arrive\./);
  assert.match(t, /Where there is neither, nothing is sent and entries still save: say that plainly\./);
});

test("the README never tells a reader to install from a private repository", () => {
  const readme = read("README.md"), pkg = JSON.parse(read("package.json"));
  assert.doesNotMatch(readme, /github\.com\/MichaelZelbel\/godspeed-journal|github:MichaelZelbel\/godspeed-journal|teach-it-once-kit/);
  assert.match(readme, /git clone --depth 1 https:\/\/github\.com\/MichaelZelbel\/godspeed-mission-control\.git/);
  assert.equal(pkg.repository.url, "https://github.com/MichaelZelbel/godspeed-mission-control.git");
  assert.equal(pkg.repository.directory, "third-party/addons/godspeed-journal");
});
