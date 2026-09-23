#!/usr/bin/env python3
"""Pull Menerio's World down into Mission Control's world/ folder as markdown.

One way only, and it never writes to Menerio. What this buys is insurance, not
ability: if Menerio disappeared tomorrow the facts would still be in git.

The ownership rule is the whole design, and this script is written so it cannot
break it by accident:

  origin: godspeed      this side wrote it. Never overwritten. Never deleted.
  origin: menerio  Menerio wrote it and this is a copy. Rewritten every run.

A file with no origin line at all is treated as origin: godspeed, because the twelve
files that existed before this script have no origin line and losing one of them
is worse than keeping a stale copy.

Usage:
    python3 scripts/world_pull.py                      # dry run, prints the plan
    python3 scripts/world_pull.py --apply              # write the files
    python3 scripts/world_pull.py --apply --self-slug michael
"""
import argparse
import dataclasses
import datetime
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1"

GODSPEED = "godspeed"
MENERIO = "menerio"

# A claim's confidence in godspeed words, decided by who wrote it. A machine's guess
# is never "certain", however sure the machine sounded.
CONFIDENCE_BY_AUTHOR = {"human": "certain", "machine": "likely"}


# --- frontmatter ------------------------------------------------------------

FRONTMATTER = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n?(.*)$", re.S)


def parse_frontmatter(text):
    """Return (fields, body). A file with no frontmatter has no fields."""
    match = FRONTMATTER.match(text or "")
    if not match:
        return {}, (text or "")
    fields = {}
    for line in match.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return fields, match.group(2)


def origin_of(text):
    """Who owns this file. Anything that is not explicitly Menerio's is ours."""
    fields, _ = parse_frontmatter(text)
    return MENERIO if fields.get("origin", "").strip().lower() == MENERIO else GODSPEED


def parse_list(value):
    """`[a, b]` or `a, b` into a list. Frontmatter here is not real YAML."""
    text = (value or "").strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    return [item.strip() for item in text.split(",") if item.strip()]


def render_list(items):
    return "[" + ", ".join(items) + "]"


# --- documents --------------------------------------------------------------


@dataclasses.dataclass
class PulledFile:
    path: str          # repo relative
    text: str
    record_id: str
    kind: str          # entity | event | claim


def slugify(name):
    """Must agree with slugify() in Menerio's _shared/world-records.ts."""
    import unicodedata

    stripped = unicodedata.normalize("NFKD", name or "")
    stripped = "".join(ch for ch in stripped if not unicodedata.combining(ch))
    slug = re.sub(r"[^a-z0-9]+", "-", stripped.lower())
    return slug.strip("-")


def render_entity(record, existing_text=None):
    """A Menerio entity as a mission control entity file.

    When Mission Control already has a file for this thing, only one line is added to
    it: menerio_id. Everything Mission Control wrote stays exactly as it was, because
    that file is a file a human may have edited.
    """
    if existing_text is not None:
        fields, body = parse_frontmatter(existing_text)
        if fields.get("menerio_id", "").strip() == record["id"]:
            return existing_text
        fields["menerio_id"] = record["id"]
        lines = ["---"]
        for key, value in fields.items():
            lines.append("{}: {}".format(key, value))
        lines.append("---")
        return "\n".join(lines) + "\n" + body

    lines = [
        "---",
        "slug: {}".format(record["slug"]),
        "name: {}".format(record.get("name", "")),
        "type: {}".format(record.get("kind") or "other"),
    ]
    aliases = [a for a in (record.get("aliases") or []) if a]
    if aliases:
        lines.append("aliases: {}".format(render_list(aliases)))
    lines += [
        "origin: menerio",
        "menerio_id: {}".format(record["id"]),
        "---",
        "",
        (record.get("description") or "").strip(),
        "",
    ]
    return "\n".join(lines)


def render_event(record, participant_slugs):
    lines = ["---"]
    if record.get("date"):
        lines.append("date: {}".format(record["date"]))
    if record.get("end_date"):
        lines.append("end: {}".format(record["end_date"]))
    if participant_slugs:
        lines.append("participants: {}".format(render_list(participant_slugs)))
    lines += [
        "source: menerio moment",
        "origin: menerio",
        "menerio_id: {}".format(record["id"]),
        "---",
        "",
        (record.get("title") or "").strip(),
    ]
    description = (record.get("description") or "").strip()
    if description:
        lines += ["", description]
    lines.append("")
    return "\n".join(lines)


def render_claim(record, subject_slug, object_slug=None):
    author = record.get("written_by", "machine")
    lines = [
        "---",
        "subject: {}".format(subject_slug),
        "attribute: {}".format(record.get("attribute", "")),
        "value: {}".format(record.get("value", "")),
    ]
    if object_slug:
        lines.append("object: {}".format(object_slug))
    if record.get("valid_from"):
        lines.append("valid_from: {}".format(record["valid_from"]))
    if record.get("valid_to"):
        lines.append("valid_to: {}".format(record["valid_to"]))
    # When to DOUBT this fact, as opposed to when it stopped being true.
    # Absent on rows the view cannot date (a profile entry has no dates at all).
    if record.get("review_by"):
        lines.append("review_by: {}".format(record["review_by"]))
    lines.append(
        "confidence: {}".format(record.get("confidence") or CONFIDENCE_BY_AUTHOR.get(author, "likely"))
    )
    # one = a second live value is a contradiction. many = several are normal.
    #
    # Written ONLY when the notebook actually supplies it. Defaulting to "one"
    # here would be worse than saying nothing: a conflict check trusts an
    # explicit line over its own fallback list, so a stamped "one" on
    # "favorite restaurants" would report every extra favourite as a
    # contradiction. An absent field means "not known, use the fallback".
    if record.get("cardinality") in ("one", "many"):
        lines.append("cardinality: {}".format(record["cardinality"]))
    lines += [
        "source: menerio {}".format(record.get("origin", "unknown")),
        "written_by: {}".format(author),
        "rank: {}".format(record.get("rank", "normal")),
        "origin: menerio",
        "menerio_id: {}".format(record["id"]),
    ]
    # The note this fact came from. Two jobs: it gives search language to match
    # on, and it is what makes "how many notes produced no claim" countable.
    source_ref = (record.get("source_ref") or "").strip()
    if source_ref and record.get("source_kind") == "note":
        lines.append("source_note: {}".format(source_ref))
    lines += [
        "---",
        "",
    ]
    evidence = (record.get("evidence_quote") or "").strip()
    if evidence:
        lines += ["> {}".format(evidence), ""]
    return "\n".join(lines)


# --- matching ---------------------------------------------------------------


def read_existing(root, folder):
    """Every file already in one of the three folders, with its owner."""
    out = {}
    directory = root / "world" / folder
    if not directory.is_dir():
        return out
    for path in sorted(directory.glob("*.md")):
        # One file that is not UTF-8 (2026-09-23) used to stop the whole pull with a
        # traceback, every hour, until a person found it. It is kept as ours and
        # untouched: never rewritten, never deleted, only reported.
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as err:
            print("  skipped unreadable {}/{}: {}".format(folder, path.name, err))
            # Still listed, so its name counts as taken and no new record is
            # written over it.
            out[path.name] = {"text": None, "fields": {}, "origin": GODSPEED}
            continue
        fields, _ = parse_frontmatter(text)
        out[path.name] = {
            "text": text,
            "fields": fields,
            "origin": origin_of(text),
        }
    return out


# ONE RECORD, ONE FILE (2026-09-23). Every machine that runs the pull names a new
# file after what IT already holds (`unique_name`), so the server and a laptop can
# write the same new record as `...-undated.md` and `...-undated-2.md`, and git
# merges the two into one folder. Nothing then noticed: the lookup took whichever
# came first and the other copy sat there for good, never updated and never removed,
# because its record was still alive. Measured that day: 2 entities and at least 4
# claims mirrored twice, and the 2026-09-22 and 2026-09-23 removal notices list the
# same record under two file names. So the files carrying one id are ranked, the
# first is the record's file, and any other Menerio-owned copy is dropped.
# Ours before Menerio's (a human's file is never the one to go), then the plain
# name before its "-2" twin.
def files_by_id(existing):
    """menerio_id -> the files carrying it, best first."""
    out = {}
    for name, info in existing.items():
        menerio_id = info["fields"].get("menerio_id", "").strip()
        if menerio_id:
            out.setdefault(menerio_id, []).append(name)
    for names in out.values():
        names.sort(key=lambda n: (existing[n]["origin"] != GODSPEED, len(n), n))
    return out


# A MALFORMED RECORD SKIPS ITSELF, NOT THE RUN (2026-09-23). One row without an id
# or a slug raised KeyError before a single file was written, so every hourly pull
# failed until Menerio changed. A row with no id cannot own a mirror file and is
# left out; a row with an id but no slug gets one from its name, its title or its id.
def usable_records(records, kind):
    out = []
    for record in records or []:
        if not isinstance(record, dict) or not str(record.get("id") or "").strip():
            print("  skipped a {} record with no id: {}".format(kind, str(record)[:120]))
            continue
        record = dict(record)
        record["id"] = str(record["id"]).strip()
        if kind != "claim" and not str(record.get("slug") or "").strip():
            record["slug"] = (slugify(record.get("name") or record.get("title") or "")
                              or record["id"])
        out.append(record)
    return out


def match_entity_file(record, existing, claimed):
    """Find Mission Control's file for this Menerio entity, or None for a new one.

    Menerio calls him "Michael Zelbel" and Mission Control file is michael.md, so a slug
    comparison alone would write a second file for the same person. Name and
    alias are checked as well. A file already claimed by another record is never
    matched twice, so two Menerio duplicates cannot collapse into one file.
    """
    wanted_id = record["id"]
    for name in files_by_id(existing).get(wanted_id, []):
        if name not in claimed:
            return name

    record_name = (record.get("name") or "").strip().lower()
    if not record_name:
        return None

    for name, info in existing.items():
        if name in claimed or info["fields"].get("menerio_id"):
            continue
        if info["fields"].get("name", "").strip().lower() == record_name:
            return name

    for name, info in existing.items():
        if name in claimed or info["fields"].get("menerio_id"):
            continue
        if info["fields"].get("slug", "").strip().lower() == record["slug"]:
            return name
        aliases = [a.strip().lower() for a in parse_list(info["fields"].get("aliases", ""))]
        if record_name in aliases:
            return name

    return None


def unique_name(base, taken):
    """`a--b--undated.md`, then `a--b--undated-2.md`. Two true values of one
    attribute are normal here, so a collision is not an error."""
    if base not in taken:
        return base
    stem = base[:-3] if base.endswith(".md") else base
    for n in range(2, 100):
        candidate = "{}-{}.md".format(stem, n)
        if candidate not in taken:
            return candidate
    return "{}-{}.md".format(stem, os.urandom(3).hex())


# --- the plan ---------------------------------------------------------------


def plan_pull(world, root, self_slug="me"):
    """Work out every file to write and every file to remove.

    Nothing owned by Mission Control is ever in the remove list, and the only mission control file
    that appears in the write list is an entity gaining its menerio_id line.
    """
    entities = usable_records(world.get("entities"), "entity")
    events = usable_records(world.get("events"), "event")
    claims = usable_records(world.get("claims"), "claim")

    existing_entities = read_existing(root, "entities")
    existing_events = read_existing(root, "events")
    existing_claims = read_existing(root, "claims")

    writes = []
    slug_by_id = {}
    claimed = set()

    for record in sorted(entities, key=lambda r: r["id"]):
        match = match_entity_file(record, existing_entities, claimed)
        if match:
            claimed.add(match)
            info = existing_entities[match]
            slug_by_id[record["id"]] = info["fields"].get("slug", "") or match[:-3]
            text = render_entity(record, existing_text=info["text"])
            if text != info["text"]:
                writes.append(PulledFile("world/entities/" + match, text, record["id"], "entity"))
            continue
        name = unique_name(record["slug"] + ".md", set(existing_entities) | claimed)
        claimed.add(name)
        slug_by_id[record["id"]] = name[:-3]
        writes.append(PulledFile("world/entities/" + name, render_entity(record), record["id"], "entity"))

    def subject_slug(kind, subject_id):
        if kind == "self" or not subject_id:
            return self_slug
        return slug_by_id.get(subject_id, "unknown")

    event_files = files_by_id(existing_events)
    event_names = set(existing_events)
    for record in sorted(events, key=lambda r: r["id"]):
        existing = (event_files.get(record["id"]) or [None])[0]
        name = existing or unique_name(record["slug"] + ".md", event_names)
        event_names.add(name)
        if existing and existing_events[existing]["origin"] == GODSPEED:
            continue
        participants = [slug_by_id[p] for p in (record.get("participants") or []) if p in slug_by_id]
        text = render_event(record, participants)
        if not existing or existing_events[existing]["text"] != text:
            writes.append(PulledFile("world/events/" + name, text, record["id"], "event"))

    claim_files = files_by_id(existing_claims)
    claim_names = set(existing_claims)
    for record in sorted(claims, key=lambda r: r["id"]):
        existing = (claim_files.get(record["id"]) or [None])[0]
        subject = subject_slug(record.get("subject_kind", "self"), record.get("subject_id"))
        obj = slug_by_id.get(record.get("object_id") or "")
        base = "{}--{}--{}.md".format(
            subject, slugify(record.get("attribute", "")) or "fact",
            record.get("valid_from") or "undated",
        )
        name = existing or unique_name(base, claim_names)
        claim_names.add(name)
        if existing and existing_claims[existing]["origin"] == GODSPEED:
            continue
        text = render_claim(record, subject, obj)
        if not existing or existing_claims[existing]["text"] != text:
            writes.append(PulledFile("world/claims/" + name, text, record["id"], "claim"))

    # A record that is gone from Menerio takes its copy with it, but only its
    # copy. A mc-owned file is never in this list.
    seen_ids = {r["id"] for r in entities} | {r["id"] for r in events} | {r["id"] for r in claims}
    removals = []
    duplicates = []
    menerio_owned = {"entities": 0, "events": 0, "claims": 0}
    for folder, existing in (
        ("entities", existing_entities),
        ("events", existing_events),
        ("claims", existing_claims),
    ):
        ranked = files_by_id(existing)
        for name, info in existing.items():
            if info["origin"] != MENERIO:
                continue
            menerio_owned[folder] += 1
            menerio_id = info["fields"].get("menerio_id", "").strip()
            if menerio_id and menerio_id not in seen_ids:
                removals.append("world/{}/{}".format(folder, name))
            elif menerio_id and ranked[menerio_id][0] != name:
                # A second copy of a live record. Not a removal: the fact stays in
                # the first file, so it goes without a notice and past the guard.
                duplicates.append(("world/{}/{}".format(folder, name),
                                   "world/{}/{}".format(folder, ranked[menerio_id][0])))

    # How many records Menerio answered with per folder, so the guard can tell an
    # empty answer from a folder that really emptied.
    answered = {"entities": len(entities), "events": len(events), "claims": len(claims)}
    return {"write": writes, "remove": sorted(removals), "menerio_owned": menerio_owned,
            "duplicates": sorted(duplicates), "answered": answered}


# --- talking to Menerio -----------------------------------------------------


KINDS = ("entities", "events", "claims")


class IncompleteAnswer(Exception):
    """Menerio answered, but not with the whole World. Nothing may be deleted on it."""


# EVERY PAGE, AND ONLY A WHOLE ANSWER (2026-09-23). This used to ask once for
# `limit=2000` and take whatever came back as the complete World. Two ways that is
# a deletion rather than a read: the endpoint pages (`offset`), and the database
# behind it may cap a page below what was asked for, so the day any kind grows past
# one page every record beyond it looks deleted, oldest first, a few at a time and
# far below the guard. And a 200 whose body has no `data`, or a `data` missing one
# kind, became an empty World: every Menerio-owned file of that kind scheduled for
# removal. So the client now pages until each kind comes back empty or short, and
# anything that is not three lists raises IncompleteAnswer before a plan is made.
MAX_PAGES = 50


def _rows(data, kind):
    rows = data.get(kind) if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise IncompleteAnswer("Menerio's answer has no {} list".format(kind))
    return rows


class WorldClient:
    def __init__(self, base_url, api_key):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def fetch_page(self, offset=0, limit=2000, updated_since=None):
        query = "?limit={}&offset={}".format(limit, offset)
        if updated_since:
            query += "&updated_since={}".format(updated_since)
        request = urllib.request.Request(
            "{}/mc-api-world{}".format(self.base_url, query),
            method="GET",
            headers={"Authorization": "Bearer {}".format(self.api_key)},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise IncompleteAnswer("Menerio's answer is not an object")
        return payload.get("data")

    def fetch(self, updated_since=None, limit=2000):
        out = {kind: [] for kind in KINDS}
        seen = {kind: set() for kind in KINDS}
        open_kinds = set(KINDS)
        offset = 0
        for _ in range(MAX_PAGES):
            data = self.fetch_page(offset, limit, updated_since)
            pages = {kind: _rows(data, kind) for kind in KINDS}
            # The page size is what the server really handed back, which may be
            # less than `limit`. A kind that returned fewer rows than the fullest
            # kind on this page has nothing left.
            size = max(len(rows) for rows in pages.values())
            for kind in list(open_kinds):
                rows = pages[kind]
                for row in rows:
                    key = row.get("id") if isinstance(row, dict) else None
                    if key is not None and key in seen[kind]:
                        continue
                    seen[kind].add(key)
                    out[kind].append(row)
                if not rows or len(rows) < size:
                    open_kinds.discard(kind)
            if not open_kinds or size == 0:
                return out
            offset += size
        raise IncompleteAnswer("still paging after {} pages".format(MAX_PAGES))


# THE REMOVAL GUARD, because this pull runs unattended. A record deleted in
# Menerio rightly takes its mirror copy with it. But an API that answers with a
# truncated or empty list looks exactly like a mass deletion, and an hourly job
# would execute it without anyone watching. So an unattended run refuses to
# delete more than half of a folder's Menerio-owned files in one sweep (and
# never trips over fewer than 20). The writes still land; only the removals
# wait for a person to look. Override, after checking the notebook really did
# shrink that much: --allow-mass-removal.
MASS_REMOVAL_FLOOR = 20


def guard_removals(plan):
    """The subset of planned removals that an unattended run refuses to do.

    Returns (safe_removals, refused_by_folder). refused_by_folder is empty when
    everything may proceed.
    """
    by_folder = {}
    for path in plan["remove"]:
        folder = path.split("/")[1]
        by_folder.setdefault(folder, []).append(path)
    refused = {}
    for folder, paths in by_folder.items():
        owned = plan["menerio_owned"].get(folder, 0)
        if len(paths) > MASS_REMOVAL_FLOOR and len(paths) * 2 > owned:
            refused[folder] = len(paths)
        # An EMPTY answer for a folder that holds Menerio's files is refused at any
        # size (2026-09-23). The floor of 20 meant a folder of 20 or fewer, like
        # events on a young install, could be emptied by one blank answer.
        elif plan.get("answered", {}).get(folder, 1) == 0:
            refused[folder] = len(paths)
    if not refused:
        return plan["remove"], {}
    safe = [p for p in plan["remove"] if p.split("/")[1] not in refused]
    return safe, refused


# THE REMOVAL NOTICE, because the guard above only catches a purge. The notebook
# tidies its own records: it merges duplicates, splits a crowded one, and hands
# back what it kept under fresh record ids. A pull cannot tell that apart from a
# deletion, so it deletes the mirror file and writes the new one, and a folder
# can lose a real fact in a sweep far too small to trip the guard. That happened
# in the folder this tool was written for: two hourly runs took 43 claims between
# them, 26 of which the notebook no longer held anywhere, and nothing said a word
# for two days because each run logged one quiet line.
#
# So any sweep bigger than a handful copies what it deleted into
# world/removed/<date>-removed.md and says so on stdout. The file is for a person
# to read; no program consumes it, and deleting it once the loss has been dealt
# with is the intended ending.
REMOVAL_NOTICE_FLOOR = 5
REMOVED_FOLDER = "removed"

NOTICE_HEADER = """# Records the world pull deleted on {date}

The notebook no longer had a record behind these mirror files, so the pull removed them.
Their last content is copied here, because a fact must not leave this folder in silence: the
log line that records a removal is one line in a file nobody opens, and git history only
helps someone who already knows to look.

Nothing reads this file. Decide what each record deserves, then delete it:

- still true and the notebook dropped it -> re-create the file with `origin: godspeed`, which the
  pull never deletes, or put the fact back into the notebook
- no longer true -> nothing to do
"""


def write_removal_notice(root, removed, today):
    """Copy every record this run deleted into world/removed/<date>-removed.md.

    `removed` is a list of (repo relative path, file text) read BEFORE the delete.
    Returns the notice's repo-relative path, or None when the sweep was small
    enough to pass without one. Two sweeps on one day append to one file rather
    than overwrite, because a tidy-up on the notebook's side arrives as several
    runs an hour apart and a notice keeping only the last one hides most of it.
    """
    if len(removed) <= REMOVAL_NOTICE_FLOOR:
        return None
    relative = "world/{}/{}-removed.md".format(REMOVED_FOLDER, today)
    path = pathlib.Path(root) / relative
    path.parent.mkdir(parents=True, exist_ok=True)

    parts = []
    if not path.is_file():
        parts.append(NOTICE_HEADER.format(date=today))
    parts.append("\nOne sweep of the pull: **{} record(s) removed.**\n".format(len(removed)))
    for item_path, text in removed:
        parts.append("\n## {}\n\n```\n{}\n```\n".format(item_path, (text or "").rstrip("\n")))

    with path.open("a", encoding="utf-8") as handle:
        handle.write("".join(parts))
    return relative


# WRITE BESIDE, THEN RENAME (2026-09-23). write_text truncates first, so a pull
# killed mid-write (a reboot, the job timeout) left a half file. A half file has no
# closing `---`, so it reads as having no frontmatter, which means no origin line,
# which means OURS: the pull never touched it again and wrote the same record a
# second time under a new name. os.replace is atomic on Linux and Windows alike, and
# the temporary name does not end in .md, so no reader ever lists it.
def write_atomic(target, text):
    target = pathlib.Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(".{}.{}.tmp".format(target.name, os.getpid()))
    try:
        with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def run_pull(world, root, client_label, apply_changes, self_slug="me",
             allow_mass_removal=False, today=None):
    plan = plan_pull(world, root, self_slug=self_slug)
    print("{}: write {}  remove {}".format(client_label, len(plan["write"]), len(plan["remove"])))
    if not apply_changes:
        for item in plan["write"]:
            print("  would write  {}".format(item.path))
        for path in plan["remove"]:
            print("  would remove {}".format(path))
        for path, kept in plan["duplicates"]:
            print("  would drop duplicate {} (same record as {})".format(path, kept))
        return plan

    removals = plan["remove"]
    if not allow_mass_removal:
        removals, refused = guard_removals(plan)
        for folder, count in sorted(refused.items()):
            print("removal guard: {} of {} Menerio-owned {} files would vanish; "
                  "skipped them. If the notebook really shrank that much, re-run "
                  "with --allow-mass-removal.".format(
                      count, plan["menerio_owned"].get(folder, 0), folder))

    for item in plan["write"]:
        write_atomic(root / item.path, item.text)
        print("  wrote  {}".format(item.path))
    for path, kept in plan["duplicates"]:
        target = root / path
        if target.is_file():
            target.unlink()
            print("  dropped duplicate {} (same record as {})".format(path, kept))
    # Read each record before deleting it, so the notice can hold what was lost
    # rather than only its filename. A path that is already gone is skipped here
    # and in the notice: it was never this run's to lose.
    removed = []
    for path in removals:
        target = root / path
        if target.is_file():
            try:
                text = target.read_text(encoding="utf-8")
            except OSError:
                text = ""
            target.unlink()
            removed.append((path, text))
            print("  removed {}".format(path))

    notice = write_removal_notice(root, removed, today or datetime.date.today().isoformat())
    if notice:
        print("removal notice: {} record(s) deleted, their content is in {}. Nothing "
              "reads that file; it is there so a fact does not leave the folder in "
              "silence.".format(len(removed), notice))
    plan["removed"] = removed
    plan["notice"] = notice
    return plan


def resolve_self_slug(root, explicit=None):
    """The entity slug that means the owner of this mission control.

    Order: the --self-slug flag, the GODSPEED_SELF_SLUG environment variable, then
    the entity file under world/entities/ whose frontmatter says `self: true`,
    then "me". The file marker is the one that travels: it lives in the folder,
    so every machine and every scheduled run agrees on who the owner is without
    a flag being typed anywhere. A mission control needs zero configuration this way.
    """
    if explicit:
        return explicit
    env = os.environ.get("GODSPEED_SELF_SLUG")
    if env:
        return env
    entities = pathlib.Path(root) / "world" / "entities"
    if entities.is_dir():
        for path in sorted(entities.glob("*.md")):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            match = re.match(r"^---\n(.*?)\n---", text, re.S)
            if not match:
                continue
            front = match.group(1)
            if not re.search(r"^self:\s*true\s*$", front, re.M):
                continue
            slug = re.search(r"^slug:\s*(\S+)\s*$", front, re.M)
            return slug.group(1) if slug else path.stem
    return "me"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Pull Menerio's World into world/.")
    parser.add_argument("--apply", action="store_true",
                        help="write the files. Without it, print what would happen.")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--self-slug", default=None,
                        help="the entity slug that means the owner of this mission control. "
                             "Unset, it is read from GODSPEED_SELF_SLUG or from the "
                             "world/entities file marked `self: true`.")
    parser.add_argument("--updated-since", default=None,
                        help="only records changed since this date. Skips removals.")
    parser.add_argument("--allow-mass-removal", action="store_true",
                        help="let one run delete more than half of a folder's "
                             "Menerio-owned files. Unattended runs refuse that.")
    args = parser.parse_args(argv)

    api_key = os.environ.get("MENERIO_API_KEY")
    if not api_key:
        print("MENERIO_API_KEY is not set. Open a new terminal (the installer "
              "teaches them the credential), or load it by hand: "
              "eval \"$(mc-notebook-env)\"", file=sys.stderr)
        return 2

    root = pathlib.Path(args.repo_root).resolve()
    args.self_slug = resolve_self_slug(root, args.self_slug)
    client = WorldClient(os.environ.get("MENERIO_BASE_URL", DEFAULT_BASE_URL), api_key)
    try:
        world = client.fetch(updated_since=args.updated_since)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")[:400]
        print("Menerio refused the request: HTTP {} {}".format(err.code, body), file=sys.stderr)
        return 1
    except (IncompleteAnswer, urllib.error.URLError, OSError, ValueError) as err:
        # Nothing is written or deleted on an answer that is not whole.
        print("Menerio's answer was incomplete, nothing changed: {}".format(err), file=sys.stderr)
        return 1

    if args.updated_since:
        # A partial answer cannot tell a deleted record from an unchanged one.
        plan = plan_pull(world, root, self_slug=args.self_slug)
        plan["remove"] = []
        print("partial pull since {}: write {}".format(args.updated_since, len(plan["write"])))
        if args.apply:
            for item in plan["write"]:
                write_atomic(root / item.path, item.text)
                print("  wrote  {}".format(item.path))
        else:
            for item in plan["write"]:
                print("  would write  {}".format(item.path))
        return 0

    run_pull(world, root, "world pull", args.apply, self_slug=args.self_slug,
             allow_mass_removal=args.allow_mass_removal)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
