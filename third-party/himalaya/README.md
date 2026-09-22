# Himalaya

The hub's Gmail connection uses [Himalaya](https://github.com/pimalaya/himalaya) 2.1.0, a free
command-line mail program by the Pimalaya project, dual-licensed MIT or Apache-2.0 (both texts
here, copied from the v2.1.0 release tag).

The kit does not include the program itself. `tools/hub-mail-imap.js` downloads the official
release archive for the computer it runs on, refuses it unless its SHA-256 matches
`tools/hub-mail-himalaya.json`, and keeps it in `~/.hub/mail/imap/bin/`, away from any Himalaya
you installed yourself.
