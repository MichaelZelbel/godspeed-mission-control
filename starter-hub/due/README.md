# Deadlines (Chapter 26)

This folder starts empty. `hub-due` stores each deadline's first day, last day, completion condition and consequence here. Run `hub-due --help` for the installed command syntax.

The morning brief runs `hub-due check` first, then `hub-due today`. Manual completion is the default: `hub-due done NAME`. Dropping an entry and its history requires `hub-due drop NAME --yes`.

The `file-newer` option checks modification time only. It can close an unfinished draft and is not proof of a successful backup, renewal or submission. Use it only for a tested completion signal. Missing or failed checks must not be reported as completion.

Normally today selects up to three entries and can return the same entries on repeated calls that day. Overload prints every affected title and date. Selection is not proof of delivery. The local tool implements no separate phone-alert path.

Dated key entries can come from `secrets/expires.txt`. Keep one source for each date. A changed date alone does not prove the replacement works. Full build and isolated practice checks: `procedures/what-runs-out-and-when.md` in the kit.
