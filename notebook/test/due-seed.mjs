// THE SEEDED MISSION CONTROL every test of this release holds its reminders against, and the one
// ticket 03's own checks.sh seeds its comparison with: one of every kind the release plan names (a
// deadline only; a target only, past its target; both; a repeating one with three windows of which
// one is closed; one dropped; one that does not read; an add-on's deadline; and a key in
// secrets/expires.txt), with the two closings that go with them, written as the old files
// tools/due.js wrote before 30 October 2026. It is in one place so that no two tests can seed two
// different sets, and so that the gate of a ticket seeds exactly what the tests do.
//
// The dates are fixed around 30 October 2026, so what every reminder says is the same on every run.
// Everything in here is made up.
import fs from 'node:fs';
import path from 'node:path';

// One of every kind the ticket names. The dates are fixed around 30 October 2026, so what every
// reminder says is the same on every run of these tests.
export const SEED = {
  'deadline-only': `TITLE: Service the boiler
DONE-WHEN: The boiler has been serviced.
COST-IF-MISSED: The warranty on it ends.
SELF-CHECK: none
SELF-CHECK-ARG:
REPEATS: no
LINK:
SOURCE: me, 2026-09-01

## Windows
STRIP: 2026-10-01 2026-12-31

## Log
- 2026-09-01 created, window 2026-10-01 to 2026-12-31
`,
  'present': `TITLE: Buy Priya a present
DONE-WHEN: The present is bought.
COST-IF-MISSED:
SELF-CHECK: none
REPEATS: no
SOURCE: me, 2026-09-20

## Windows
STRIP: 2026-09-25 - target 2026-10-20

## Log
- 2026-09-20 created, window 2026-09-25, aiming for 2026-10-20
- 2026-10-20 SAID brief
`,
  'tax-return': `TITLE: The tax return
DONE-WHEN: The return is filed.
COST-IF-MISSED: A fine of 250 euro.
SELF-CHECK: none
REPEATS: no
LINK: https://example.invalid/file-it
SOURCE: the letter, 2026-09-10

## Windows
STRIP: 2026-10-01 2027-02-28 target 2027-01-31

## Log
- 2026-09-10 created, window 2026-10-01 to 2027-02-28, aiming for 2027-01-31
`,
  'rates': `TITLE: Pay the quarterly rates
DONE-WHEN: The payment shows on the statement.
COST-IF-MISSED: A late fee of 40 euro.
SELF-CHECK: none
REPEATS: quarterly
SOURCE: me, 2026-01-05

## Windows
STRIP: 2026-01-05 2026-03-31 target 2026-03-15
STRIP: 2026-04-01 2026-06-30 target 2026-06-15 moved 2026-06-22
STRIP: 2026-07-01 2026-09-30 target 2026-09-15 asked

## Log
- 2026-01-05 created, window 2026-01-05 to 2026-03-31, aiming for 2026-03-15
`,
  'old-plan': `TITLE: Move the shed
DONE-WHEN: The shed stands behind the house.
COST-IF-MISSED: Nothing now.
SELF-CHECK: none
REPEATS: no
SOURCE: me, 2026-08-01

## Windows
STRIP: 2026-08-01 2026-11-30

## Log
- 2026-08-01 created, window 2026-08-01 to 2026-11-30
`,
  // A file nothing can read: lines of somebody's own invention and no window at all.
  'broken': `KIND: a birthday present
TARGET-DATE: 2026-12-01
NOTES: for my sister
`,
  'letter-pay': `TITLE: Pay the invented water bill
DONE-WHEN: Paid.
COST-IF-MISSED: A reminder fee.
SELF-CHECK: none
REPEATS: no
LINK: http://127.0.0.1:8000/documents/7/details
SOURCE: an-addon, 2026-10-02
ADDON: an-addon
ADDON-KEY: a1b2c3#1
ADDON-STATE: 4d6e8f0a1b2c3d4e
CALENDAR-MARKER: made-up-calendar:7

## Windows
STRIP: 2026-10-02 2026-11-20

## Log
- 2026-10-02 created by an-addon, window 2026-10-02 to 2026-11-20
`,
};
export const EVENTS = {
  '2026-03-12-rates-closed.md': `---
date: 2026-03-12
participants: [me]
closes: [due/rates#2026-01-05]
evidence: the statement of 12 March shows the payment
source: me, in a session
written_by: mc-due
origin: mission control
---

Pay the quarterly rates: finished (window 2026-01-05 to 2026-03-31, aiming for 2026-03-15).
`,
  '2026-10-05-old-plan-dropped.md': `---
date: 2026-10-05
participants: [me]
drops: [due/old-plan]
evidence: the shed is staying where it is
source: me, in a session
written_by: mc-due
origin: mission control
---

Move the shed: called off.
`,
};

export function write(root) {
  fs.mkdirSync(path.join(root, 'due'), { recursive: true });
  fs.mkdirSync(path.join(root, 'world', 'events'), { recursive: true });
  fs.mkdirSync(path.join(root, 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '');
  for (const [slug, text] of Object.entries(SEED)) fs.writeFileSync(path.join(root, 'due', slug + '.md'), text);
  for (const [name, text] of Object.entries(EVENTS)) fs.writeFileSync(path.join(root, 'world', 'events', name), text);
  // A key that runs out: tools/due.js makes a reminder of it (adoptKeys), and that reminder is an
  // ordinary file in due/ which the copy takes in like any other.
  fs.writeFileSync(path.join(root, 'secrets', 'expires.txt'),
    'made-up-api-key 2026-12-20 https://example.invalid/keys # The key that signs the invented receipts.\n');
}
