"""The owner on Telegram, for the scenarios that need an install to talk to its owner: run with the
installed assistant's own Python (see scenario-lib.sh, owner_on_telegram).

  <assistant python> owner-on-telegram.py --home <assistant home> --source <assistant source>
      --fixture <telegram-fixture.json> --steps <steps.json> --out <run.json> [--notebook-port <n>]

It is the pattern of telegram-through-hermes.py, extended from one hook to a live emulated gateway in
one process. Hermes' own plugin manager loads the plugins the install wired into --home; Hermes' own
routine runner, delivery, agent and Telegram adapter do the rest. What is stood in for is Telegram's
servers and nothing else: every call the install makes to them lands in the outbox of --out, and a
call made with a token other than the fixture's valid one is refused as Telegram refuses a revoked key.

--steps is a list of {"label": ..., "kind": ..., ...}. Kinds:
  cron   {"job": <routine name>, "optional"?}  run a routine the way the install's tick does, in this process,
                                          and deliver what it prints, without a gateway
  say    {"text": ..., "session": ...}    the owner says it in their private chat; one turn of Hermes' own
                                          agent answers, through the plugins' hooks, and the reply is sent
  press  {"message": <outbox index|"last-with-buttons">, "contains": <text>, "button": <button text>}
                                          the owner presses a button of a message that went out
  run    {"argv": [...], "env": {...}, "stdout_file"?}
                                          a command the act needs while this process lives
  query  {"table": ..., "file": ...}      the notebook's own answer for a table, written to <file>
  token  {"valid": true|false}            the bot token in the assistant's .env, valid or revoked
Each step's outcome is appended to "steps" of --out; the messages sent are in "outbox", each with the
label of the step it was sent in. A missing Hermes entry point ends the run with one line, "this
assistant has no <name> to ...", which the scenario turns into its FAIL line.
"""
import argparse
import asyncio
import importlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import types
import urllib.request


def need(what, find):
    try:
        found = find()
    except Exception:
        found = None
    if found is None:
        raise SystemExit("this assistant has no %s" % what)
    return found


def main(args):
    os.environ["HERMES_HOME"] = args.home
    fixture = json.load(open(args.fixture, encoding="utf-8"))
    owner = fixture["owner"]
    os.environ["TELEGRAM_ALLOWED_USERS"] = owner
    if args.source:
        sys.path.insert(0, args.source)
    try:
        import hermes_bootstrap  # noqa: F401
    except ImportError:
        pass
    from hermes_cli.plugins import discover_plugins, get_plugin_manager
    from hermes_state import SessionDB
    from gateway.config import PlatformConfig

    adapter_class = need("Telegram adapter to send through", lambda: next(
        (getattr(importlib.import_module(n), "TelegramAdapter") for n in
         ("plugins.platforms.telegram.adapter", "gateway.platforms.telegram")
         if importlib.util.find_spec(n)), None))
    senders = need("standalone Telegram sender to deliver routines through",
                   lambda: importlib.import_module("tools.send_message_senders"))
    need("_telegram_bot in its standalone Telegram sender", lambda: getattr(senders, "_telegram_bot", None))

    outbox = []
    steps = []
    state = {"label": "", "token": fixture["valid_token"]}

    def env_file():
        return os.path.join(args.home, ".env")

    class StandInBot:
        """Telegram's servers, for one bot token."""

        def __init__(self, token):
            self.token = token
            self.id = fixture["bot_id"]

        def _record(self, method, kw):
            accepted = self.token == fixture["valid_token"]
            markup = kw.get("reply_markup")
            rows = getattr(markup, "inline_keyboard", None) or []
            buttons = [{"text": getattr(b, "text", ""), "callback_data": getattr(b, "callback_data", None)}
                       for row in rows for b in row]
            outbox.append({"label": state["label"], "method": method, "chat_id": str(kw.get("chat_id", "")),
                           "text": str(kw.get("text", kw.get("caption", ""))), "buttons": buttons,
                           "accepted": accepted})
            if not accepted:
                from telegram.error import InvalidToken
                raise InvalidToken("Not Found")
            return types.SimpleNamespace(message_id=len(outbox), chat_id=kw.get("chat_id"))

        async def send_message(self, **kw):
            return self._record("send_message", kw)

        async def edit_message_text(self, **kw):
            return self._record("edit_message_text", kw)

        async def edit_message_reply_markup(self, **kw):
            return self._record("edit_message_reply_markup", kw)

        async def send_photo(self, **kw):
            return self._record("send_photo", kw)

        async def send_document(self, **kw):
            return self._record("send_document", kw)

        async def answer_callback_query(self, *a, **kw):
            return True

        async def get_me(self):
            if self.token != fixture["valid_token"]:
                from telegram.error import InvalidToken
                raise InvalidToken("Not Found")
            return types.SimpleNamespace(id=self.id, username="scenario_bot")

    senders._telegram_bot = lambda token: StandInBot(token)

    try:
        adapter = adapter_class(PlatformConfig(enabled=True, token=state["token"]))
    except Exception:
        adapter = object.__new__(adapter_class)
    adapter._bot = StandInBot(state["token"])

    handlers = []
    native = types.SimpleNamespace(bot=adapter._bot, add_handler=lambda h, *a, **k: handlers.append(h))

    discover_plugins()
    manager = get_plugin_manager()
    for factory in getattr(manager, "get_telegram_handler_factories", lambda: [])():
        try:
            factory(native, adapter)
        except Exception as error:
            print("a Telegram plugin would not register its handlers: %s" % error, file=sys.stderr)
    loaded = sorted(n for n, p in manager._plugins.items() if getattr(p, "enabled", True))

    db = SessionDB()

    def set_token(valid):
        state["token"] = fixture["valid_token"] if valid else fixture["other_token"]
        lines = []
        if os.path.exists(env_file()):
            lines = [l for l in open(env_file(), encoding="utf-8").read().splitlines()
                     if not l.startswith("TELEGRAM_BOT_TOKEN=")]
        lines.append("TELEGRAM_BOT_TOKEN=" + state["token"])
        with open(env_file(), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        adapter._bot = StandInBot(state["token"])
        native.bot = adapter._bot

    def run_routine(step):
        scheduler = need("routine runner (cron.scheduler.run_job)", lambda: importlib.import_module("cron.scheduler"))
        jobs = need("routine list (cron.jobs.list_jobs)", lambda: importlib.import_module("cron.jobs")).list_jobs(include_disabled=True)
        job = next((j for j in jobs if j.get("name") == step["job"]), None)
        if job is None and step.get("optional"):
            return {"success": True, "absent": True}
        if job is None:
            return {"success": False, "error": "this install has no routine named %s" % step["job"]}
        run_job = need("run_job", lambda: getattr(scheduler, "run_job"))
        success, _doc, final, error = run_job(job)
        silent = getattr(scheduler, "_is_cron_silence_response", lambda t: "[SILENT]" in t)
        delivered = None
        if success and final and not silent(final):
            deliver = need("routine delivery (cron.scheduler_delivery._deliver_result)", lambda:
                           importlib.import_module("cron.scheduler_delivery")._deliver_result)
            delivered = deliver(job, final)
        return {"success": bool(success), "error": error or delivered or "", "sent": delivered is None and bool(final)}

    def say(step):
        from gateway.session_context import set_session_vars
        session = step.get("session", "scenario-owner")
        set_session_vars(platform="telegram", chat_id=owner, chat_type="dm", user_id=owner, session_id=session,
                         session_key="agent:main:telegram:dm:" + owner)
        if db.get_session(session) is None:
            db.create_session(session, "telegram")
        history = [{"role": m["role"], "content": m["content"]} for m in db.get_messages(session)
                   if m.get("role") in ("user", "assistant") and m.get("content")]
        db.append_message(session, role="user", content=step["text"])
        run_module = need("gateway runner's model settings", lambda: importlib.import_module("gateway.run"))
        kwargs = need("runtime provider (gateway.run._resolve_runtime_agent_kwargs)",
                      lambda: run_module._resolve_runtime_agent_kwargs())
        model = need("model (gateway.run._resolve_gateway_model)", lambda: run_module._resolve_gateway_model())
        agent_class = need("agent (run_agent.AIAgent)", lambda: importlib.import_module("run_agent").AIAgent)
        agent = agent_class(model=model, platform="telegram", user_id=owner, session_id=session, session_db=db,
                            quiet_mode=True, skip_memory=True, **kwargs)
        result = agent.run_conversation(step["text"], conversation_history=history)
        reply = str(result.get("final_response") or "")
        if reply:
            from hermes_cli.plugins import invoke_hook
            replaced = invoke_hook("transform_llm_output", response_text=reply, session_id=session, model=model,
                                   platform="telegram", turn_id=step.get("label", ""))
            reply = next((r for r in replaced if isinstance(r, str) and r), reply)
            return {"success": True, "reply": reply, "_send": reply}
        return {"success": True, "reply": ""}

    async def press(step):
        index = step["message"]
        if index == "last-with-buttons":
            candidates = [i for i, m in enumerate(outbox) if m["buttons"]
                          and step.get("contains", "").lower() in m["text"].lower()]
            if not candidates:
                return {"success": False, "error": "no message with buttons to press"}
            index = candidates[-1]
        button = next((b for b in outbox[index]["buttons"]
                       if b["text"].strip().lower() == step["button"].strip().lower()), None)
        if button is None:
            return {"success": False, "error": "message %d has no button %r" % (index, step["button"])}
        data = button["callback_data"]
        message = types.SimpleNamespace(chat=types.SimpleNamespace(id=int(owner), type="private"),
                                        chat_id=int(owner), message_id=index + 1,
                                        from_user=types.SimpleNamespace(id=fixture["bot_id"]), text=outbox[index]["text"])
        user = types.SimpleNamespace(id=int(owner), is_bot=False)
        query = types.SimpleNamespace(data=data, from_user=user, message=message, id="press-%d" % index,
                                      answer=adapter._bot.answer_callback_query,
                                      edit_message_text=lambda *a, **k: adapter._bot.edit_message_text(
                                          chat_id=owner, **{"text": a[0] if a else k.get("text", ""), **{x: y for x, y in k.items() if x != "text"}}),
                                      edit_message_reply_markup=lambda *a, **k: adapter._bot.edit_message_reply_markup(chat_id=owner, **k))
        update = types.SimpleNamespace(callback_query=query, effective_user=user, effective_chat=message.chat,
                                       effective_message=message, message=None)
        context = types.SimpleNamespace(bot=adapter._bot, user_data={}, chat_data={}, application=native)
        handled = 0
        for handler in handlers:
            pattern = getattr(handler, "pattern", None)
            if pattern is not None and not (pattern.match(data) if hasattr(pattern, "match") else pattern(data)):
                continue
            if pattern is None and "CallbackQuery" not in type(handler).__name__:
                continue
            await handler.callback(update, context)
            handled += 1
        return {"success": handled > 0, "handled": handled, "message": index,
                "error": "" if handled else "no handler took the press of %r" % data}

    def run_command(step):
        env = dict(os.environ)
        env.update(step.get("env", {}))
        done = subprocess.run(step["argv"], capture_output=True, text=True, env=env, timeout=step.get("timeout", 600))
        if step.get("stdout_file"):
            with open(step["stdout_file"], "w", encoding="utf-8") as f:
                f.write(done.stdout)
        return {"success": done.returncode == 0, "exit": done.returncode, "stdout": done.stdout[-4000:],
                "error": done.stderr[-2000:] if done.returncode else ""}

    def query(step):
        request = urllib.request.Request("http://127.0.0.1:%s/api/query" % args.notebook_port,
                                         data=json.dumps({"table": step["table"]}).encode(),
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=120) as answer:
                body = answer.read().decode()
        except Exception as error:
            return {"success": False, "error": "the notebook would not show %s: %s" % (step["table"], error)}
        with open(os.path.join(os.path.dirname(args.out), step["file"]), "w", encoding="utf-8") as f:
            f.write(body)
        return {"success": True}

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    for step in json.load(open(args.steps, encoding="utf-8")):
        state["label"] = step.get("label", "")
        kind = step["kind"]
        try:
            if kind == "cron":
                outcome = run_routine(step)
            elif kind == "say":
                outcome = say(step)
                reply = outcome.pop("_send", "")
                if reply:
                    loop.run_until_complete(adapter.send(owner, reply))
            elif kind == "press":
                outcome = loop.run_until_complete(press(step))
            elif kind == "run":
                outcome = run_command(step)
            elif kind == "query":
                outcome = query(step)
            elif kind == "token":
                set_token(step["valid"])
                outcome = {"success": True}
            else:
                outcome = {"success": False, "error": "unknown step kind %s" % kind}
        except SystemExit:
            raise
        except Exception as error:
            outcome = {"success": False, "error": "%s: %s" % (type(error).__name__, error)}
        steps.append({"label": state["label"], "kind": kind, **outcome})
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"outbox": outbox, "steps": steps, "_plugins": loaded, "hermes": getattr(
                importlib.import_module("hermes_cli"), "__version__", "")}, f, ensure_ascii=False, indent=1)


parser = argparse.ArgumentParser()
parser.add_argument("--home", required=True)
parser.add_argument("--source", default="")
parser.add_argument("--fixture", required=True)
parser.add_argument("--steps", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--notebook-port", default="47831")
main(parser.parse_args())
