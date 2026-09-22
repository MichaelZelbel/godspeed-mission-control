# Retired: registering your own Google app for Gmail

Retired on 2026-09-22 and kept here unchanged, so the work and the reason stay together.

These files were the installer's Gmail step: `mc-mail-guide.js` walked the reader through
Google's developer console (eleven steps), and `mc-mail-google.js` with `mc-mail-browser.js`
were an unfinished attempt to do that clicking in a browser window for them. A real run on
2026-09-21 stopped before a usable connection (the record is in Ownward Studio's
`company-memory/book/chapter-verification/ch30-gmail-guided-run-2026-09-21.md`).

The reviewed email plan replaced the route: Gmail is connected through Himalaya and a Google app
password (`tools/mc-mail-imap.js`), with no Google Cloud project at all. `mc-mail connect gmail`
and the installers' `--only gmail` / `-Only gmail` now say the step is retired and name the new
one.

A Gmail connection somebody already made the old way keeps working: `tools/mc-mail-gmail.js`
still reads it. Nothing here deletes a Google Cloud project, a client, a grant, a message or a
draft; remove those at Google if you no longer want them.

These files are outside `tools/`, so the installer no longer copies them onto a computer.
