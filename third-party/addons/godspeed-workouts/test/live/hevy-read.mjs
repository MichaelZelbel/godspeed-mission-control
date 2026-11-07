// Reads the real Hevy account behind HEVY_API_KEY, read only, and prints each workout as the row it
// becomes. Nothing is written anywhere and the key is never printed.
//
//   HEVY_API_KEY=... node test/live/hevy-read.mjs [--tz Europe/Berlin] [--expect "<workout title>"]
//
// --expect "<workout title>" checks that a workout with exactly that title is in the account and reads
// as a row, and exits 1 when it is not. Without it the test only checks that reading works.
import { Hevy } from "../../lib/hevy.mjs";
import { rowData } from "../../lib/rows.mjs";

const args = process.argv.slice(2);
const tz = args.includes("--tz") ? args[args.indexOf("--tz") + 1] : "Europe/Berlin";
if (!process.env.HEVY_API_KEY) { console.error("Set HEVY_API_KEY."); process.exit(2); }
const hevy = new Hevy({ key: process.env.HEVY_API_KEY.trim() });
const user = await hevy.userInfo();
const all = await hevy.allWorkouts();
const count = await hevy.count();
const since = await hevy.eventsSince("2026-10-01T00:00:00Z");
// The answer an hourly run gets most often: nothing since the last run.
const none = await hevy.eventsSince(new Date().toISOString());
if (none.length) { console.log("FAIL events since now are not empty"); process.exit(1); }
console.log(`account units ${user.weight}/${user.distance}, Hevy Pro ${user.pro}; ${all.length} workout(s) listed, count says ${count}; ${since.length} event(s) since 1 October`);
for (const w of all) console.log(JSON.stringify({ id: w.id, ...rowData(w, { tz, units: user }) }, null, 1));
if (args.includes("--expect")) {
  const title = args[args.indexOf("--expect") + 1];
  const found = all.map((w) => ({ w, r: rowData(w, { tz, units: user }) })).find(({ r }) => r.workout === title);
  console.log(found ? `PASS the workout "${title}" is there and reads as a row (${found.w.id})` : `FAIL no workout called "${title}" in this account`);
  process.exit(found ? 0 : 1);
}
