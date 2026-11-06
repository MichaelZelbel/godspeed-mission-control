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

It acts only on the owner's private chat key (agent:main:<chat app>:dm:<id>), when the runner's routing entry for the key routes to exactly that session id, the
entry's origin is a chat app's platform, and no turn for that chat runs or is being set up. The routine's
control process has no runner: there the command leaves the request in HERMES_HOME/
godspeed-chat-tidy-requests, which this plugin's thread in the gateway process answers. Its
answer goes to the caller only: ok: <session id>, or refused: <why>; it answers refused: route moved when the key routes to another session after the summary.
"""
import asyncio
import dataclasses
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from pathlib import Path

COMMAND = "godspeed-chat-tidy"
# The owner's private chat in a chat app, as godspeed_routines.py (CHAT_KEY) finds it: a group or
# channel route and the assistant's own terminal ("local") are refused. A test holds the two equal.
CHAT_KEY = r"^agent:main:(?!(?:local|cli|tui|cron|webhook|api_server):)[^:]+:dm:.+$"
CHAT_KEY_LIKE = "agent:main:%:dm:%"
NOT_A_CHAT_APP = ("local", "cli", "tui", "cron", "webhook", "api_server")


# The command runs in whichever process dispatches it. The night routine dispatches it in its own
# control process, where there is no gateway runner; the gateway process (which loads this plugin
# too) is the only one that has one. So a process without a runner leaves the request in a folder
# of the assistant's home and the gateway's copy of this plugin answers it.
CLAIM_WAIT = 20
ANSWER_WAIT = 880
POLL = 0.5


@dataclasses.dataclass(frozen=True)
class TidyRequest:
    """The request a runner-less process leaves for the gateway: the one owner of its stored shape."""
    key: str
    session_id: str

    def dump(self, handle):
        json.dump(dataclasses.asdict(self), handle)

    @classmethod
    def load(cls, handle):
        asked = json.load(handle)
        return cls(**{field.name: asked[field.name] for field in dataclasses.fields(cls)})


def _home():
    return os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")


def _requests():
    return os.path.join(_home(), "godspeed-chat-tidy-requests")


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


def _owner_chat_key():
    """The one chat the night routine may tidy, as the assistant routes it now."""
    database = Path(_home()) / "state.db"
    try:
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=2) as connection:
            rows = connection.execute(
                "select session_key from gateway_routing where scope = ? and session_key like ?",
                (str(Path(_home()) / "sessions"), CHAT_KEY_LIKE)).fetchall()
    except (OSError, sqlite3.Error):
        return None
    keys = [row[0] for row in rows if re.match(CHAT_KEY, row[0] or "")]
    return keys[0] if len(keys) == 1 else None


def tidy(raw_args="", **_context):
    parts = str(raw_args or "").split()
    if len(parts) != 2:
        return "refused: usage /%s <chat session key> <session id>" % COMMAND
    key, session_id = parts
    if not re.match(CHAT_KEY, key):
        return "refused: %s is not the owner's private chat in a chat app" % key
    runner = _runner()
    if runner is not None:
        return _tidy_with(runner, key, session_id)
    return _ask_the_gateway(key, session_id)


def _ask_the_gateway(key, session_id):
    folder, name = _requests(), uuid.uuid4().hex
    request, claimed, answer = (os.path.join(folder, name + ext) for ext in (".json", ".work", ".out"))
    try:
        os.makedirs(folder, exist_ok=True)
        with open(request + ".tmp", "w", encoding="utf-8") as handle:
            TidyRequest(key, session_id).dump(handle)
        os.replace(request + ".tmp", request)
    except OSError as error:
        return "refused: the gateway could not be asked (%s)" % error
    try:
        end = time.time() + CLAIM_WAIT
        while os.path.exists(request):
            if time.time() > end:
                try:
                    os.remove(request)
                except OSError:
                    continue  # the gateway claimed it just now
                return "refused: the gateway runner is not running"
            time.sleep(POLL)
        end = time.time() + ANSWER_WAIT
        while not os.path.exists(answer):
            if time.time() > end:
                return "refused: the gateway gave no answer"
            time.sleep(POLL)
        with open(answer, encoding="utf-8") as handle:
            return handle.read().strip() or "refused: the gateway gave an empty answer"
    finally:
        for leftover in (request, claimed, answer):
            try:
                os.remove(leftover)
            except OSError:
                pass


def _answer_requests():
    """One pass: answer each request left in the folder. Only a process with a gateway runner does."""
    if _runner() is None:
        return
    try:
        names = [n for n in os.listdir(_requests()) if n.endswith(".json")]
    except OSError:
        return
    for name in names:
        path = os.path.join(_requests(), name)
        work = path[:-len(".json")] + ".work"
        try:
            os.rename(path, work)
        except OSError:
            continue
        try:
            with open(work, encoding="utf-8") as handle:
                asked = TidyRequest.load(handle)
            answer = tidy("%s %s" % (asked.key, asked.session_id))
        except Exception as error:
            answer = "refused: the request could not be read (%s)" % error
        out = work[:-len(".work")] + ".out"
        with open(out + ".tmp", "w", encoding="utf-8") as handle:
            handle.write(answer)
        os.replace(out + ".tmp", out)


def _serve_requests():
    while True:
        time.sleep(POLL)
        _answer_requests()


def _tidy_with(runner, key, session_id):
    if _owner_chat_key() != key:
        return "refused: %s is not the one chat of the owner" % key
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
    threading.Thread(target=_serve_requests, daemon=True, name=COMMAND).start()
    ctx.register_command(COMMAND, tidy, description="Summarise the owner's chat (night routine only)",
                         args_hint="<chat session key> <session id>")
