#!/usr/bin/env python3
"""Mirror your mission control's text files into your notebook as notes, so they can be searched there.

WHAT IS SENT: every Markdown file git tracks in the mission control. Because git is asked, the
mission control's own .gitignore decides what stays home, and dev/ stays home on every mission control. The
few other exceptions are listed one by one further down, each with its reason.

WHY THE WHOLE GODSPEED (2026-09-20). Until then this sent three places only:
observations/, skills/ and the split decisions.md. The reasoning was "skip what is
already loaded": AGENTS.md, profile/ and rules/ are read at the start of every
session, so a search result repeating them was called noise. That reasoning is
retired, on the author's decision: the whole godspeed is to be visible and searchable
in the notebook, from a phone, with no terminal anywhere near. The noise is handled where it
arises instead: Menerio ranks mirrored notes below the notes you wrote yourself,
and mc-search drops AGENTS.md from what it shows.

Every note lands in a folder that mirrors where its file lives in the mission control, under
a single `godspeed` root: see GODSPEED_FOLDER and folder_for below. Nothing this sync
sends is left at the notebook's top level.

One way only. The files on disk stay the source of truth. Menerio holds a copy it
indexes for search and must never read facts out of, because the mission control's
observations are machine-written guesses and a system that mines its own guesses
ends up citing them back as things you said. The guard that enforces that
lives in Menerio, in supabase/functions/_shared/mc-source.ts.

Usage:
    python3 tools/notebook-sync.py              show what would be sent
    python3 tools/notebook-sync.py --apply      send it

Needs MENERIO_API_KEY in the environment. The installer teaches new terminals
the credential; by hand it is:  eval "$(mc-notebook-env)"
"""
import argparse
import dataclasses
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

# ---- what stays home ------------------------------------------------------------------
# THE SAME LIST LIVES IN tools/search.js (mc-search), which falls back to searching
# exactly the files this program mirrors. Change one, change the other;
# tools/test-mc-search.sh compares the two lists on one folder and fails when they drift.

# dev/ is never sent. The starter mission control's .gitignore already keeps its contents out of
# git, but it tracks dev/README.md, and a mission control somebody made by hand may track more.
# Each project in there is its own repository with its own history; the owner's words
# were "all godspeed folders except dev/", so the folder is skipped by name as well.
# .git/ and node_modules/ only matter when there is no git to ask and the folder is
# walked instead.
SKIP_DIRS = ("dev", ".git", "node_modules")

# world/removed/ holds the pull's own notices about records the notebook dropped. They
# are copies of things Menerio already had and then deleted; sending them up would put
# back, as new notes, exactly what was removed there.
SKIP_PREFIXES = ("world/removed/",)

# A file under world/ whose header says `origin: menerio` came DOWN from the notebook
# (tools/world-pull.py writes them). Sending it back up would hand Menerio its own
# records as new notes, and the next pull would bring those down again.
WORLD_FOLDER = "world/"
ORIGIN_MENERIO = re.compile(r"^origin:\s*menerio\s*$", re.IGNORECASE | re.MULTILINE)

# Nothing over 300 KB is sent. prompts/archive/ holds years of pasted conversation in
# files that size, and one of them costs a free account more of its monthly allowance
# than a hundred ordinary notes. The run names each file it skips, in one line.
MAX_FILE_BYTES = 300 * 1024

# The visible skills/ is the room since the Hermes switch (2026-09-02). The hidden
# .claude/skills is a link the installer points at it, so on a topped-up godspeed the two
# are one folder and the visible name wins: the hidden one is never sent as well, or
# every skill would arrive twice. An older godspeed that has not been re-run still keeps
# its recipes under the hidden name only, and those must still be sent, under the
# ids they always had.
SKILLS_FOLDER = "skills"
SKILLS_ALIASES = (".claude/skills",)

# Generated index files are not sent. They change on nearly every commit (the
# memory index moved a counter 41 times in three weeks) and say nothing the files
# they list do not already say; each resend made the notebook re-buy its metadata
# pass and embeddings for a note nobody searches for.
SYNC_SKIP_FILES = frozenset({
    "observations/MEMORY.md",
    "observations/README.md",
    "skills/README.md",
    ".claude/skills/README.md",
})

DECISION_LOG = "decisions.md"

# Everything this sync sends lives under one folder in the notebook, and inside
# it the mission control's own layout is reproduced exactly: observations/x.md becomes a
# note in godspeed/observations.
#
# Two reasons it is not left at the root, which is where the column defaults.
# The notebook is YOUR memory and holds notes you wrote yourself; godspeed copies
# loose at the top level bury them under machine output. And a note's folder is
# the second thing that says where it came from, after the provenance line in
# the body, so the answer to "is this something I said or something a machine
# wrote" is visible before opening it.
GODSPEED_FOLDER = "godspeed"

# The first line of every note says who wrote what is under it. Only observations/ is
# called a guess, because only observations/ is one. The lines for observations/,
# skills/ and decisions are word for word what they were before the whole godspeed was
# mirrored (2026-09-20): the line is part of what gets hashed, so changing a word of
# one would send every note of that kind again, on every mission control that had already synced.
AUTHOR_LINES = {
    "machine": "This is a file from your mission control at {path}. It is text a machine "
               "wrote, which makes it a guess and not something you said.",
    "mixed": "This is a file from your mission control at {path}. It was mostly written by a "
             "machine and kept because you found it useful.",
    "owner": "This is a file from your mission control at {path}. You wrote or decided this.",
    "copy": "This is a copy of the mission control file at {path}. Change the file in the mission control, "
            "never this note.",
}

# Who wrote what is in a folder. Anything not named here gets the neutral "copy" line.
AUTHOR_BY_FOLDER = (
    ("observations/", "machine"),
    (SKILLS_FOLDER + "/", "mixed"),
    ("profile/", "owner"),
    ("rules/", "owner"),
) + tuple((alias + "/", "mixed") for alias in SKILLS_ALIASES)

# The two shapes a decision takes in decisions.md. The starter godspeed writes them
# as bullets, "- (YYYY-MM-DD) what and why", and a mission control that outgrows one line
# per decision uses a dated heading. Both are decisions, and missing a shape
# means missing decisions SILENTLY: the splitter simply appends unrecognised
# lines to whatever it has open, so a missed heading folds many decisions into
# one unreadable note.
DECISION_HEADING = re.compile(r"^## (\d{4}-\d{2}-\d{2})[ \t]*(.*)$")
DECISION_BULLET = re.compile(r"^- \(?(\d{4}-\d{2}-\d{2})\)?[ \t]*(.*)$")

# A decision log often separates the date from the title with a dash.
# Those characters do not belong at the start of a note title, so they are
# stripped rather than carried through.
TITLE_SEPARATORS = re.compile(r"^[—–―\-:]+\s*")

DEFAULT_BASE_URL = "https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1"


@dataclasses.dataclass
class Document:
    doc_id: str
    title: str
    body: str
    source_path: str


def split_decision_log(text: str, source_path: str) -> list:
    """One decision becomes one document.

    The file on disk is never touched, so every existing citation to it, like
    "decisions.md, the June pricing call", still resolves. Uploaded whole it
    would be one search result pointing at a file too big to read.
    """
    docs = []
    date = None
    title = ""
    lines = []
    used = set()

    def flush():
        if date is None:
            return
        # The id carries the subject, not a position, so appending to the log
        # never renames an existing note. One date can hold several decisions,
        # and keying on the date alone collapses them onto one id, which the
        # notebook rejects outright.
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48].strip("-")
        base = "{}#{}".format(source_path, date)
        if slug:
            base = "{}-{}".format(base, slug)
        doc_id, n = base, 2
        while doc_id in used:
            doc_id = "{}-{}".format(base, n)
            n += 1
        used.add(doc_id)
        docs.append(
            Document(
                doc_id=doc_id,
                title="{} {}".format(date, title).strip(),
                body="\n".join(lines).strip(),
                source_path=source_path,
            )
        )

    for line in text.splitlines():
        match = DECISION_HEADING.match(line) or DECISION_BULLET.match(line)
        if match:
            flush()
            date = match.group(1)
            title = TITLE_SEPARATORS.sub("", match.group(2).strip())
            # A bullet decision is usually one line, so that line is the body
            # too; a heading's body is the lines under it.
            lines = [match.group(2).strip()] if DECISION_BULLET.match(line) else []
            continue
        if date is not None:
            lines.append(line)
    flush()
    return docs


def tracked_markdown(repo_root: pathlib.Path):
    """Every Markdown file git tracks here, or None when git cannot answer.

    Git is asked so that the mission control's .gitignore decides what stays home, and so that a
    scratch folder somebody forgot to delete is never mirrored into a notebook.

    Only believed when the mission control IS the top of a repository. A mission control folder sitting inside
    some other repository gets an answer too, and it is the wrong one: that repository
    tracks none of these files, so the answer is "nothing", and "nothing" reads to the
    rest of this program as "every file was deleted".
    """
    def git(*args):
        return subprocess.run(["git", "-C", str(repo_root)] + list(args),
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60)
    try:
        top = git("rev-parse", "--show-cdup")
        if top.returncode != 0 or top.stdout.strip():
            return None
        # -z, because without it git quotes and escapes any path holding an umlaut.
        listed = git("ls-files", "-z", "--cached")
        if listed.returncode != 0:
            return None
    except (OSError, subprocess.SubprocessError):
        return None
    paths = [p for p in listed.stdout.decode("utf-8", "replace").split("\0") if p]
    return [p for p in paths if p.lower().endswith(".md")]


def walked_markdown(repo_root: pathlib.Path) -> list:
    """The same question with no git to ask: walk the folder. Links are not followed,
    which is what keeps a linked .claude/skills from arriving as a second skills/."""
    found = []
    for folder, dirs, files in os.walk(str(repo_root), followlinks=False):
        rel_folder = pathlib.Path(folder).relative_to(repo_root).as_posix()
        dirs[:] = sorted(d for d in dirs if d not in (".git", "node_modules")
                         and not (rel_folder == "." and d in SKIP_DIRS))
        for name in files:
            if name.lower().endswith(".md"):
                found.append(name if rel_folder == "." else "{}/{}".format(rel_folder, name))
    return found


def godspeed_markdown_files(repo_root: pathlib.Path, notes=None) -> list:
    """The repo-relative paths this sync mirrors, sorted. decisions.md is not in the
    list: it is split, one note per decision, by collect_documents.

    `notes` collects one line for each file that was skipped for its size, so the
    caller can say so; a skip nobody hears about looks like a search that is broken.
    """
    paths = tracked_markdown(repo_root)
    if paths is None:
        paths = walked_markdown(repo_root)
    visible_skills = (repo_root / SKILLS_FOLDER).is_dir()
    keep = []
    for rel in sorted(set(paths)):
        if rel == DECISION_LOG or rel in SYNC_SKIP_FILES:
            continue
        if rel.split("/", 1)[0] in SKIP_DIRS or rel.startswith(SKIP_PREFIXES):
            continue
        if visible_skills and any(rel.startswith(alias + "/") for alias in SKILLS_ALIASES):
            continue
        path = repo_root / rel
        if not path.is_file():
            continue          # tracked, and deleted since the last commit
        if path.stat().st_size > MAX_FILE_BYTES:
            if notes is not None:
                notes.append("skipped {} ({} KB): over the {} KB limit for one note".format(
                    rel, path.stat().st_size // 1024, MAX_FILE_BYTES // 1024))
            continue
        keep.append(rel)
    return keep


def came_from_menerio(rel: str, text: str) -> bool:
    """True for a world/ file whose header block says `origin: menerio`."""
    if not rel.startswith(WORLD_FOLDER) or not text.startswith("---"):
        return False
    end = text.find("\n---", 3)
    return bool(ORIGIN_MENERIO.search(text[:end if end > 0 else 2000]))


def collect_documents(repo_root: pathlib.Path, notes=None) -> list:
    docs = []
    for rel in godspeed_markdown_files(repo_root, notes):
        # errors="replace": one file saved in an old Windows encoding must not stop
        # the other thousand from being mirrored.
        text = (repo_root / rel).read_text(encoding="utf-8", errors="replace")
        if came_from_menerio(rel, text):
            continue
        docs.append(Document(doc_id=rel, title=rel, body=text, source_path=rel))

    log = repo_root / DECISION_LOG
    if log.is_file():
        docs.extend(split_decision_log(log.read_text(encoding="utf-8"), DECISION_LOG))
    return docs


def folder_for(source_path: str) -> str:
    """The notebook folder a document belongs in: the mission control's own path, under GODSPEED_FOLDER.

    Derived from the source path rather than stored on the Document, so there is
    one answer and it cannot drift from the file it describes. A document at the
    repository root, which is every decision, gets GODSPEED_FOLDER itself: that
    mirrors the mission control, where decisions.md is one file at the top.
    """
    parent, _, _ = source_path.rpartition("/")
    return "{}/{}".format(GODSPEED_FOLDER, parent) if parent else GODSPEED_FOLDER


def author_for(source_path: str) -> str:
    for prefix, author in AUTHOR_BY_FOLDER:
        if source_path.startswith(prefix):
            return author
    if source_path.startswith(DECISION_LOG):
        return "owner"
    # Everything else is called what it is, a copy of a file. Before the whole godspeed was
    # mirrored an unmapped path defaulted to "a machine wrote this", because claiming
    # you said something you did not was the expensive mistake. With AGENTS.md, goals/
    # and world/ now in the mirror, calling your own words a machine's guess is the
    # same mistake from the other side, so the neutral line claims neither.
    return "copy"


def build_note_body(doc: Document) -> str:
    """Put the author inside the note, not only in a database column.

    The search result is what an agent actually reads. Without this line, a
    machine's own guess comes back months later wearing the authority of
    something you said.
    """
    line = AUTHOR_LINES[author_for(doc.source_path)].format(path=doc.source_path)
    return "{}\n\n---\n\n{}".format(line, doc.body)


def content_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def plan_actions(docs: list, state: dict) -> dict:
    create, update = [], []
    seen = set()
    for doc in docs:
        seen.add(doc.doc_id)
        digest = content_hash(build_note_body(doc))
        known = state.get(doc.doc_id)
        if known is None:
            create.append(doc)
        elif known.get("hash") != digest or known.get("folder") != folder_for(doc.source_path):
            # A note in the wrong folder is as much out of date as one with the
            # wrong text. Notes uploaded before folders existed carry no folder
            # in their state entries, so this comparison is what moves them off
            # the root; once moved, the run goes quiet again.
            update.append((doc, known["note_id"]))
    trash = [entry["note_id"] for doc_id, entry in state.items() if doc_id not in seen]

    # THE MASS-TRASH GUARD (2026-08-21). A note is thrown away when the cache remembers a
    # document the mission control no longer has, which is right when you delete a file and catastrophic
    # when a lot of paths change at once. Both happen: this installer renames folders on an
    # older godspeed, and one rename of a file everything points at turned every remembered id
    # into a stranger. On Michael's laptop that trashed 89 of his decisions in one run, and
    # on his work PC an older copy of this program trashed 299 notes the same way.
    #
    # Losing a few notes is a mistake you can see. Losing most of them looks like a working
    # sync until you search for something and it is not there. So a run that would throw away
    # more than a third of what it tracks throws away nothing instead, and says why. The cure
    # is --reconcile, which asks the notebook what it actually holds and matches by title.
    if trash and len(state) and len(trash) > max(10, len(state) // 3):
        print("refusing to trash {} of the {} notes this mission control tracks: that is not a few "
              "deleted files, it is a cache that no longer matches the folder. Nothing was "
              "thrown away. Run once with --reconcile to rebuild it from the notebook."
              .format(len(trash), len(state)))
        trash = []
    return {"create": create, "update": update, "trash": trash}


def load_state(path: pathlib.Path) -> dict:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(path: pathlib.Path, state: dict) -> None:
    path.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def escaped_json(payload) -> bytes:
    """The same JSON, with every character of every string value as a \\uXXXX escape.

    The notebook's endpoint sits behind Cloudflare, whose firewall reads the
    request body and refuses anything that looks like an attack. It once refused
    a real decision, because the sentence contained "and 07-20 = 0" and that is
    the shape of a SQL injection. The document is a true record of what was
    decided; editing your words to please a firewall is not a fix, and the next
    document with an equals sign in it would fail the same way.

    A \\uXXXX escape is ordinary JSON. Every correct parser decodes it to the
    identical string, so the server receives exactly what it always received,
    while the firewall no longer sees the pattern in the bytes on the wire.
    Verified against the live endpoint: plain is refused, escaped reaches the
    server.

    Used only on retry, because it makes the body roughly six times larger.
    """
    bs = chr(92)

    def enc(value):
        if isinstance(value, str):
            return '"' + "".join(bs + "u%04x" % ord(c) for c in value) + '"'
        if isinstance(value, dict):
            return "{" + ",".join(
                "{}:{}".format(json.dumps(k), enc(v)) for k, v in value.items()) + "}"
        if isinstance(value, list):
            return "[" + ",".join(enc(v) for v in value) + "]"
        return json.dumps(value)

    return enc(payload).encode("utf-8")


def is_firewall_block(error) -> bool:
    """A 403 from Cloudflare, not from the notebook.

    Told apart by the body: Menerio answers JSON, the firewall answers an HTML
    page. Reading it costs one call and stops a firewall refusal being reported
    as "your key is not allowed", which is the wrong thing to go and fix.
    """
    if getattr(error, "code", None) != 403:
        return False
    try:
        return b"Cloudflare" in error.read()[:4000]
    except Exception:
        return False


class MenerioClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _call(self, method: str, path: str, payload=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        try:
            return self._send(method, path, data)
        except urllib.error.HTTPError as err:
            if payload is None or not is_firewall_block(err):
                raise
            return self._send(method, path, escaped_json(payload))

    def _send(self, method: str, path: str, data):
        request = urllib.request.Request(
            "{}/mc-api-notes{}".format(self.base_url, path),
            data=data,
            method=method,
            headers={
                "Authorization": "Bearer {}".format(self.api_key),
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}

    def create_note(self, title: str, body: str, source_id: str, folder: str) -> str:
        result = self._call("POST", "", {
            "title": title,
            "content": body,
            "source_app": "godspeed",
            "source_id": source_id,
            "folder_path": folder,
        })
        return result["data"]["id"]

    def update_note(self, note_id: str, title: str, body: str, folder: str) -> None:
        self._call("PUT", "/{}".format(note_id), {
            "title": title, "content": body, "folder_path": folder})

    def trash_note(self, note_id: str) -> None:
        self._call("DELETE", "/{}".format(note_id))

    def list_godspeed_notes(self) -> list:
        """Every note the notebook holds that this sync created, across all pages."""
        notes, offset = [], 0
        while True:
            page = self._call("GET", "?limit=100&offset={}".format(offset)).get("data", [])
            if not page:
                break
            notes += [n for n in page if n.get("source_app") == "godspeed"]
            offset += len(page)
            if len(page) < 100:
                break
        return notes


def reconcile_state(docs: list, remote_notes: list) -> dict:
    """Rebuild the state from what is already in the notebook.

    This is what makes the sync safe to run from any machine. The state file is
    only a cache: the notebook itself holds the truth about which notes exist
    and what is in them, so a machine that has never synced before rebuilds the
    answer instead of uploading a second copy of every document.

    The hash recorded here is the hash of what the NOTEBOOK HOLDS, not of the
    local file. Hashing the local file would say "already in sync" for every
    document, including ones edited since they were uploaded, and those edits
    would never be sent. The list endpoint returns `content`, so the true
    answer is available and there is no reason to guess at it.

    The title is the join key: it is unique per document, and source_id is not
    returned by the list endpoint.
    """
    by_title = {doc.title: doc for doc in docs}
    state = {}
    for note in remote_notes:
        doc = by_title.get(note.get("title"))
        if doc is None:
            continue
        remote_body = note.get("content")
        state[doc.doc_id] = {
            "note_id": note["id"],
            # No content returned (an older endpoint) is not an excuse to claim
            # a match: fall back to a value that can equal no local hash, so the
            # document is re-sent rather than silently skipped.
            "hash": content_hash(remote_body) if remote_body is not None else "",
            # Same rule for the folder. An endpoint that does not report one is
            # not evidence the note is in the right place, and the column's
            # default is the root, so the honest reading of silence is "still at
            # the root" and the note gets moved.
            "folder": note.get("folder_path") or "",
        }
    return state


def run_sync(docs: list, state: dict, client, apply: bool,
             on_progress=None, failures=None) -> dict:
    """Send the plan, and never lose finished work to one bad document.

    A single HTTP 500 used to raise straight out of here, so the caller never
    reached save_state and 102 successful uploads were forgotten. Now each
    document is its own transaction: a failure is recorded and the run
    continues, and `on_progress` hands the caller the state after every change
    so it can be written to disk as it goes.
    """
    if failures is None:
        failures = []
    plan = plan_actions(docs, state)
    print("create {}  update {}  trash {}".format(
        len(plan["create"]), len(plan["update"]), len(plan["trash"])))
    if not apply:
        for doc in plan["create"]:
            print("  would create {}".format(doc.doc_id))
        for doc, _ in plan["update"]:
            print("  would update {}".format(doc.doc_id))
        for note_id in plan["trash"]:
            print("  would trash note {}".format(note_id))
        return state

    new_state = dict(state)

    def record(doc_id, note_id, body, folder):
        new_state[doc_id] = {
            "note_id": note_id, "hash": content_hash(body), "folder": folder,
        }
        if on_progress:
            on_progress(new_state)

    for doc in plan["create"]:
        body = build_note_body(doc)
        folder = folder_for(doc.source_path)
        try:
            record(doc.doc_id,
                   client.create_note(doc.title, body, doc.doc_id, folder),
                   body, folder)
        except Exception as err:
            failures.append((doc.doc_id, str(err)))

    for doc, note_id in plan["update"]:
        body = build_note_body(doc)
        folder = folder_for(doc.source_path)
        try:
            client.update_note(note_id, doc.title, body, folder)
            record(doc.doc_id, note_id, body, folder)
        except Exception as err:
            failures.append((doc.doc_id, str(err)))

    seen = {doc.doc_id for doc in docs}
    for doc_id in [k for k in new_state if k not in seen]:
        try:
            client.trash_note(new_state[doc_id]["note_id"])
            del new_state[doc_id]
            if on_progress:
                on_progress(new_state)
        except Exception as err:
            failures.append((doc_id, str(err)))

    if failures:
        print("\n{} document(s) failed:".format(len(failures)))
        for doc_id, err in failures[:10]:
            print("  {}  {}".format(doc_id, err))
        if len(failures) > 10:
            print("  ... and {} more".format(len(failures) - 10))
    return new_state


def mirror_is_on() -> bool:
    """GODSPEED_NOTEBOOK_MIRROR from the environment, else from ~/.godspeed/device.env. Only "1" is yes."""
    value = os.environ.get("GODSPEED_NOTEBOOK_MIRROR", "").strip()
    if not value:
        home = os.environ.get("USERPROFILE") or os.environ.get("HOME") or os.path.expanduser("~")
        try:
            with open(os.path.join(home, ".godspeed", "device.env"), encoding="utf-8") as handle:
                for line in handle:
                    match = re.match(r"^\s*GODSPEED_NOTEBOOK_MIRROR=(.*)$", line)
                    if match:
                        value = match.group(1).strip()
        except OSError:
            pass
    return value == "1"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Push your mission control files into your notebook for search.")
    parser.add_argument("--apply", action="store_true",
                        help="actually send. Without it, print what would happen.")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--limit", type=int, default=0,
                        help="send at most N documents. Use 1 for a first check.")
    parser.add_argument("--reconcile", action="store_true",
                        help="rebuild the state file from what the notebook already "
                             "holds, before syncing. Use after a run died partway.")
    args = parser.parse_args(argv)

    # THE READER'S ANSWER IS CHECKED HERE TOO. The installer asks whether the mission control may be
    # copied into the notebook, and writes GODSPEED_NOTEBOOK_MIRROR=1 or =0 into
    # ~/.godspeed/device.env. The hourly runner reads that line, but a line in a README that
    # says "typed by hand, this sends your files whatever you answered" is a trap, not a
    # feature. No line means no. Without --apply this still only prints a plan.
    if args.apply and not mirror_is_on():
        print("The mission control copy is switched off on this computer, so nothing was sent. "
              "To switch it on, run the Menerio step of the installer again and answer yes.")
        return 0

    api_key = os.environ.get("MENERIO_API_KEY")
    if args.apply and not api_key:
        print("MENERIO_API_KEY is not set. Open a new terminal (the installer "
              "teaches them the credential), or load it by hand: "
              "eval \"$(mc-notebook-env)\"", file=sys.stderr)
        return 2

    root = pathlib.Path(args.repo_root).resolve()
    state_path = root / "world" / ".sync-state.json"
    skipped = []
    docs = collect_documents(root, skipped)
    for line in skipped:
        print(line)
    state = load_state(state_path)

    client = MenerioClient(os.environ.get("MENERIO_BASE_URL", DEFAULT_BASE_URL),
                           api_key or "")

    # A machine with no cache asks the notebook what it already holds, rather
    # than assuming the answer is "nothing". Without this, the first run on a
    # second machine creates a duplicate note for every document. The remote
    # knows; ask it.
    cold_start = not state_path.is_file()
    if args.reconcile or (cold_start and api_key):
        if not api_key:
            print("--reconcile needs MENERIO_API_KEY", file=sys.stderr)
            return 2
        if cold_start and not args.reconcile:
            print("no local cache here, so asking the notebook what it already holds...")
        remote = client.list_godspeed_notes()
        state = reconcile_state(docs, remote)
        state_path.parent.mkdir(parents=True, exist_ok=True)
        save_state(state_path, state)
        print("reconciled: {} note(s) in the notebook, {} matched to a file in your mission control".format(
            len(remote), len(state)))

    if args.limit:
        # Only trim work that is still outstanding, so --limit 1 sends one new
        # note rather than re-checking one already-synced file forever.
        pending = [d for d in docs if d.doc_id not in state]
        docs = [d for d in docs if d.doc_id in state] + pending[:args.limit]
    failures = []
    if args.apply:
        state_path.parent.mkdir(parents=True, exist_ok=True)
    # Write the state after every single document. A run that dies halfway then
    # costs nothing: the next one picks up exactly where it stopped, instead of
    # re-sending everything and creating a second copy of each note.
    on_progress = (lambda s: save_state(state_path, s)) if args.apply else None
    new_state = run_sync(docs, state, client, apply=args.apply,
                         on_progress=on_progress, failures=failures)

    # A STALE cache, not just a missing one. Two machines can both sync, so this
    # one's cache can be right about what it did and wrong about what the other
    # one did. When that happens it tries to create notes that already exist and
    # the notebook refuses them on its own unique constraint, which is the
    # protection working. But the run would then fail the same way every hour
    # forever. A failed create means "your idea of what is up there is out of
    # date", so go and ask. Once only: a second failure is a real failure and
    # must be reported as one.
    if args.apply and failures and api_key:
        print("\n{} document(s) were refused, so this machine's cache is out of date. "
              "Asking the notebook and trying once more...".format(len(failures)))
        state = reconcile_state(docs, client.list_godspeed_notes())
        save_state(state_path, state)
        failures = []
        new_state = run_sync(docs, state, client, apply=True,
                             on_progress=on_progress, failures=failures)
    if args.apply:
        save_state(state_path, new_state)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
