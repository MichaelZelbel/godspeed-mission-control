"""The holdout fence: only the holdout subagents may see .factory/holdout/, and nothing may change the fence.

Claude Code runs this before every tool call (`pre`) and tags each call a subagent makes with its
`agent_type`. Calls from `holdout-writer` and `holdout-verifier` pass. Every other call (builders,
reviewers, the manager itself, a human session) is refused, by exit 2, when it would show a scenario:

- it names the folder or a HOLDOUT.md, or globs into `.factory`;
- it is a recursive search whose scope covers the folder. The Grep and Glob tools skip the folder
  through `.ignore`; shell `grep -r`, `git grep` and `rg --no-ignore` do not;
- it is a `git diff`, `git log -p` or `git show` whose output would include a file in the folder.
  Git is asked with `--name-only`, so a command that cannot reach the folder is never refused.

Any call that would change the fence itself is refused for everyone. The fence is this hook folder,
the repository root's `.claude/settings.json` and `.claude/settings.local.json`, the root `.ignore`,
and the account's own Claude settings (`~/.claude/settings.json`), because each of them can switch
the fence off. Paths are resolved against the repository root, so the same names elsewhere (the
starter's `starter-godspeed/.claude/settings.json`) are product files and stay writable. For shell
tools only the places a command writes are judged (redirections, `tee`, `sed -i`, the targets of
`rm`, `mv`, `cp`, `chmod`, `truncate`, `git checkout --`, `git restore` and the like), so reading or
naming a fenced file is fine. A write whose target cannot be known (inline code, `xargs`, an unknown
variable) is refused when its text names a fenced file.

After each call (`post`) the result is checked for scenario text, and a hit is appended to
`holdout-exposures.jsonl` in the repository's git directory, so a leak the fence did not foresee is
counted instead of invisible.

Claude Code lets a call through when a hook errors, so `pre` fails closed: an error is a refusal.
"""

from __future__ import annotations

import fnmatch
import functools
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

HOLDOUT_AGENTS = {"holdout-writer", "holdout-verifier"}
FOLDER = ".factory/holdout"
# Tools that read, search or change files, or hand work to another agent. Output-only tools
# (StructuredOutput, TodoWrite, ...) are never refused for mentioning the folder.
ACCESS_TOOLS = {"Bash", "PowerShell", "Read", "Grep", "Glob", "Edit", "Write", "MultiEdit",
                "NotebookEdit", "NotebookRead", "Agent", "Task"}
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
SHELL_TOOLS = {"Bash", "PowerShell"}

# The holdout verifier keeps a script per scenario in ~/.archon/holdout-tools/; they carry the
# scenarios' logic and thresholds, so they are fenced like the scenarios.
NAMED = re.compile(r"\.factory/+(?:holdout(?![\w-])|[*?\[])|(?<![\w-])holdout\.md\b|holdout-tools", re.I)
# The fence, as paths below the repository root (and below any other git work tree, so a second
# worktree of this repository is fenced the same way).
FENCED_TAILS = (".factory/hooks", ".claude/settings.json", ".claude/settings.local.json", ".ignore")
# Folders whose removal or move takes a fenced file with it.
FENCED_PARENTS = (".factory", ".factory/hooks", ".claude")
# The fence named in free text. Only used where a write's target cannot be known: inline code, a
# heredoc fed to an interpreter, `xargs`, a path built from an unknown variable.
FENCE = re.compile(r"\.factory/+hooks(?![\w-])|\.claude/+settings(?:\.local)?\.json|(?<![\w.])\.ignore\b", re.I)
# Written only when the shell's own command line could not be read; then any write-shaped command
# that names the fence is refused, as before.
MUTATES = re.compile(
    r">|\btee\b|\b(?:sed|perl)\s+-\w*i|\b(?:rm|mv|cp|chmod|truncate|ln|install)\b|"
    r"\bgit\s+(?:checkout|restore|rm|mv|reset|stash)\b|Set-Content|Add-Content|Out-File|"
    r"Remove-Item|Move-Item|Copy-Item|Rename-Item", re.I)
# Command words that only run the next word.
WRAPPERS = {"sudo", "doas", "env", "command", "builtin", "exec", "nohup", "nice", "time", "timeout",
            "stdbuf", "ionice", "chronic"}
# Programs that remove or move what they are given; a folder holding a fenced file counts.
REMOVERS = {"rm", "rmdir", "unlink", "shred", "srm", "trash", "trash-put", "mv", "remove-item", "ri", "del",
            "erase", "rd", "move-item", "mi", "move", "rename-item", "rni", "ren"}
# Programs that write the files they are given.
WRITERS = {"tee", "touch", "truncate", "sponge", "patch", "vi", "vim", "nvim", "nano", "emacs", "ed", "ex",
           "set-content", "sc", "add-content", "ac", "out-file", "clear-content", "clc", "new-item", "ni",
           "set-item", "si", "tee-object"}
# Programs that change the files they are given; with -R a folder holding a fenced file counts.
CHANGERS = {"chmod", "chown", "chgrp", "chattr", "setfacl"}
# Programs that write to their last argument (or into it, when it is a folder).
COPIERS = {"cp", "install", "rsync", "copy-item", "cpi", "copy"}
# Programs that write in place only with a flag.
IN_PLACE = {"sed", "gsed", "perl", "ruby", "awk", "gawk"}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "fish"}
# Programs whose -o (or wget's -O) names the file they write.
OUTPUT_FLAG_PROGRAMS = {"curl", "wget", "sort", "gcc", "g++", "cc", "clang", "clang++", "go", "rustc",
                        "pandoc", "openssl", "gpg", "base64"}
POWERSHELLS = {"pwsh", "powershell", "pwsh.exe", "powershell.exe"}
INTERPRETERS = {"python", "python3", "python2", "py", "node", "nodejs", "deno", "bun", "perl", "ruby",
                "php", "cmd", "cmd.exe", "osascript", "lua", "tclsh"}
GIT_RESTORERS = {"checkout", "restore", "reset", "stash", "switch"}
GIT_REMOVERS = {"rm", "mv"}
REDIRECT_TARGET = re.compile(r"^(?:\d*|&)(?:>>?|>\||>&|<>)$|^&>>?$")
SEPARATOR_CHARS = set(";\n()")
SEGMENT = re.compile(r"\s*(?:&&|\|\||;|\||\n)\s*")
NO_PATCH = {"--stat", "--name-only", "--name-status", "--numstat", "--shortstat", "--summary",
            "-s", "--no-patch", "--quiet", "--exit-code", "--raw"}
LOG_PATCH = re.compile(r"^(?:-p|--patch|-u|-U\d*|--unified(?:=\d+)?|--full-diff|-m|--cc|-c)$")
PROBE_DROP = re.compile(r"^(?:-p|--patch|-u|-U\d*|--unified(?:=\d+)?|--stat(?:=.*)?|--color(?:=.*)?|"
                        r"--format(?:=.*)?|--pretty(?:=.*)?|--oneline|--graph|-w|--word-diff(?:=.*)?)$")
GREP_ARG_OPTS = {"-e", "-f", "-A", "-B", "-C", "-m", "-d", "-D", "--context", "--max-count", "--include",
                 "--exclude", "--exclude-dir", "--regexp", "--file"}


def refuse(reason: str) -> None:
    print(f"Blocked by the holdout fence: {reason}. The holdout scenarios are for the "
          "holdout-verifier and holdout-writer subagents only; scope searches and diffs to source "
          "folders (or exclude .factory).", file=sys.stderr)
    sys.exit(2)


def normal(path: str) -> str:
    """A comparable absolute path: forward slashes, Git Bash drive form folded, case folded on Windows."""
    path = path.strip().strip("'\"").replace("\\", "/")
    drive = re.match(r"^/([a-zA-Z])(/|$)", path)
    if drive and os.name == "nt":
        path = f"{drive.group(1)}:/{path[3:]}"
    path = os.path.normpath(os.path.expanduser(path)).replace("\\", "/")
    return path.lower() if os.name == "nt" else path


def resolve(path: str, cwd: str) -> str:
    path = path.strip().strip("'\"")
    static = re.split(r"[*?\[{]", path, maxsplit=1)[0]
    if static != path:
        static = static.rsplit("/", 1)[0] if "/" in static else ""
    raw = static.replace("\\", "/")
    if raw == "" or not (raw.startswith("/") or re.match(r"^[a-zA-Z]:", raw) or raw.startswith("~")):
        raw = os.path.join(cwd, raw) if raw else cwd
    return normal(raw)


def covers(path: str, holdout: str) -> bool:
    path = path.rstrip("/")
    return holdout == path or holdout.startswith(path + "/")


def tokens(segment: str, posix: bool = True) -> list[str]:
    try:
        words = [w.strip("'\"") for w in shlex.split(segment, posix=posix)]
    except ValueError:
        words = segment.split()
    while words and re.match(r"^\w+=", words[0]):
        words = words[1:]
    return words


def excluded(words: list[str]) -> bool:
    """The search excludes .factory (or the holdout folder) itself."""
    text = " ".join(words).replace("\\", "/")
    return bool(re.search(r"(--exclude-dir[= ]\S*(\.factory|holdout|\.\*))|(:\(exclude\)|:!|:\^)\S*\.factory"
                          r"|(-g|--glob)[= ]['\"]?!\S*\.factory", text, re.I))


def grep_paths(args: list[str]) -> tuple[bool, list[str]]:
    recursive, positional, has_pattern_opt, skip = False, [], False, False
    for index, arg in enumerate(args):
        if skip:
            skip = False
            continue
        if arg == "--":
            positional.extend(args[index + 1:])
            break
        if arg.startswith("--"):
            recursive |= arg in ("--recursive", "--dereference-recursive")
            has_pattern_opt |= arg.startswith(("--regexp", "--file"))
            skip = arg in GREP_ARG_OPTS
        elif arg.startswith("-") and len(arg) > 1:
            letters = arg[1:]
            recursive |= "r" in letters or "R" in letters
            has_pattern_opt |= "e" in letters or "f" in letters
            skip = arg in GREP_ARG_OPTS or letters[-1:] in ("e", "f", "A", "B", "C", "m")
        else:
            positional.append(arg)
    paths = positional if has_pattern_opt else positional[1:]
    return recursive, paths


def git_probe(words: list[str], cwd: str, holdout_rel: str) -> bool:
    """Whether a git diff/log/show would print a file under the holdout folder."""
    index, base = 1, cwd
    while index < len(words) and words[index].startswith("-"):
        if words[index] in ("-C", "-c") and index + 1 < len(words):
            base = resolve(words[index + 1], cwd) if words[index] == "-C" else base
            index += 2
        else:
            index += 1
    if index >= len(words) or words[index] not in ("diff", "log", "show", "whatchanged"):
        return False
    sub, rest = words[index], words[index + 1:]
    if any(arg in NO_PATCH for arg in rest) and not any(LOG_PATCH.match(arg) for arg in rest):
        return False
    if sub in ("log", "whatchanged") and not any(LOG_PATCH.match(arg) for arg in rest):
        return False
    probe = ["git", "-C", base, sub, "--name-only"] + (["--format="] if sub != "diff" else [])
    probe += [arg for arg in rest if not PROBE_DROP.match(arg)]
    try:
        out = subprocess.run(probe, capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return any(line.strip().replace("\\", "/").startswith(holdout_rel + "/") for line in out.splitlines())


def check_shell(command: str, cwd: str, holdout: str, posix: bool) -> None:
    for segment in SEGMENT.split(command):
        words = tokens(segment, posix)
        if not words:
            continue
        program = words[0].rsplit("/", 1)[-1].lower()
        if program == "cd" and len(words) > 1:
            cwd = resolve(words[1], cwd)
            continue
        if program in ("grep", "egrep", "fgrep"):
            recursive, paths = grep_paths(words[1:])
            if recursive and not excluded(words) and any(covers(resolve(p, cwd), holdout) for p in paths or ["."]):
                refuse(f"`{segment.strip()[:80]}` searches the folder")
        elif program == "rg":
            no_ignore = any(re.match(r"^(-u+|--no-ignore(-dot|-files|-vcs)?)$", w) for w in words[1:])
            if no_ignore and not excluded(words):
                paths = [w for w in words[1:] if not w.startswith("-")][1:]
                if any(covers(resolve(p, cwd), holdout) for p in paths or ["."]):
                    refuse(f"`{segment.strip()[:80]}` searches the folder without .ignore")
        elif program == "git" and "grep" in words[1:3]:
            rest = words[words.index("grep") + 1:]
            specs = rest[rest.index("--") + 1:] if "--" in rest else []
            if not excluded(words) and any(covers(resolve(p, cwd), holdout) for p in specs or ["."]):
                refuse(f"`{segment.strip()[:80]}` searches the folder")
        elif program == "git" and git_probe(words, cwd, FOLDER):
            refuse(f"`{segment.strip()[:80]}` would print a holdout file")


# ---- The fence itself: which writes would change it ----------------------------------------------

@functools.lru_cache(maxsize=None)
def repo_roots() -> frozenset[str]:
    """This repository's root: where this script lives, and $CLAUDE_PROJECT_DIR when that is the root
    of a work tree (a session started in a subfolder such as starter-godspeed adds nothing)."""
    roots = {normal(str(Path(__file__).resolve().parents[2]))}
    project = os.environ.get("CLAUDE_PROJECT_DIR")
    if project and os.path.exists(os.path.join(project, ".git")):  # a work tree's root, not a subfolder
        roots.add(normal(project))
    return frozenset(roots)


def fence_paths() -> list[str]:
    """The fenced paths, comparable with `normal` paths: below this repository's root and the
    account's own Claude settings."""
    paths = [f"{root}/{tail}" for root in sorted(repo_roots()) for tail in FENCED_TAILS]
    homes = {normal("~/.claude")}
    if os.environ.get("CLAUDE_CONFIG_DIR"):
        homes.add(normal(os.environ["CLAUDE_CONFIG_DIR"]))
    return paths + [f"{home}/{name}" for home in sorted(homes) for name in ("settings.json", "settings.local.json")]


@functools.lru_cache(maxsize=None)
def git_common_dir(base: str) -> str | None:
    """The shared git folder of the work tree at `base` (a worktree's `.git` file points into it)."""
    git = f"{base}/.git"
    if os.path.isdir(git):
        return normal(git)
    try:
        line = Path(git).read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    if not line.startswith("gitdir:"):
        return None
    gitdir = line[len("gitdir:"):].strip().replace("\\", "/")
    gitdir = normal(gitdir if os.path.isabs(gitdir) or re.match(r"^[a-zA-Z]:", gitdir) else f"{base}/{gitdir}")
    try:
        common = Path(gitdir, "commondir").read_text(encoding="utf-8").strip().replace("\\", "/")
    except OSError:
        return gitdir
    return normal(common if os.path.isabs(common) else f"{gitdir}/{common}")


def work_tree(base: str) -> bool:
    """Whether `base` is the root of a work tree of this same repository (a second worktree)."""
    if base == "":
        return False
    mine = {git_common_dir(root) for root in repo_roots()} - {None}
    return git_common_dir(base) in mine


def parents(path: str) -> list[str]:
    out = []
    while True:
        parent = os.path.dirname(path)
        if parent == path or parent == "":
            return out
        out.append(parent)
        path = parent


def fenced(path: str, fence: list[str], whole: bool) -> bool:
    """Whether writing `path` changes the fence. `whole`: the call removes or moves `path` with all
    it holds, so a folder holding a fenced file counts too."""
    path = path.rstrip("/") or "/"
    prefix = path if path.endswith("/") else path + "/"
    for item in fence:
        if path == item or path.startswith(item + "/") or (whole and item.startswith(prefix)):
            return True
    # The same names at the root of another work tree (a second worktree of this repository).
    for tail in FENCED_TAILS + (FENCED_PARENTS if whole else ()):
        if path.endswith("/" + tail) and work_tree(path[:-len(tail) - 1]):
            return True
    return "/.factory/hooks/" in path and work_tree(path.split("/.factory/hooks/", 1)[0])


VARIABLE = re.compile(r"\$\{?([A-Za-z_]\w*)\}?")
GLOB = re.compile(r"[*?\[]")
BRACES = re.compile(r"\{([^{}$]*,[^{}]*)\}")


def expand(word: str, cwd: str) -> str | None:
    """The absolute path a shell word names, or None when it cannot be known (an unknown variable,
    a command substitution, standard output)."""
    word = word.strip().strip("'\"").replace("\\", "/")
    known = {"HOME": str(Path.home()), "USERPROFILE": str(Path.home()), "PWD": cwd,
             "CLAUDE_PROJECT_DIR": os.environ.get("CLAUDE_PROJECT_DIR") or ""}
    word = VARIABLE.sub(lambda m: known.get(m.group(1)) or m.group(0), word).replace("\\", "/")
    if word in ("", "-") or "$" in word or "`" in word:
        return None
    if not (word.startswith(("/", "~")) or re.match(r"^[a-zA-Z]:", word)):
        word = f"{cwd}/{word}"
    return normal(word)


def braces(word: str, limit: int = 64) -> list[str]:
    match = BRACES.search(word)
    if not match:
        return [word]
    out: list[str] = []
    for part in match.group(1).split(","):
        out += braces(word[:match.start()] + part + word[match.end():], limit)
        if len(out) >= limit:
            break
    return out[:limit]


def glob_match(pattern: str, path: str) -> bool:
    """Shell globbing: `*` and `?` stay inside one path part, `**` spans parts."""
    want, have = pattern.split("/"), path.split("/")

    def walk(i: int, j: int) -> bool:
        if i == len(want):
            return j == len(have)
        if want[i] == "**":
            return any(walk(i + 1, k) for k in range(j, len(have) + 1))
        return j < len(have) and fnmatch.fnmatchcase(have[j], want[i]) and walk(i + 1, j + 1)
    return walk(0, 0)


def hits(word: str, cwd: str, fence: list[str], whole: bool = False) -> bool:
    """Whether a write to the shell word `word` would change the fence. A path that cannot be known
    counts when its text names a fenced file (fail closed for writes)."""
    for one in braces(word):
        path = expand(one, cwd)
        if path is None:
            if FENCE.search(one.replace("\\", "/")):
                return True
            continue
        if GLOB.search(path):
            folder = GLOB.split(path, 1)[0].rsplit("/", 1)[0]
            if any(folder == item or folder.startswith(item + "/") for item in fence):
                return True  # everything it can match is inside the fenced hook folder
            items = fence + ([parent for item in fence for parent in parents(item)] if whole else [])
            if any(glob_match(path, item) for item in items):
                return True
            continue
        if fenced(path, fence, whole) or fenced(normal(os.path.realpath(path)), fence, whole):
            return True
    return False


PATH_ENDS = set(" \t\r\n'\"`()[]{}=,;<>|&+")


def names_fence(text: str, cwd: str, fence: list[str]) -> bool:
    """Whether code whose effect cannot be read names a fenced file. Each fenced name is taken with
    the path in front of it (`starter-godspeed/.claude/settings.json` is a product file); a bare
    `.claude/settings.json` or `.ignore` counts, since what it is joined to cannot be known."""
    text = text.replace("\\", "/")
    for match in FENCE.finditer(text):
        start = match.start()
        while start > 0 and text[start - 1] not in PATH_ENDS:
            start -= 1
        if text[start:match.start()] in ("", "/", "./") or hits(text[start:match.end()], cwd, fence):
            return True
    return False


HEREDOC = re.compile(r"<<(-?)[ \t]*(['\"]?)(\\?)([^\s'\"<>;&|()]+)\2")
PUNCTUATION = set(";&|<>()\n")


def scan(text: str, posix: bool) -> tuple[str, list[tuple[str, str]], list[str]]:
    """The command without its heredoc bodies, each heredoc as (its command line, its body), and the
    text of each command substitution. Quotes are respected: a quoted `<<` or a single-quoted `$(`
    is only text. The body of a heredoc whose word is not quoted is searched for substitutions too,
    because the shell runs them."""
    docs: list[tuple[str, str]] = []
    subs: list[str] = []
    if not posix:  # PowerShell here-strings are text
        text = re.sub(r"@(['\"])\r?\n.*?\r?\n\1@", "''", text, flags=re.S)
    flat, _ = _scan(text, 0, posix, docs, subs, nested=False)
    return flat, docs, subs


def _scan(text: str, i: int, posix: bool, docs: list, subs: list, nested: bool,
          heredoc: bool = False) -> tuple[str, int]:
    out: list[str] = []
    # A heredoc body reads like one long double-quoted string whose quote marks are plain text.
    quote, pending, depth, n = '"' if heredoc else None, [], 0, len(text)
    escape = "\\" if posix else "`"
    while i < n:
        c = text[i]
        if quote == "'":
            out.append(c)
            i += 1
            if c == "'":
                quote = None
            continue
        if c == escape and i + 1 < n:
            out.append(text[i:i + 2])
            i += 2
            continue
        if quote == '"' and c == '"' and not heredoc:
            quote = None
        elif text.startswith("$(", i) and not text.startswith("$((", i):
            inner, i = _scan(text, i + 2, posix, docs, subs, nested=True)
            subs.append(inner)
            out.append(f"$({inner})")
            continue
        elif posix and c == "`":
            j = i + 1
            while j < n and text[j] != "`":
                j += 2 if text[j] == "\\" else 1
            subs.append(text[i + 1:j])
            out.append(text[i:j + 1])
            i = j + 1
            continue
        elif quote is None:
            if c in "'\"":
                quote = c
            elif posix and c in "<>" and text.startswith("(", i + 1):
                inner, i = _scan(text, i + 2, posix, docs, subs, nested=True)
                subs.append(inner)
                out.append(f"{c}({inner})")
                continue
            elif nested and c == "(":
                depth += 1
            elif nested and c == ")":
                if depth == 0:
                    return "".join(out), i + 1
                depth -= 1
            elif posix and text.startswith("<<", i) and not text.startswith("<<<", i):
                match = HEREDOC.match(text, i)
                if match:
                    expands = match.group(2) == "" and match.group(3) == ""
                    pending.append((match.group(1) == "-", match.group(4), expands))
                    out.append(match.group(0))
                    i = match.end()
                    continue
            elif c == "\n" and pending:
                header = "".join(out).rsplit("\n", 1)[-1]
                out.append(c)
                i += 1
                for strip_tabs, word, expands in pending:
                    body = []
                    while i < n:
                        end = text.find("\n", i)
                        end = n if end < 0 else end
                        line, i = text[i:end], end + 1
                        if (line.lstrip("\t") if strip_tabs else line).rstrip("\r") == word:
                            break
                        body.append(line)
                    docs.append((header, "\n".join(body)))
                    if expands:
                        _scan("\n".join(body), 0, posix, docs, subs, nested=False, heredoc=True)
                pending = []
                continue
        out.append(c)
        i += 1
    return "".join(out), n


def lex(text: str, posix: bool) -> list[str]:
    if not posix:  # PowerShell: a backslash is a path separator and the backtick escapes
        text = text.replace("\\", "/")
    lexer = shlex.shlex(text, posix=True, punctuation_chars=";&|<>()\n")
    lexer.whitespace, lexer.whitespace_split, lexer.commenters = " \t\r", True, ""
    if not posix:
        lexer.escape = "`"
    return list(lexer)


def commands(tokens: list[str]) -> list[tuple[list[str], list[str]]]:
    """Simple commands as (words, the files their redirections write)."""
    out: list[tuple[list[str], list[str]]] = []
    words: list[str] = []
    targets: list[str] = []
    expect = None
    for token in tokens:
        if token and set(token) <= PUNCTUATION:
            if (set(token) & set(";\n()") or ("|" in token and token != ">|")
                    or ("&" in token and ">" not in token)):
                if words or targets:
                    out.append((words, targets))
                words, targets = [], []
            expect = None if set(token) & set("()") else "out" if ">" in token else "in" if "<" in token else None
            continue
        if expect == "out":
            if not re.fullmatch(r"\d+|-", token):
                targets.append(token)
        elif expect is None:
            words.append(token)
        expect = None
    if words or targets:
        out.append((words, targets))
    return out


WRAPPER_VALUES = {"sudo": {"-u", "-g", "-C", "-h", "-p", "-U", "-r", "-t", "-D"}, "env": {"-u", "-C", "-S"},
                  "nice": {"-n"}, "timeout": {"-s", "-k"}, "ionice": {"-c", "-n", "-p"}}


def program(words: list[str]) -> tuple[str, list[str]]:
    """The program a simple command runs and its arguments, past assignments and wrappers."""
    index = 0
    while index < len(words):
        word = words[index]
        if re.match(r"^[A-Za-z_]\w*=", word):
            index += 1
            continue
        name = word.replace("\\", "/").rsplit("/", 1)[-1].lower()
        name = name[:-4] if name.endswith(".exe") else name
        if name not in WRAPPERS:
            return name, words[index + 1:]
        index += 1
        duration = name == "timeout"
        while index < len(words):
            arg = words[index]
            if arg in WRAPPER_VALUES.get(name, ()):
                index += 2
            elif arg.startswith("-") or re.match(r"^[A-Za-z_]\w*=", arg):
                index += 1
            elif duration:
                duration = False
                index += 1
            else:
                break
    return "", []


def plain(args: list[str]) -> list[str]:
    """The arguments that are not options, and the values of `--option=value`."""
    out, rest = [], False
    for arg in args:
        if rest or (not arg.startswith("-") and arg != "-"):
            out.append(arg)
        elif arg == "--":
            rest = True
        elif arg.startswith("--") and "=" in arg:
            out.append(arg.split("=", 1)[1])
    return out


def in_place(name: str, args: list[str]) -> bool:
    if name in ("awk", "gawk"):
        return "inplace" in args or "--include=inplace" in args
    return any(re.match(r"^-[a-zA-Z]*i", arg) or arg.startswith("--in-place") for arg in args)


WRITE_SHAPED = REMOVERS | WRITERS | CHANGERS | COPIERS | SHELLS | POWERSHELLS | INTERPRETERS | {"ln", "dd", "eval"}


def write_shaped(words: list[str]) -> bool:
    name, args = program(words)
    if name == "xargs":
        return write_shaped(xargs_command(args))
    return name in WRITE_SHAPED or (name in IN_PLACE and in_place(name, args)) or (
        name == "git" and bool(set(a.lower() for a in args) & (GIT_RESTORERS | GIT_REMOVERS)))


def xargs_command(args: list[str]) -> list[str]:
    index = 0
    while index < len(args) and args[index].startswith("-"):
        index += 2 if args[index] in ("-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a") else 1
    return args[index:]


# Flags that hand an interpreter its code on the command line (python -c, node -e, cmd /c, deno eval).
INLINE_CODE = {"-c", "-e", "-E", "--eval", "-p", "--print", "-r", "/c", "/k", "-command", "eval"}


def target_directory(args: list[str]) -> str | None:
    """The folder of GNU cp/install/mv's -t DIR, -tDIR, -at DIR or --target-directory[=]DIR."""
    for index, arg in enumerate(args):
        following = args[index + 1] if index + 1 < len(args) else None
        if arg == "--":
            return None
        if arg.startswith("--target-directory="):
            return arg.split("=", 1)[1]
        if arg == "--target-directory" and following is not None:
            return following
        if re.match(r"^-[a-zA-Z]*t", arg) and not arg.startswith("--"):
            rest = arg[arg.index("t") + 1:]
            if rest:
                return rest
            if following is not None:
                return following
    return None


def copier_writes(name: str, args: list[str], cwd: str, fence: list[str], gnu: bool = True) -> bool:
    """Whether a copy, move or link writes the fence. `gnu`: Unix options (not PowerShell's)."""
    positional = plain(args)
    lowered = [arg.lower() for arg in args]
    directory = target_directory(args) if gnu and name in ("cp", "install", "ln", "mv") else None
    into = directory is not None
    if "-destination" in lowered and lowered.index("-destination") + 1 < len(args):
        directory = args[lowered.index("-destination") + 1]
    if directory is not None:
        dest, sources = directory, [p for p in positional if p != directory]
    elif len(positional) >= 2:
        dest, sources = positional[-1], positional[:-1]
    else:
        return False
    if hits(dest, cwd, fence):
        return True
    resolved = expand(dest, cwd)
    into = into or len(sources) > 1 or dest.endswith(("/", "\\")) or name == "rsync" or bool(
        resolved and os.path.isdir(resolved))
    if not into:
        return False
    # cp --parents and rsync -R keep each source's whole path below the destination
    keeps_path = "--parents" in args or (name == "rsync" and any(
        arg == "--relative" or re.fullmatch(r"-[a-zA-Z]*R[a-zA-Z]*", arg) for arg in args))
    for source in sources:
        clean = source.replace("\\", "/").rstrip("/")
        base = clean.rsplit("/", 1)[-1]
        if keeps_path:
            kept = clean.split("/./", 1)[-1] if "/./" in clean else clean
            kept = re.sub(r"^(?:\./|/)+", "", kept)
            if kept and hits(f"{dest.rstrip('/')}/{kept}", cwd, fence, whole=True):
                return True
        elif base in (".", "") or source.endswith("/") and name == "rsync":
            # the source's contents land in the destination itself
            if resolved and fenced(resolved, fence, whole=True):
                return True
        elif hits(f"{dest.rstrip('/')}/{base}", cwd, fence, whole=True):
            return True
    return name == "rsync" and any(arg.startswith("--delete") for arg in args) and bool(
        resolved and fenced(resolved, fence, whole=True))


def find_writes(args: list[str], cwd: str, fence: list[str], text: str) -> bool:
    """Whether a `find` deletes or runs a writing command on a fenced file."""
    writes = "-delete" in args or any(arg.startswith("-fprint") or arg == "-fls" for arg in args)
    for index, arg in enumerate(args):
        if arg in ("-exec", "-execdir", "-ok", "-okdir"):
            writes |= write_shaped([a for a in args[index + 1:] if a not in (";", "+", "{}")])
    if not writes:
        return False
    if names_fence(text, cwd, fence):
        return True
    starts = []
    for arg in args:
        if arg.startswith("-") or arg in ("(", "!", ")"):
            break
        starts.append(arg)
    filters = {"-name": [], "-iname": [], "-path": [], "-ipath": [], "-wholename": [], "-regex": [], "-iregex": []}
    for index, arg in enumerate(args[:-1]):
        if arg in filters:
            filters[arg].append(args[index + 1])
    negated = any(arg in ("!", "-not") for arg in args)
    for start in starts or ["."]:
        root = expand(start, cwd)
        if root is None or not fenced(root, fence, whole=True):
            continue
        if negated or not any(filters.values()):
            return True
        shown_root = start.replace("\\", "/").rstrip("/") or "/"
        below = [item for item in fence if item.startswith(root.rstrip("/") + "/")]
        for item in list(below):
            if os.path.isdir(item):
                below += [f"{item}/{child}".replace("\\", "/") for child in os.listdir(item)]
            below += [parent for parent in parents(item) if parent.startswith(root.rstrip("/") + "/")]
        for item in below:
            shown = shown_root + item[len(root.rstrip("/")):]
            base = item.rsplit("/", 1)[-1]
            if any(fnmatch.fnmatchcase(base, p) for p in filters["-name"]) or any(
                    fnmatch.fnmatchcase(base.lower(), p.lower()) for p in filters["-iname"]) or any(
                    fnmatch.fnmatchcase(shown, p) for p in filters["-path"] + filters["-wholename"]) or any(
                    fnmatch.fnmatchcase(shown.lower(), p.lower()) for p in filters["-ipath"]):
                return True
            for pattern in filters["-regex"] + filters["-iregex"]:
                try:
                    if re.fullmatch(pattern, shown, re.I if pattern in filters["-iregex"] else 0):
                        return True
                except re.error:
                    return True
    return False


def work_root(folder: str) -> str:
    """The root of the work tree holding `folder` (where `git -C folder` resolves `:/` paths)."""
    path = folder
    while True:
        if os.path.exists(path + "/.git"):
            return path
        parent = os.path.dirname(path)
        if parent == path or parent == "":
            return folder
        path = parent


def pathspec(word: str, base: str) -> tuple[str, str] | None:
    """A git pathspec as (path, the folder it is relative to); None for an exclusion. Magic such
    as `:(top)`, `:/`, `:(literal)` and `:(icase)` is read the way git reads it."""
    if not word.startswith(":"):
        return word, base
    long = re.match(r"^:\(([^)]*)\)(.*)$", word, re.S)
    if long:
        magic = {item.strip().lower().split(":", 1)[0] for item in long.group(1).split(",")}
        if "exclude" in magic:
            return None
        top, rest = "top" in magic, long.group(2)
        rest = rest.lower() if "icase" in magic else rest
    else:
        short = re.match(r"^:([/!^]*):?(.*)$", word, re.S)
        if "!" in short.group(1) or "^" in short.group(1):
            return None
        top, rest = "/" in short.group(1), short.group(2)
    return rest, work_root(base) if top else base


def git_writes(args: list[str], cwd: str, fence: list[str]) -> bool:
    base, index = cwd, 0
    while index < len(args) and args[index].startswith("-"):
        if args[index] in ("-C", "--work-tree") and index + 1 < len(args):
            base = expand(args[index + 1], cwd) or cwd
            index += 2
        elif args[index] in ("-c", "--git-dir", "--namespace") and index + 1 < len(args):
            index += 2
        else:
            index += 1
    if index >= len(args):
        return False
    sub, rest = args[index].lower(), args[index + 1:]
    if "--cached" in rest or (sub == "restore" and "--staged" in rest and "--worktree" not in rest
                              and "-W" not in rest):
        return False  # the index only
    if sub == "reset" and not set(rest) & {"--hard", "--merge", "--keep"}:
        return False
    if sub in GIT_RESTORERS:
        # A path that is or holds a fenced file is refused (`git restore .claude`). The whole tree
        # (`git checkout -- .`) is left alone when it is restored from the index, which cannot hold
        # a fence change the factory could not write; from another commit it is refused too.
        if "--" in rest:
            before, paths = rest[:rest.index("--")], rest[rest.index("--") + 1:]
            source = sub == "checkout" and bool(plain(before))
        else:
            paths = plain(rest)
            source = sub == "checkout" and len(paths) >= 2
            paths = paths[1:] if source else paths
        source = source or any(arg in ("-s", "--source") or arg.startswith("--source=") for arg in rest)
        for spec in filter(None, (pathspec(word, base) for word in paths)):
            word, folder = spec
            path = expand(word, folder)
            whole_tree = path is not None and any(
                root == path.rstrip("/") or root.startswith(path.rstrip("/") + "/") for root in repo_roots())
            if hits(word, folder, fence, whole=source or not whole_tree):
                return True
        return False
    if sub in GIT_REMOVERS:
        return any(hits(spec[0], spec[1], fence, whole=True)
                   for spec in filter(None, (pathspec(word, base) for word in plain(rest))))
    return False


def command_writes(words: list[str], cwd: str, fence: list[str], text: str, posix: bool, depth: int) -> str | None:
    """Judge one simple command. Returns the working folder after it, or refuses."""
    name, args = program(words)
    positional = plain(args)
    lowered = [arg.lower() for arg in args]
    blocked = False
    if not name:
        return cwd
    if name in ("cd", "pushd", "set-location", "sl", "chdir"):
        if positional and positional[0] != "-":
            return expand(positional[0], cwd) or cwd
        return normal("~") if name == "cd" and not positional else cwd
    if name in SHELLS | POWERSHELLS:
        for index, arg in enumerate(args):
            # bash -c, -lc, -ec ...; pwsh -c / -Command
            flag = (re.fullmatch(r"-[a-zA-Z]*c[a-zA-Z]*", arg) if name in SHELLS
                    else arg.lower() in ("-c", "-command", "/c"))
            code = next((rest for rest in args[index + 1:] if not rest.startswith("-")), None)
            if flag and code is not None:
                check_writes(code, cwd, fence, name in SHELLS, depth + 1)
                break
        return cwd
    if name == "eval":
        check_writes(" ".join(args), cwd, fence, posix, depth + 1)
        return cwd
    if name == "xargs":
        inner = xargs_command(args)
        blocked = write_shaped(inner) and names_fence(text, cwd, fence)
        if not blocked and inner:
            command_writes(inner, cwd, fence, text, posix, depth)
    elif name == "find":
        blocked = find_writes(args, cwd, fence, text)
    elif name == "git":
        blocked = git_writes(args, cwd, fence)
    elif name in ("tar", "bsdtar", "unzip", "7z", "7za"):
        # an archive's contents cannot be known; extracting one that names the fence counts
        extracts = name == "unzip" or (name.startswith("7z") and args[:1] == ["x"]) or any(
            arg in ("--extract", "--get") or re.fullmatch(r"-?[A-Za-z]*x[A-Za-z]*", arg)
            for arg in args[:1]) or any(re.fullmatch(r"-[A-Za-z]*x[A-Za-z]*", arg) for arg in args)
        blocked = extracts and names_fence(" ".join(args), cwd, fence)
    elif name == "dd":
        blocked = any(arg.startswith("of=") and hits(arg[3:], cwd, fence) for arg in args)
    elif name in ("mv", "move-item", "mi", "move"):
        # the sources go away with all they hold; the destination is written like a copy's
        into = target_directory(args) if name == "mv" and posix else None
        lowered_args = [arg.lower() for arg in args]
        if "-destination" in lowered_args and lowered_args.index("-destination") + 1 < len(args):
            into = args[lowered_args.index("-destination") + 1]
        sources = [word for word in positional if word != into] if into else positional[:-1]
        blocked = any(hits(word, cwd, fence, whole=True) for word in sources) or copier_writes(
            "mv", args, cwd, fence, posix)
    elif name in REMOVERS:
        blocked = any(hits(word, cwd, fence, whole=True) for word in positional)
    elif name in WRITERS:
        blocked = any(hits(word, cwd, fence) for word in positional)
    elif name in CHANGERS:
        recursive = any(arg == "--recursive" or re.match(r"^-[a-zA-Z]*R", arg) for arg in args)
        blocked = any(hits(word, cwd, fence, whole=recursive) for word in positional)
    elif name in COPIERS:
        blocked = copier_writes(name, args, cwd, fence, posix)
    elif name == "ln":
        # only the link is written; a later write through a link is caught by following it
        blocked = copier_writes(name, args, cwd, fence, posix)
    if not blocked and name in IN_PLACE and in_place(name, args):
        blocked = any(hits(word, cwd, fence) for word in positional)
    if not blocked and name in INTERPRETERS and set(lowered) & INLINE_CODE:
        blocked = names_fence(" ".join(args), cwd, fence)
    if not blocked:
        # an output file: --output FILE or --output=FILE for any program; -o / -O only for programs
        # where it names one (grep -o and rg -o only print what matched)
        short = ("-o", "-O") if name in OUTPUT_FLAG_PROGRAMS else ()
        for index, arg in enumerate(args):
            value = args[index + 1] if arg in short + ("--output", "--output-file", "--out") and index + 1 < len(
                args) else arg.split("=", 1)[1] if re.match(r"^--(?:output|output-file|out)=", arg) else None
            if value is not None and hits(value, cwd, fence):
                blocked = True
    if blocked:
        refuse(f"`{' '.join(words)[:80]}` would change the fence, which only changes by hand")
    return cwd


def heredoc_readers(header: str, posix: bool) -> set[str]:
    """What reads a heredoc's body as code: a shell, PowerShell, or another interpreter or patch."""
    try:
        found = [program(words) for words, _ in commands(lex(header, posix))]
    except ValueError:
        found = [(word.lower(), []) for word in re.findall(r"[\w.-]+", header)]
    kinds = set()
    for name, args in found:
        if name in SHELLS:
            kinds.add("shell")
        elif name in POWERSHELLS:
            kinds.add("powershell")
        elif name in INTERPRETERS or name in IN_PLACE or name == "patch" or (
                name == "git" and bool(set(args) & {"apply", "am"})):
            kinds.add("code")
    return kinds


def check_writes(command: str, cwd: str, fence: list[str], posix: bool, depth: int = 0) -> None:
    """Refuse a shell command that would write to the fence. Reading or naming it is fine."""
    if depth > 6:
        if FENCE.search(command.replace("\\", "/")):
            refuse("the command nests too deep to check and names the fence")
        return
    flat, docs, subs = scan(command, posix)
    # The command line first: it says which folders the command passes through (`cd`), and the
    # substitutions and heredocs are then judged in each of them.
    folders = [cwd]
    try:
        tokens = lex(flat, posix)
    except ValueError:
        if FENCE.search(flat.replace("\\", "/")) and MUTATES.search(flat):
            refuse("the command could not be read, writes, and names the fence")
        tokens = []
    for words, targets in commands(tokens):
        for target in targets:
            if hits(target, cwd, fence):
                refuse(f"`> {target[:80]}` would change the fence, which only changes by hand")
        cwd = command_writes(words, cwd, fence, flat, posix, depth) or cwd
        if cwd not in folders:
            folders.append(cwd)
    for folder in folders:
        for header, body in docs:
            kinds = heredoc_readers(header, posix)
            if "shell" in kinds:
                check_writes(body, folder, fence, True, depth + 1)
            if "powershell" in kinds:
                check_writes(body, folder, fence, False, depth + 1)
            if "code" in kinds and names_fence(body, folder, fence):
                refuse(f"a script fed to `{header.strip()[:60]}` names the fence, which only changes by hand")
        for sub in subs:
            check_writes(sub, folder, fence, posix, depth + 1)


def pre(event: dict) -> None:
    tool = event.get("tool_name", "")
    tool_input = event.get("tool_input") or {}
    text = json.dumps(tool_input).replace("\\\\", "/")
    holdout_agent = event.get("agent_type") in HOLDOUT_AGENTS
    if tool in WRITE_TOOLS or tool in SHELL_TOOLS:
        fence = fence_paths()
        here = normal(event.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
        if tool in WRITE_TOOLS:
            for key in ("file_path", "notebook_path"):
                value = tool_input.get(key)
                if isinstance(value, str) and value and hits(value, here, fence):
                    refuse(f"`{value}` is part of the fence, which only changes by hand")
        else:
            check_writes(str(tool_input.get("command") or ""), here, fence, tool == "Bash")
    if holdout_agent or tool not in ACCESS_TOOLS:
        return
    if tool in ("Agent", "Task") and tool_input.get("subagent_type") in HOLDOUT_AGENTS:
        return
    if NAMED.search(text):
        refuse("the call names the holdout folder")
    if tool in SHELL_TOOLS:
        root = normal(os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or os.getcwd())
        cwd = normal(event.get("cwd") or root)
        check_shell(tool_input.get("command", ""), cwd, f"{root}/{FOLDER}", tool == "Bash")


def strings(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for item in value.values() for s in strings(item)]
    if isinstance(value, list):
        return [s for item in value for s in strings(item)]
    return []


def squash(text: str) -> str:
    return " ".join(text.lower().split())


def post(event: dict) -> None:
    if event.get("agent_type") in HOLDOUT_AGENTS:
        return
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or os.getcwd())
    scenarios = root / FOLDER / "HOLDOUT.md"
    if not scenarios.is_file():
        return
    current, prints = "", {}
    for line in scenarios.read_text(encoding="utf-8", errors="replace").splitlines():
        heading = re.match(r"^#{2,3}\s+(\S+)", line)
        if heading:
            current = heading.group(1)
        flat = squash(line.lstrip("#"))
        if len(flat) >= 40:
            prints[flat] = current
    seen = squash("\n".join(strings(event.get("tool_response"))))
    hits = sorted({scenario for flat, scenario in prints.items() if flat in seen})
    if not hits:
        return
    common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=root, capture_output=True,
                            text=True, timeout=20).stdout.strip()
    log = (root / common if common else root / ".git") / "holdout-exposures.jsonl"
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                 "session": event.get("session_id", ""), "agent": event.get("agent_type", ""),
                                 "tool": event.get("tool_name", ""), "scenarios": hits}) + "\n")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "pre"
    try:
        event = json.load(sys.stdin)
        (post if mode == "post" else pre)(event)
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001 - any failure must refuse, never let the call through
        if mode == "post":
            sys.exit(0)
        refuse(f"the fence could not check this call ({type(error).__name__}: {error})")
    sys.exit(0)


if __name__ == "__main__":
    main()
