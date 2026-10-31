"""Drives the godspeed-charm Hermes plugin's Telegram buttons for test/telegram.test.mjs.

Everything Hermes and Telegram would provide is a stand-in: the telegram SDK classes, the
gateway's record of the session being answered, the bot and its event loop. The add-on command
is the real one (GODSPEED_CHARM_SCRIPT), working on the test's throwaway mission control, so a tap
writes real events. Nothing here talks to a network, a real Hermes or a real home folder.

Usage: python telegram_driver.py <plugin folder>, with {"steps": [...]} on stdin. Prints
{"results": [...], "calls": [...], "events": [...]} on stdout: one result per step, every bot
call in order.
"""
import asyncio
import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
import time
import types

PLUGIN = sys.argv[1]
OWNER = 31415
BOT_ID = 1112


class Button:
    def __init__(self, text, callback_data=None):
        self.text, self.callback_data = text, callback_data


class Keyboard:
    def __init__(self, rows):
        if FAIL["markup"]:
            FAIL["markup"] -= 1
            raise RuntimeError("synthetic keyboard failure")
        self.inline_keyboard = rows


class Handler:
    def __init__(self, callback, pattern=None):
        self.callback, self.pattern = callback, pattern


ROUTE = {}


def get_session_env(name, default=""):
    return ROUTE.get(name.replace("HERMES_SESSION_", "", 1), default)


telegram = types.ModuleType("telegram")
telegram.InlineKeyboardButton, telegram.InlineKeyboardMarkup = Button, Keyboard
telegram_ext = types.ModuleType("telegram.ext")
telegram_ext.CallbackQueryHandler = Handler
telegram.ext = telegram_ext
gateway = types.ModuleType("gateway")
session_context = types.ModuleType("gateway.session_context")
session_context.get_session_env = get_session_env
gateway.session_context = session_context
sys.modules.update({"telegram": telegram, "telegram.ext": telegram_ext,
                    "gateway": gateway, "gateway.session_context": session_context})

CALLS = []
FAIL = {"send": 0, "markup": 0}
PROBE = []  # what the stand-in voice filter saw when it ran


def keyboard(markup):
    if markup is None or isinstance(markup, list):
        return markup
    return [[{"text": b.text, "data": b.callback_data} for b in row] for row in markup.inline_keyboard]


def plain(method, kw, **extra):
    call = {"method": method, **extra}
    for k, v in kw.items():
        call[k] = keyboard(v) if k == "reply_markup" else v
    CALLS.append(call)
    return call


class Bot:
    def __init__(self):
        self.id, self.next_id = BOT_ID, 100

    async def send_message(self, **kw):
        if FAIL["send"]:
            FAIL["send"] -= 1
            plain("send_message_failed", kw)
            raise RuntimeError("synthetic network failure")
        self.next_id += 1
        plain("send_message", kw, message_id=self.next_id)
        return types.SimpleNamespace(message_id=self.next_id, chat=types.SimpleNamespace(id=kw["chat_id"], type="private"))

    async def edit_message_text(self, **kw):
        plain("edit_message_text", kw)

    async def edit_message_reply_markup(self, **kw):
        plain("edit_message_reply_markup", kw)


class App:
    def __init__(self):
        self.bot, self.handlers = Bot(), []

    def add_handler(self, handler):
        self.handlers.append(handler)


loop = asyncio.new_event_loop()
threading.Thread(target=loop.run_forever, daemon=True).start()


def on_loop(coro, timeout=60):
    return asyncio.run_coroutine_threadsafe(coro, loop).result(timeout)


spec = importlib.util.spec_from_file_location("charm_plugin_under_test", os.path.join(PLUGIN, "__init__.py"))
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)

hooks, factories, unloads, sending = {}, [], [], []
ctx = types.SimpleNamespace(register_hook=lambda name, cb: hooks.setdefault(name, []).append(cb),
                            register_telegram_handler=factories.append, on_unload=unloads.append)
app = App()


def route_for(session, change=None):
    route = {"PLATFORM": "telegram", "CHAT_ID": str(OWNER), "USER_ID": str(OWNER), "CHAT_TYPE": "dm",
             "ID": session, "MESSAGE_ID": "8"}
    route.update(change or {})
    return route


def step_register(s):
    plugin.register(ctx)
    if s.get("telegram", True):
        async def wire():
            for factory in factories:
                factory(app, None)
        on_loop(wire())
    # Every scheduled send is remembered here, so a step can wait for it to finish.
    question = plugin._question
    original = question.deliver

    def deliver(*a, **k):
        future = original(*a, **k)
        if future is not None:
            sending.append(future)
        return future
    question.deliver = deliver
    return {"handlers": [h.pattern for h in app.handlers], "hooks": sorted(hooks)}


def charm(args, now=None):
    """The real add-on command, as the model would run it in Hermes' terminal at `now`."""
    env = dict(os.environ)
    if now:
        env["GODSPEED_CHARM_NOW"] = now
    r = subprocess.run([os.environ["GODSPEED_NODE"], os.environ["GODSPEED_CHARM_SCRIPT"], *args],
                       capture_output=True, text=True, encoding="utf-8", env=env)
    return r.returncode, (r.stdout + r.stderr).strip()


def step_charm(s):
    code, output = charm(s["args"], s.get("now"))
    return {"status": code, "output": output}


def step_tool(s):
    ROUTE.clear()
    ROUTE.update(route_for(s["session"], s.get("route")))
    result = s.get("result")
    if s.get("run"):
        code, output = charm(s["run"], s.get("now"))
        result = json.dumps({"output": output, "exit_code": code, "error": None})
    if result is None:
        result = json.dumps({"output": s.get("output", ""), "exit_code": s.get("exit_code", 0), "error": None})
    for cb in hooks.get("post_tool_call", []):
        cb(tool_name=s.get("tool", "terminal"), args={"command": s["command"]}, result=result,
           session_id=s["session"], turn_id=s["turn"], status=s.get("status", "ok"), tool_call_id="call-1")
    return {}


def step_reply(s):
    outs = [cb(response_text=s["text"], session_id=s["session"], turn_id=s["turn"],
               platform=s.get("platform", "telegram"), model="test-model")
            for cb in hooks.get("transform_llm_output", [])]
    if s.get("wait", True):
        for future in list(sending):
            future.result(60)
        sending.clear()
    # Hermes: the first callback that returns a non-empty string wins.
    return {"text": next((o for o in outs if isinstance(o, str) and o), None), "outs": outs}


def step_tap(s):
    if s.get("now"):
        os.environ["GODSPEED_CHARM_NOW"] = s["now"]
    sent = [c for c in CALLS if c["method"] == "send_message" and c.get("reply_markup")]
    m = sent[s.get("message", -1)]
    data = s.get("data") or m["reply_markup"][0][s.get("button", 0)]["data"]
    answered = []

    async def answer(*a, **k):
        answered.append({"args": list(a), **k})
    message = types.SimpleNamespace(
        message_id=m["message_id"], text=m["text"], forward_origin=None, reply_markup=m["reply_markup"],
        chat=types.SimpleNamespace(id=int(s.get("chat", m["chat_id"])), type=s.get("chat_type", "private")),
        from_user=types.SimpleNamespace(id=int(s.get("from_bot", BOT_ID))))
    query = types.SimpleNamespace(id="callback-1", data=data, message=message, answer=answer,
                                  from_user=types.SimpleNamespace(id=int(s.get("user", OWNER))))
    update = types.SimpleNamespace(callback_query=query)
    context = types.SimpleNamespace(bot=app.bot)
    handler = next(h for h in app.handlers if re.match(h.pattern, data))
    on_loop(handler.callback(update, context))
    return {"answered": answered}


def probe():
    PROBE.append({"scheduled": len(sending), "sent": len([c for c in CALLS if c["method"] == "send_message"])})


def step_bus(s):
    if s["kind"] == "silent-voice":
        bus = sys.modules["godspeed_progress_output_v1"]

        def held(**kwargs):
            # A stand-in for a reader check that holds the reply back.
            probe()
            return "[SILENT]"
        bus.voice_transform = held
    elif s["kind"] == "voice":
        bus = sys.modules["godspeed_progress_output_v1"]

        def voice(**kwargs):
            # A stand-in for the owner's voice filter: repairs a long dash, then hands on to the coach.
            probe()
            text = kwargs["response_text"].replace("\u2014", ",")
            append = getattr(bus, "append", None)
            combined = append(**dict(kwargs, response_text=text)) if callable(append) else None
            return combined or text
        bus.voice_transform = voice
    elif s["kind"] == "coach":
        bus = sys.modules["godspeed_progress_output_v1"]
        bus.append = lambda **kwargs: kwargs["response_text"] + "\n\nMEDIA:/coach/picture.png"
    elif s["kind"] == "stickers":
        stickers = types.ModuleType("hermes_telegram_stickers_under_test")
        stickers.NAME = "hermes-telegram-stickers"
        stickers.strip_tags = lambda text: re.sub(r"\s*\[\[sticker:[a-z]+\]\]", "", text).strip()
        sys.modules[stickers.__name__] = stickers
    return {}


def step_files(s):
    folder = os.path.join(os.environ["GODSPEED_CHARM_DIR"], ".godspeed", "charm-buttons")
    out = {}
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        with open(os.path.join(folder, name), encoding="utf-8") as f:
            text = f.read()
        try:
            out[name] = json.loads(text)
        except ValueError:
            out[name] = text
    return {"files": out}


def step_fail(s):
    FAIL["send"] = int(s.get("send", 0))
    FAIL["markup"] = int(s.get("markup", 0))
    return {}


def step_cancel(s):
    """Cuts the scheduled sends short while they wait, as a shutdown would, and waits for what
    they do then. (A send cancelled before its coroutine even started runs no code at all.)"""
    time.sleep(0.5)
    for future in list(sending):
        future.cancel()
    sending.clear()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and not any(c["method"] == "send_message" for c in CALLS):
        time.sleep(0.05)
    time.sleep(0.2)
    return {}


def step_break(s):
    """Makes one method of the plugin's Telegram object fail, the way a broken disk would."""
    def broken(*a, **k):
        raise PermissionError("synthetic: the token folder cannot be written")
    setattr(plugin._question, s["method"], broken)
    return {}


def step_mend(s):
    delattr(plugin._question, s["method"])
    return {}


def step_corrupt(s):
    sent = [c for c in CALLS if c["method"] == "send_message" and c.get("reply_markup")]
    data = sent[s.get("message", -1)]["reply_markup"][0][s.get("button", 0)]["data"]
    file = os.path.join(os.environ["GODSPEED_CHARM_DIR"], ".godspeed", "charm-buttons", data[5:] + ".json")
    with open(file, "w", encoding="utf-8") as f:
        f.write("{ not json")
    return {}


def step_env(s):
    for k, v in s["set"].items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    return {}


def step_unload(s):
    for cb in unloads:
        cb()
    return {}


STEPS = {"register": step_register, "tool": step_tool, "reply": step_reply, "tap": step_tap,
         "bus": step_bus, "files": step_files, "fail": step_fail, "env": step_env, "unload": step_unload,
         "charm": step_charm, "cancel": step_cancel, "break": step_break, "mend": step_mend,
         "corrupt": step_corrupt}

results = []
# UTF-8 both ways, whatever the console code page (Windows reads stdin as cp1252 otherwise).
for step in json.loads(sys.stdin.buffer.read().decode("utf-8"))["steps"]:
    results.append(STEPS[step["do"]](step))
print(json.dumps({"results": results, "calls": CALLS, "probe": PROBE}))
