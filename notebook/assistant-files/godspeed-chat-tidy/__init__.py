"""godspeed-chat-tidy: the gateway's own /compress, run for the owner's chat at night.

Installed by the Godspeed Mission Control notebook (notebook/scripts/wire-assistant.mjs) into
HERMES_HOME/plugins/godspeed-chat-tidy and enabled there.

WHY: Hermes summarises the owner's chat-app conversation before answering the message that crossed
its threshold, so that message waits minutes. The night routine (core/routine-scripts/
godspeed_routines.py, chat_tidy) tidies the chat while nobody waits, but the gateway refuses an
outside summary of a chat app's chat (session.compress, session.mutate compress and
command.dispatch /compress). What it does run is the handler behind the owner's own /compress
(GatewayRunner._handle_compress_command), and a plugin command is the supported way to run code in
the gateway.

    /godspeed-chat-tidy <chat session key> <session id>

It acts only when the runner's routing entry for the key routes to exactly that session id, the
entry's origin is a chat app's platform, and no turn for that chat runs or is being set up. Its
answer goes to the caller only: ok: <session id>, or refused: <why>; it answers refused: route moved when the key routes to another session after the summary.
"""
import asyncio

COMMAND = "godspeed-chat-tidy"
NOT_A_CHAT_APP = ("local", "cli", "tui", "cron", "webhook", "api_server")


def _runner():
    try:
        from gateway import run_api
    except Exception:
        return None
    return getattr(run_api, "_ACTIVE_RUNNER", None)


def _platform(origin):
    platform = getattr(origin, "platform", None)
    return str(getattr(platform, "value", platform) or "").lower()


def _message_event(origin):
    from gateway.platforms.event import MessageEvent
    return MessageEvent(text="/compress", source=origin)


def tidy(raw_args="", **_context):
    parts = str(raw_args or "").split()
    if len(parts) != 2:
        return "refused: usage /%s <chat session key> <session id>" % COMMAND
    key, session_id = parts
    runner = _runner()
    if runner is None:
        return "refused: the gateway runner is not running"
    try:
        entry = runner.session_store.lookup_by_session_key(key)
    except Exception as error:
        return "refused: the routing table could not be read (%s)" % error
    if entry is None or getattr(entry, "session_id", None) != session_id:
        return "refused: %s does not route to %s" % (key, session_id)
    origin = getattr(entry, "origin", None)
    platform = _platform(origin) if origin is not None else ""
    if not platform or platform in NOT_A_CHAT_APP:
        return "refused: %s is not a chat app's chat" % key
    if key in (getattr(runner, "_running_agents", None) or {}):
        return "refused: a turn for this chat is running"
    try:
        asyncio.run(runner._handle_compress_command(_message_event(origin)))
        after = runner.session_store.lookup_by_session_key(key)
    except Exception as error:
        return "refused: the summary failed (%s)" % error
    if getattr(after, "session_id", None) != session_id:
        return "refused: route moved"
    return "ok: %s" % session_id


def register(ctx):
    ctx.register_command(COMMAND, tidy, description="Summarise the owner's chat (night routine only)",
                         args_hint="<chat session key> <session id>")
