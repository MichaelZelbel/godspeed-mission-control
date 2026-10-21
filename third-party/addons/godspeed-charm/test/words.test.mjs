import { test } from "node:test";
import assert from "node:assert/strict";
import { isExplicitReset, isYes, isNo } from "../lib/words.mjs";

test("explicit reset requests", () => {
  for (const w of ["charm slip", "reset my Charm Challenge", "Charm Challenge zurücksetzen", "zurück auf 21", "  Charm slip! "]) {
    assert.equal(isExplicitReset(w), true, w);
  }
});

test("venting stories are not explicit resets", () => {
  for (const w of ["I yelled at Copilot today", "ich habe ChatGPT angeschrien", "how is my Charm Challenge?", ""]) {
    assert.equal(isExplicitReset(w), false, w);
  }
});

test("yes in English and German", () => {
  for (const w of ["ja", "Yes", "Yes!", "ja.", "reset", "fair", " JA "]) assert.equal(isYes(w), true, w);
  for (const w of ["no", "nein", "yes but not now", "", "maybe"]) assert.equal(isYes(w), false, w);
});

test("no in English and German, straight or curly apostrophe", () => {
  for (const w of ["nein", "No", "no.", "that didn't count", "That didn\u2019t count!", "Nein!"]) assert.equal(isNo(w), true, w);
  for (const w of ["yes", "ja", "", "nobody"]) assert.equal(isNo(w), false, w);
});
