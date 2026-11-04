// A stand-in for godspeed-model: reads the request on stdin and behaves as FIXTURE_MODEL says.
import fs from "node:fs";
const mode = process.env.FIXTURE_MODEL || "slip";
if (process.env.FIXTURE_MODEL_LOG) fs.appendFileSync(process.env.FIXTURE_MODEL_LOG, fs.readFileSync(0, "utf8") + "\n");
const say = (text) => console.log(JSON.stringify({ text }));
if (mode === "fail") process.exit(3);
if (mode === "sleep") setTimeout(() => say('{"verdict":"not","language":"en"}'), 60000);
else if (mode === "garbage") say("I think the person is upset.");
else if (mode === "slip-de") say('{"verdict":"slip","language":"de"}');
else say(`{"verdict":"${mode}","language":"en"}`);
