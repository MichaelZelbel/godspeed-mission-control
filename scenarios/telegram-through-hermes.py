"""Replies through the installed assistant's own outgoing hook and Telegram send path, for
scenarios/telegram-language.sh. Two modes.

  <assistant python> telegram-through-hermes.py drive --home <assistant home> --source <assistant source>
      --cases <cases.json> --out <turns.json>
  python3 telegram-through-hermes.py serve --port <n> --table <table.json>

WHAT drive DOES. It is the pattern of third-party/addons/godspeed-charm/test/telegram_driver.py, with
less pretended: Hermes' own plugin manager loads the plugins the install wired into --home (the same
ones, in the same order, a gateway loads); each case's incoming message is written into Hermes' own
session store (SessionDB) the way the gateway writes it before the model runs; the model's draft goes
through Hermes' own invoke_hook("transform_llm_output") and the first replacement wins, as in the turn
finalizer; and what is left goes through Hermes' own TelegramAdapter.send into a stand-in Bot, which is
all that is not the assistant's: no Telegram account, no network. It writes what each case sent.

WHAT serve DOES. A stand-in for the AI the person connected, for a machine with no key (the builder's
copy): an OpenAI-compatible endpoint that translates the few texts the scenario uses from a table.
"""
import argparse
import asyncio
import importlib
import json
import os
import sys
import types


def drive(args):
    os.environ["HERMES_HOME"] = args.home
    if args.source:
        sys.path.insert(0, args.source)
    try:
        import hermes_bootstrap  # noqa: F401
    except ImportError:
        pass
    from hermes_cli.plugins import discover_plugins, invoke_hook, get_plugin_manager
    from hermes_state import SessionDB
    from gateway.config import PlatformConfig
    adapter_class = None
    for name in ("plugins.platforms.telegram.adapter", "gateway.platforms.telegram"):
        try:
            adapter_class = importlib.import_module(name).TelegramAdapter
            break
        except ImportError:
            continue
    if adapter_class is None:
        raise SystemExit("this assistant has no Telegram adapter to send through")

    sent = []

    class Bot:
        id = 1

        async def send_message(self, **kw):
            sent.append(kw)
            return types.SimpleNamespace(message_id=len(sent))

    try:
        adapter = adapter_class(PlatformConfig(enabled=True, token="1:scenario"))
    except Exception:
        adapter = object.__new__(adapter_class)
    adapter._bot = Bot()

    discover_plugins()
    loaded = sorted(n for n, p in get_plugin_manager()._plugins.items() if getattr(p, "enabled", True))
    db = SessionDB()
    results = {}
    for case in json.load(open(args.cases, encoding="utf-8")):
        session = case["session"]
        if db.get_session(session) is None:
            db.create_session(session, case.get("source", "telegram"))
        if case.get("user"):
            db.append_message(session, role="user", content=case["user"])
        before = len(sent)
        replacements = invoke_hook("transform_llm_output", response_text=case["draft"], session_id=session,
                                   model="scenario", platform=case.get("platform", "telegram"), turn_id=case["name"])
        text = next((r for r in replacements if isinstance(r, str) and r), case["draft"])
        result = asyncio.run(adapter.send(str(case.get("chat", "31415")), text))
        results[case["name"]] = {"user": case.get("user", ""), "draft": case["draft"], "platform": case.get("platform", "telegram"),
                                 "hook_text": text, "delivered": bool(getattr(result, "success", False)),
                                 "sent": "\n".join(str(c.get("text", "")) for c in sent[before:])}
    results["_plugins"] = loaded
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)


def serve(args):
    from http.server import BaseHTTPRequestHandler, HTTPServer
    table = json.load(open(args.table, encoding="utf-8"))

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            prompt = body["messages"][-1]["content"]
            text = prompt.split("\n\n", 1)[-1]
            answer = table.get(text)
            code = 200 if answer else 500
            data = json.dumps({"choices": [{"message": {"role": "assistant", "content": answer}}]} if answer else {"error": "unknown text"})
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(data.encode("utf-8"))

        def log_message(self, *a):
            pass

    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest="mode", required=True)
d = sub.add_parser("drive")
d.add_argument("--home", required=True)
d.add_argument("--source", default="")
d.add_argument("--cases", required=True)
d.add_argument("--out", required=True)
s = sub.add_parser("serve")
s.add_argument("--port", type=int, required=True)
s.add_argument("--table", required=True)
arguments = parser.parse_args()
drive(arguments) if arguments.mode == "drive" else serve(arguments)
