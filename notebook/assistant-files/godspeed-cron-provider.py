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
"""

import json
import os
import subprocess

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


def wrap_delivery(deliver):
    def deliver_recorded(job, content, *args, for_failure=False, **kwargs):
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
