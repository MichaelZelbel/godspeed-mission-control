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
"""

from cron.scheduler_provider import InProcessCronScheduler as _BuiltIn


class GodspeedNotebookScheduler(_BuiltIn):
    """Hermes' built-in CronScheduler; the Godspeed notebook ticks it between gateway runs."""

    @property
    def name(self) -> str:
        return "godspeed_notebook"


def register(ctx):
    ctx.register_cron_scheduler(GodspeedNotebookScheduler())
