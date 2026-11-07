#!/usr/bin/env node
// godspeed-workouts: an add-on for Godspeed Mission Control. Every workout logged in Hevy becomes
// one row of the Workouts tracker in the Godspeed notebook, with every set, within the hour.
import { main } from "../lib/cli.mjs";

let code = 1;
try {
  code = await main(process.argv.slice(2));
} catch (e) {
  console.error(`godspeed-workouts: ${e?.message || e}`);
  code = 1;
}
process.exit(code);
