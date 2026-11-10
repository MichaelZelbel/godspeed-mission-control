# Runtime scenarios

What Godspeed Mission Control does today, checkable on a Linux machine with Node 22 or later,
bash and python3, from the root of a checkout. How to run each one: `harness/RUNTIME.md`.

Godspeed is not one web app. A reader installs it (installers, Docker), its notebook is a local web
app, and its proving scenarios check what each install saw. These journeys cover the parts that run
in a checkout without a throwaway machine. The notebook's web pages need a frontend build and are not
covered yet; nor is a whole install.

## The notebook starts on a new person's empty folder and says it is healthy

1. Make a new, empty folder for the person.
2. Start the notebook on it, on a free port.
3. Ask it `/health`.
4. It answers HTTP 200 with `"ok": true` and `"version"` equal to the `version` in
   `notebook/package.json`, and the log says it is listening on that port.

**What would make this fail:** the process exits, `/health` does not answer within 30 seconds,
`ok` is not true, or the version is not the one in this checkout.

## The proving scenarios judge what they saw rightly

1. Run the scenario corpus: `bash scenarios/test-scenarios.sh`.
2. Its last line says `N of N pass` with the same number twice and N greater than 700.

**What would make this fail:** any `FAIL` line, a last line where the two numbers differ, or a
corpus that suddenly finds far fewer cases than before.

## The one-line server installer refuses and explains what it should

1. Run `bash docker/server/test.sh` (the parts that need no Docker).
2. It exits 0 and prints no `FAIL` line.

**What would make this fail:** any `FAIL` line or a non-zero exit.
