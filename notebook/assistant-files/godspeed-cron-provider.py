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
delivery of a skill job's result so the notebook records the same words first
(notebook/scripts/background-report.mjs record), where the chat reads them. The words are not
changed. A result that could not be recorded is not delivered: the run says why in its delivery
error, like the routines that print their own words. The wiring writes report.json beside this file.
"""

import json
import os
import subprocess

from cron.scheduler_provider import InProcessCronScheduler as _BuiltIn

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.dirname(os.path.dirname(HERE))


def _delivery(job):
    """Where the notebook's chat reads this job's report, or None where no chat is involved."""
    where = str(job.get("deliver") or "")
    if where == "local":
        return "notebook"
    return "telegram" if where == "telegram" or where.startswith("telegram:") else None


def record_result(job, content, for_failure=False):
    """None when nothing needs recording or it was recorded, else why the result must not go out."""
    delivery = _delivery(job)
    if for_failure or not delivery or not (job.get("skill") or job.get("skills")) or not isinstance(content, str) or not content.strip():
        return None
    try:
        with open(os.path.join(HERE, "report.json"), encoding="utf-8") as f:
            wiring = json.load(f)
        r = subprocess.run([wiring["node"], wiring["script"], "record", "--godspeed", wiring["root"], "--home", HOME,
                            "--routine", str(job.get("name") or job.get("id")), "--delivery", delivery],
                           input=content, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        if r.returncode == 0:
            return None
        return "Not delivered: it could not be recorded in the notebook. " + r.stderr.strip()[:300]
    except Exception as error:
        return "Not delivered: it could not be recorded in the notebook. %s" % error


def wrap_delivery(deliver):
    def deliver_recorded(job, content, *args, for_failure=False, **kwargs):
        refused = record_result(job, content, for_failure)
        return refused or deliver(job, content, *args, for_failure=for_failure, **kwargs)
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
