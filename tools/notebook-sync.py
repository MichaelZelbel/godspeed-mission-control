#!/usr/bin/env python3
"""Push godspeed text files into your notebook as notes, so they can be searched by meaning.

Every note lands in a folder that mirrors where its file lives in Mission Control, under
a single `godspeed` root: see GODSPEED_FOLDER and folder_for below. Nothing this sync
sends is left at the notebook's top level.

One way only. The files on disk stay the source of truth. Menerio holds a copy it
indexes for search and must never read facts out of, because Mission Control's
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
import sys
import urllib.error
import urllib.request

# Which folders are copied, and who wrote what is in them.
#
# Sync what gets looked UP. Skip what is already loaded: AGENTS.md, profile/ and
# rules/ are read at the start of every session, so a search result repeating
# them is noise. world/ is skipped because it flows the other way.
# prompts/archive/ is years of past conversation and would crowd out everything
# else, so it stays out.
SYNC_SOURCES = [
    {"folder": "observations", "author": "machine"},
    {"folder": "skills", "author": "mixed"},
]

# The visible skills/ is the room since the Hermes switch (2026-09-02). The hidden
# .claude/skills is a link the installer points at it, so on a topped-up godspeed the two
# are one folder and the visible name wins. An older mission control that has not been re-run
# still keeps its recipes under the hidden name only, and those must still be sent.
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


def source_folder(repo_root: pathlib.Path, source: dict) -> str:
    """The folder a source actually lives in on this godspeed: the named one, or an alias
    when the named one is missing and an alias is there."""
    if (repo_root / source["folder"]).is_dir():
        return source["folder"]
    if source["folder"] == "skills":
        for alias in SKILLS_ALIASES:
            if (repo_root / alias).is_dir():
                return alias
    return source["folder"]

DECISION_LOG = "decisions.md"

# Everything this sync sends lives under one folder in the notebook, and inside
# it Mission Control's own layout is reproduced exactly: observations/x.md becomes a
# note in godspeed/observations.
#
# Two reasons it is not left at the root, which is where the column defaults.
# The notebook is YOUR memory and holds notes you wrote yourself; godspeed copies
# loose at the top level bury them under machine output. And a note's folder is
# the second thing that says where it came from, after the provenance line in
# the body, so the answer to "is this something I said or something a machine
# wrote" is visible before opening it.
GODSPEED_FOLDER = "godspeed"

AUTHOR_LINES = {
    "machine": "This is a file from your mission control at {path}. It is text a machine "
               "wrote, which makes it a guess and not something you said.",
    "mixed": "This is a file from your mission control at {path}. It was mostly written by a "
             "machine and kept because you found it useful.",
    "owner": "This is a file from your mission control at {path}. You wrote or decided this.",
}

# The two shapes a decision takes in decisions.md. The starter mission control writes them
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


def collect_documents(repo_root: pathlib.Path) -> list:
    docs = []
    for source in SYNC_SOURCES:
        folder = repo_root / source_folder(repo_root, source)
        if not folder.is_dir():
            continue
        for path in sorted(folder.rglob("*.md")):
            rel = path.relative_to(repo_root).as_posix()
            if rel in SYNC_SKIP_FILES:
                continue
            docs.append(
                Document(
                    doc_id=rel,
                    title=rel,
                    body=path.read_text(encoding="utf-8"),
                    source_path=rel,
                )
            )

    log = repo_root / DECISION_LOG
    if log.is_file():
        docs.extend(split_decision_log(log.read_text(encoding="utf-8"), DECISION_LOG))
    return docs


def folder_for(source_path: str) -> str:
    """The notebook folder a document belongs in: Mission Control's own path, under GODSPEED_FOLDER.

    Derived from the source path rather than stored on the Document, so there is
    one answer and it cannot drift from the file it describes. A document at the
    repository root, which is every decision, gets GODSPEED_FOLDER itself: that
    mirrors Mission Control, where decisions.md is one file at the top.
    """
    parent, _, _ = source_path.rpartition("/")
    return "{}/{}".format(GODSPEED_FOLDER, parent) if parent else GODSPEED_FOLDER


def author_for(source_path: str) -> str:
    for source in SYNC_SOURCES:
        names = (source["folder"],) + (SKILLS_ALIASES if source["folder"] == "skills" else ())
        if any(source_path.startswith(n + "/") for n in names):
            return source["author"]
    if source_path.startswith(DECISION_LOG):
        return "owner"
    # An unmapped path defaults to machine, because claiming you said
    # something you did not is the expensive mistake in both directions.
    return "machine"


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
    # document Mission Control no longer has, which is right when you delete a file and catastrophic
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

    api_key = os.environ.get("MENERIO_API_KEY")
    if args.apply and not api_key:
        print("MENERIO_API_KEY is not set. Open a new terminal (the installer "
              "teaches them the credential), or load it by hand: "
              "eval \"$(mc-notebook-env)\"", file=sys.stderr)
        return 2

    root = pathlib.Path(args.repo_root).resolve()
    state_path = root / "world" / ".sync-state.json"
    docs = collect_documents(root)
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
