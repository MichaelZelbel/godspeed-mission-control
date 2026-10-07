import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readTable, autoTicks, parseAuto } from "../lib/auto.mjs";
import { addHabit, track } from "../lib/habits.mjs";
import { tmpMission, area } from "./helpers.mjs";

const CSV = "date,steps,run_km,protein_g\n2026-09-26,8970,5.10,92\n2026-09-27,4000,,\n2026-09-28,6000,0,120\n";

test("rules", () => {
  assert.deepEqual(parseAuto("run_km > 0"), { column: "run_km", op: ">", value: 0 });
  assert.deepEqual(parseAuto("protein_g>=100"), { column: "protein_g", op: ">=", value: 100 });
  assert.equal(parseAuto("run on sundays"), null);
  assert.equal(parseAuto(""), null);
});

test("a run in the table ticks the run habit; an empty cell ticks nothing", () => {
  const mc = tmpMission({ "coach/health/area.md": area(), "data/daily.csv": CSV });
  const table = readTable(path.join(mc, "data", "daily.csv"));
  assert.equal(table["2026-09-26"].run_km, "5.10");
  let run = addHabit(mc, { area: "health", title: "Run", days: "daily", auto: "run_km > 0" }, "2026-09-26");
  const protein = addHabit(mc, { area: "health", title: "Protein", days: "daily", auto: "protein_g >= 100" }, "2026-09-26");
  const plain = addHabit(mc, { area: "health", title: "Lifts", days: "daily" }, "2026-09-26");
  const odd = addHabit(mc, { area: "health", title: "Odd", days: "daily", auto: "nothing_here > 0" }, "2026-09-26");
  const days = ["2026-09-26", "2026-09-27", "2026-09-28"];
  const ticks = autoTicks([run, protein, plain, odd], table, days).map((t) => `${t.habit.slug} ${t.ymd}`);
  assert.deepEqual(ticks, ["run 2026-09-26", "protein 2026-09-28"]);
  run = track(run, "2026-09-26", "done", "data", "run_km 5.10");
  assert.deepEqual(autoTicks([run], table, days), [], "never twice");
  assert.deepEqual(readTable(path.join(mc, "missing.csv")), {});
});
