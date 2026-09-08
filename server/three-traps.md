# Three server checks worth keeping

1. The assistant's limited user can still alter its own files and use any credentials it holds. Permission limits and narrow credentials remain necessary. A refused unattended action must be reported, not treated as a completed job.
2. A private repository is still a remote copy. Review current files and history before uploading. Keep plaintext credentials out of tracked files; ignoring a path does not remove its earlier saved versions.
3. A quiet report and a failed run are different. Inspect actual job history and output. A plain service check can try a local restart without AI. A model probe needs the model to succeed; detecting its failure can be done without that answer. Neither can report every outage of the server it runs on.

The Chapter 31 guide gives the fresh-server recap, time-zone check and one-active-schedule migration. Chapter 32 gives the remote desktop route. Short historical tests do not establish overnight reliability.
