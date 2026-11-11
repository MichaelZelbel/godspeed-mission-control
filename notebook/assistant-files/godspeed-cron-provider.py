"""Godspeed Mission Control: this Hermes' routines fire without its gateway.

Installed by the Godspeed Mission Control notebook (notebook/scripts/wire-assistant.mjs) as the
Hermes cron provider plugin `godspeed_notebook` (HERMES_HOME/plugins/godspeed_notebook/__init__.py),
and chosen in config.yaml with `cron.provider: godspeed_notebook`.

Hermes fires routines from a ticker that runs inside its gateway, so without a gateway its cronjob
tool tells the model that a routine "will NOT fire until the gateway is started" and to tell the
person so. Under Godspeed the notebook runs `hermes cron tick` itself every minute, so that sentence
is false, and on 9 October 2026 the assistant repeated it to a reader over its own manual.

Hermes asks the active cron provider whether jobs can fire without the gateway, and any provider
but the built-in one can (hermes_cli/cron.py, _builtin_gateway_liveness). This provider IS the
built-in ticker under its own name: where a gateway runs (a server with Telegram) it ticks exactly
as before, and `hermes cron tick` never asks a provider at all. If a Hermes cannot load it, Hermes
falls back to its built-in ticker and nothing else changes.

Reports (4 November 2026, #198): a routine made in Settings (`--skill ... --deliver`) delivers what
its agent wrote, and Hermes does not put that into the chat's history. register() wraps Hermes'
delivery of a skill job's result so the notebook first records the words Hermes will send (media tags out, redacted; without its header and footer)
(notebook/scripts/background-report.mjs record), where the chat reads them. A composite lane is recorded for all its destinations at once or not at all. A result that could not be recorded is not delivered: the run says why in its delivery
error, like the routines that print their own words. Once Hermes has delivered any result, the notebook is told the words (background-report.mjs delivered, with the receipts of the records written for it), and the waiting steps that record names become answerable; a delivery whose receipt could not be used says so in its delivery error. The wiring writes report.json beside this file.

A failed run (11 November 2026, #385): Hermes' failure note (a job name, a Python error, a command) once
reached the owner's Telegram word for word, and a one-time follow-up was then marked done without ever
having run. A failure bound for the owner's chats is no longer delivered: the notebook keeps it in its
failure log (background-report.mjs failed), and the owner hears at most one plain sentence about it. A
one-time follow-up that failed is scheduled again, as a new one-time job, up to three times; after that
it is left for repair with a notification in the notebook. follow-ups.json beside this file links each
of those jobs to the follow-up it continues.
"""

import inspect
import json
import os
import subprocess
import threading
from datetime import datetime, timedelta, timezone

from cron.scheduler_provider import InProcessCronScheduler as _BuiltIn

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.dirname(os.path.dirname(HERE))


def _destinations(job, for_failure=False):
    """Where the notebook's chat reads this job's report: "telegram" and/or "notebook", once each.
    Hermes decides where the job goes; each comma-separated part of its lane is put to Hermes' own
    resolvers on its own, so a composite lane (telegram,local) is recorded for every destination.
    A Telegram target is the owner's Telegram chat, and a local part is the notebook."""
    from cron import scheduler
    lane = scheduler._normalize_deliver_value(scheduler._delivery_lane_value(job, for_failure=for_failure))
    found = []
    for part in lane.split(","):
        probe = dict(job, deliver=part.strip(), failure_deliver=part.strip())
        if scheduler._normalize_deliver_value(part.strip()) == "local":
            destination = "notebook"
        elif any(str(t.get("platform")).lower() == "telegram" for t in scheduler._resolve_delivery_targets(probe, for_failure=for_failure)):
            destination = "telegram"
        else:
            continue
        if destination not in found:
            found.append(destination)
    return found


MEDIA_ONLY = "(Sent a file, without a message.)"


def _sent_words(content):
    """The words Hermes will send, as it makes them: media tags taken out, then redacted. Hermes'
    header and footer are not part of the message the chat should know."""
    from gateway.platforms.base import BasePlatformAdapter
    from cron.scheduler_delivery import _redact_cron_payload
    _, cleaned = BasePlatformAdapter.extract_media(content)
    return _redact_cron_payload((cleaned or "").strip(), "delivery content")


def record_result(job, content, for_failure=False):
    """(refusal, receipts): why the result must not go out, or None; and the ids of the delivery
    records written for it, which `delivered` hands back once Hermes has delivered."""
    if not (job.get("skill") or job.get("skills")) or not isinstance(content, str) or not content.strip():
        return None, []
    try:
        destinations = _destinations(job, for_failure)
        if not destinations:
            return None, []
        words = _sent_words(content) or MEDIA_ONLY
        with open(os.path.join(HERE, "report.json"), encoding="utf-8") as f:
            wiring = json.load(f)
        r = subprocess.run([wiring["node"], wiring["script"], "record", "--godspeed", wiring["root"], "--home", HOME,
                            "--routine", str(job.get("name") or job.get("id")), "--delivery", ",".join(destinations), "--receipts"],
                           input=words, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        if r.returncode != 0:
            return "Not delivered: it could not be recorded in the notebook. " + r.stderr.strip()[:300], []
        return None, r.stdout.strip().split(",")
    except Exception as error:
        return "Not delivered: it could not be recorded in the notebook. %s" % error, []


def mark_delivered(job, content, receipts, for_failure=False):
    """Hermes delivered these words: the waiting steps their delivery record names become answerable.
    None when that is done or nothing needed it, else why it is not (the words did go out)."""
    try:
        if not isinstance(content, str) or not content.strip() or not _destinations(job, for_failure):
            return None
        words = _sent_words(content) or MEDIA_ONLY
        with open(os.path.join(HERE, "report.json"), encoding="utf-8") as f:
            wiring = json.load(f)
        r = subprocess.run([wiring["node"], wiring["script"], "delivered", "--godspeed", wiring["root"], "--home", HOME,
                            "--receipts", ",".join(receipts)],
                           input=words, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        return None if r.returncode == 0 else r.stderr.strip()[:300] or "the notebook refused it"
    except Exception as error:
        return str(error)


RETRY_DELAYS = (3600, 21600, 86400)
FOLLOW_UPS = os.path.join(HERE, "follow-ups.json")
FOLLOW_UP_DAYS = 7
_follow_ups_lock = threading.Lock()
# What a retry copies from the job it continues, when this Hermes' create_job takes it.
RETRY_FIELDS = ("prompt", "name", "deliver", "origin", "skill", "skills", "model", "provider", "base_url", "script",
                "context_from", "enabled_toolsets", "workdir", "no_agent", "failure_deliver", "reasoning_effort",
                "interpreter", "timezone")


def _one_time(job):
    schedule, repeat = job.get("schedule"), job.get("repeat")
    return (isinstance(schedule, dict) and schedule.get("kind") == "once") or (isinstance(repeat, dict) and repeat.get("times") == 1)


def _read_follow_ups():
    try:
        with open(FOLLOW_UPS, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _take_follow_up(job_id):
    """{origin, attempt}: the follow-up this job continues and how many runs of it failed before."""
    with _follow_ups_lock:
        follow_ups = _read_follow_ups()
        entry = follow_ups.pop(job_id, None)
        if entry is not None:
            _write_follow_ups(follow_ups)
    if isinstance(entry, dict) and entry.get("origin") and isinstance(entry.get("attempt"), int):
        return {"origin": entry["origin"], "attempt": entry["attempt"]}
    return {"origin": job_id, "attempt": 0}


def _write_follow_ups(follow_ups):
    oldest = (datetime.now(timezone.utc) - timedelta(days=FOLLOW_UP_DAYS)).isoformat()
    kept = {k: v for k, v in follow_ups.items() if isinstance(v, dict) and str(v.get("at", "")) >= oldest}
    temporary = FOLLOW_UPS + ".tmp"
    with open(temporary, "w", encoding="utf-8") as f:
        json.dump(kept, f)
    os.replace(temporary, FOLLOW_UPS)


def _link_retry(retry_id, origin, attempt):
    with _follow_ups_lock:
        follow_ups = _read_follow_ups()
        follow_ups[retry_id] = {"origin": origin, "attempt": attempt, "at": datetime.now(timezone.utc).isoformat()}
        _write_follow_ups(follow_ups)


def _schedule_retry(job, delay):
    """The id of a new one-time job doing the failed job's work `delay` seconds from now. An ISO
    time is what Hermes reads as one run; an interval such as "30m" would repeat."""
    from cron.jobs import create_job
    accepted = inspect.signature(create_job).parameters
    fields = {k: job.get(k) for k in RETRY_FIELDS if k in accepted and job.get(k) is not None}
    if fields.get("skills"):
        fields.pop("skill", None)
    at = (datetime.now(timezone.utc) + timedelta(seconds=delay)).replace(microsecond=0)
    fields.update(schedule=at.isoformat(), repeat=1)
    return create_job(**fields)["id"], at.isoformat()


def _owner_failure(job):
    """Whether a failure of this job would reach the owner's chats. When that cannot be told, it is
    treated as if it would: the raw note must not reach them."""
    try:
        return bool(_destinations(job, True))
    except Exception:
        return True


def handle_failure(job, content):
    """The failure goes to the notebook's failure log instead of the owner, and a one-time follow-up
    is scheduled again until its retries are used up. None, or why the notebook could not keep it."""
    job_id = str(job.get("id") or "")
    follow_up = _take_follow_up(job_id)
    attempt = follow_up["attempt"] + 1
    one_time = _one_time(job)
    retry_at = retry_error = None
    given_up = False
    if one_time:
        if attempt <= len(RETRY_DELAYS):
            try:
                retry_id, retry_at = _schedule_retry(job, RETRY_DELAYS[attempt - 1])
                _link_retry(retry_id, follow_up["origin"], attempt)
            except Exception as error:
                given_up, retry_error = True, str(error)[:300]
        else:
            given_up = True
    report = {"job": {"id": job_id, "name": job.get("name"), "prompt": job.get("prompt")}, "origin": follow_up["origin"],
              "attempt": attempt, "one_time": one_time, "retry_at": retry_at, "given_up": given_up,
              "retry_error": retry_error, "note": content if isinstance(content, str) else str(content)}
    try:
        with open(os.path.join(HERE, "report.json"), encoding="utf-8") as f:
            wiring = json.load(f)
        r = subprocess.run([wiring["node"], wiring["script"], "failed", "--godspeed", wiring["root"], "--home", HOME],
                           input=json.dumps(report), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        if r.returncode != 0:
            return "Not delivered: the failure could not be kept in the notebook. " + r.stderr.strip()[:300]
        return None
    except Exception as error:
        return "Not delivered: the failure could not be kept in the notebook. %s" % error


def wrap_delivery(deliver):
    def deliver_recorded(job, content, *args, for_failure=False, **kwargs):
        if for_failure and _owner_failure(job):
            return handle_failure(job, content)
        refused, receipts = record_result(job, content, for_failure)
        if refused:
            return refused
        failed = deliver(job, content, *args, for_failure=for_failure, **kwargs)
        if failed:
            return failed
        unmarked = mark_delivered(job, content, receipts, for_failure)
        if unmarked:
            return "Delivered, but a question in it could not be marked as answerable in the notebook. " + unmarked
        return None
    deliver_recorded.godspeed_wrapped = True
    return deliver_recorded


class GodspeedNotebookScheduler(_BuiltIn):
    """Hermes' built-in CronScheduler; the Godspeed notebook ticks it between gateway runs."""

    @property
    def name(self) -> str:
        return "godspeed_notebook"


def register(ctx):
    ctx.register_cron_scheduler(GodspeedNotebookScheduler())
    from cron import scheduler
    if not getattr(scheduler._deliver_result, "godspeed_wrapped", False):
        scheduler._deliver_result = wrap_delivery(scheduler._deliver_result)
