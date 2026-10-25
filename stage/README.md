# stage

Not for you: `stage.sh`, `stage.mjs` and `check-public-lines.sh`.

The files here are not programs you type, and the installer does not put them on your
computer. They are how the installers themselves know which version to install, and one check
on the lines that lead to them. That is why they are here and not in `tools/`: everything in
`tools/` is copied onto every user's computer as a program, and these are not programs for users.

`stage.json`, at the top of this repository, is the **stage file**: one file saying
everything one published version is made of. The commit of this repository the version
runs, the two kit-bootstrap commits it was installed and built with, the server image of
each server edition by digest, the Windows setup with its release tag and its SHA-256, the
pinned commit of every carried add-on, the stage this one replaced, and the versions that
were taken back. `stage.schema.json` beside it names every field, its type and its pattern:
a commit is forty lowercase hex, a digest is `<image>@sha256:` and sixty-four hex, a version
looks like `2.0.0-beta.6`.

`stage/stage.mjs` reads a stage file in Node and `stage/stage.sh` reads it in POSIX shell,
without `jq`, Node or Python, because an installer runs before Node is installed and on
servers that have none. They take the same command line and leave the same exit code:

```
node stage/stage.mjs stage.json get productCommit
sh   stage/stage.sh   stage.json get serverEditions.server.image
sh   stage/stage.sh   withdrawn installed-stage.json public-stage.json
```

`check` reads and checks a file and prints nothing, `fields` names everything it can read,
`get` prints one of them, `json` prints the whole checked file, and `withdrawn` answers
`yes` or `no` for a version, saying yes when either the stage being installed or the public
one lists it. Exit 0 means answered, 1 means the file was refused with one plain sentence on
stderr, and 2 means the file is sound but holds no such field. An installer goes on only when
the answer is exactly `no`, so every failure fails closed.

`stage/stage.sh` has no JSON parser. It reads the one layout a stage file is written in -
the one `JSON.stringify(stage, null, 2)` writes: two spaces a level, one field a line, no
tabs, no backslash escapes, Unix line endings - and refuses anything else with a plain
sentence rather than guess at it. Write a stage file that way or it will not be read.

A stage file also names each field once. JSON allows the same field twice, and the two
readers would keep a different one of the two - `JSON.parse` the last, the shell reader's own
parser the first - so a file like that could be withdrawn in one reader and not in the other.
Both refuse it instead, with the same sentence, so the withdrawn answer still fails closed.

A stage file's fields are also only the ones it names itself. JavaScript gives every object
it builds a handful of names of its own - `toString`, `constructor`, `__proto__`,
`hasOwnProperty` and the rest - and `stage/stage.mjs` builds its objects out of `JSON.parse`,
so it is handed all of them for free. None of them is a field, at any level and whatever its
value: both readers refuse a stage file that holds one, in the same sentence, and both answer
exit 2 when one is asked for, so neither ever prints something JavaScript made up rather than
something the file says. That holds where a stage file names its own fields too - an add-on or
a server edition cannot be called `constructor`, even though the pattern those names are
matched by would have let it through. `stage.schema.json` writes the list down under
`neverNamedFields`; `stage/stage.mjs` reads it from there, `stage/stage.sh` repeats it, and
`stage/stage-cases/inherited-names.txt` is the list all three tests sweep.

`stage/check-public-lines.sh` is the other side of the same thing: the readers say which version
an installer installs, and this check says that the lines people copy lead to the public stage at
all. It reads every file holding a public line of this repository - the README, the Docker and
server pages, the installers themselves and the server container's setup links - and fails, naming
the file and the line, when one of them names the `main` branch (whatever was merged today) or a
dated release tag (a version that is no longer current). Addresses allowed on purpose are listed in
the script with the reason. `sh stage/check-public-lines.sh` reads the checkout you are in, and a
folder given after it reads another copy of those files, which is how its test shows it failing on
an older commit. Its own test is `bash stage/test-check-public-lines.sh`.

Three tests keep the two readers one reader, each one command from the root of a checkout:
`node stage/test-stage.mjs`, `bash stage/test-stage-sh.sh` (which runs the whole list under
every shell on the machine) and `bash stage/test-stage-agree.sh` (which asks both readers for
every field of the real `stage.json` and compares each value with the release record and with
the file that pins the same thing today). The malformed files they are both held to are in
`stage/stage-cases/`.
