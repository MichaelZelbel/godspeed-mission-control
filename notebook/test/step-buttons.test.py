"""A waiting step's Telegram question with its Yes/No buttons (godspeed-context/step_buttons.py), driven
the way Hermes would: stand-ins for the telegram SDK and the bot, the real `godspeed-step` command and
a real workspace prepared by step-buttons.test.mjs."""
import asyncio
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
import types

OWNER, BOT = 31415, 1112
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT, COMMAND = os.environ["STEP_ROOT"], json.loads(os.environ["STEP_COMMAND"])
IDS, MESSAGES = json.loads(os.environ["STEP_IDS"]), json.loads(os.environ["STEP_MESSAGES"])
os.environ["TELEGRAM_ALLOWED_USERS"] = str(OWNER)
os.environ["GODSPEED_CHARM_BUTTON_DELAY"] = "0"


class Button:
    def __init__(self, text, callback_data=None):
        self.text, self.callback_data = text, callback_data


class Markup:
    def __init__(self, rows):
        self.inline_keyboard = rows


class Handler:
    def __init__(self, callback, pattern):
        self.callback, self.pattern = callback, pattern


telegram = types.ModuleType("telegram")
telegram.InlineKeyboardButton, telegram.InlineKeyboardMarkup = Button, Markup
ext = types.ModuleType("telegram.ext")
ext.CallbackQueryHandler = Handler
sys.modules["telegram"], sys.modules["telegram.ext"] = telegram, ext

folder = os.path.join(HERE, "..", "assistant-files", "godspeed-context")
spec = importlib.util.spec_from_file_location("step_buttons", os.path.join(folder, "step_buttons.py"))
step_buttons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(step_buttons)
step_buttons.EVERY = 3600  # the watcher factory starts would race the posts each case makes by hand


class Bot:
    id = BOT

    def __init__(self):
        self.sent, self.edits = [], []

    async def send_message(self, **kw):
        self.sent.append(kw)
        return types.SimpleNamespace(message_id=100 + len(self.sent))

    async def edit_message_text(self, **kw):
        self.edits.append(kw)


class App:
    def __init__(self, bot):
        self.bot, self.handlers = bot, []

    def add_handler(self, handler):
        self.handlers.append(handler)


def step(*args, stdin=None):
    run = subprocess.run(COMMAND[:2] + list(args) + COMMAND[2:], input=stdin, capture_output=True, text=True, encoding="utf-8")
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def status(step_id):
    return step("get", step_id)["status"]


def gateway():
    """A StepButtons registered on a running bot loop, the way Hermes' gateway has it."""
    bot = Bot()
    buttons = step_buttons.StepButtons(lambda: ROOT, lambda: COMMAND)
    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_forever, daemon=True).start()

    async def connect():
        buttons.factory(App(bot), None)
    asyncio.run_coroutine_threadsafe(connect(), loop).result()
    return buttons, bot


def wait_for(condition):
    for _ in range(100):
        if condition():
            return
        time.sleep(0.05)
    raise AssertionError("timed out")


def tap(buttons, bot, data, message_id, text, user=OWNER):
    message = types.SimpleNamespace(chat=types.SimpleNamespace(id=OWNER, type="private"), message_id=message_id,
                                    text=text, from_user=types.SimpleNamespace(id=BOT), reply_markup=None)

    async def answer():
        pass
    query = types.SimpleNamespace(from_user=types.SimpleNamespace(id=user), message=message, data=data, answer=answer)
    asyncio.run(buttons.callback(types.SimpleNamespace(callback_query=query), types.SimpleNamespace(bot=bot)))


def post(buttons, bot, count):
    buttons.post_waiting()
    wait_for(lambda: len(bot.sent) == count)
    time.sleep(0.2)  # the tokens are bound to their messages just after the send
    return [(m, 101 + i) for i, m in enumerate(bot.sent)]


def press(buttons, bot, sent, answer, **kw):
    message, message_id = sent
    data = next(b.callback_data for b in message["reply_markup"].inline_keyboard[0] if b.text == {"yes": "Yes", "no": "No"}[answer])
    tap(buttons, bot, data, message_id, message["text"], **kw)


def queue():
    return os.listdir(os.path.join(ROOT, ".godspeed", "step-questions"))


def one_step():
    buttons, bot = gateway()
    step("heard", "--chat", "telegram", stdin="yes")
    assert status(IDS[0]) == "waiting", "a yes cannot reach a step whose question has not gone out"
    (sent,) = post(buttons, bot, 1)
    assert sent[0]["text"] == MESSAGES[0], sent[0]["text"]
    markup = sent[0]["reply_markup"].inline_keyboard[0]
    assert [b.text for b in markup] == ["Yes", "No"]
    assert all(b.callback_data.startswith("gss1:") for b in markup)
    assert queue() == [], queue()
    press(buttons, bot, sent, "yes")
    assert status(IDS[0]) == "yes"
    assert bot.edits[-1]["text"] == MESSAGES[0] + "\n\nYes: I will restart it now.", bot.edits
    buttons.post_waiting()
    assert len(bot.sent) == 1, bot.sent


def typed_after_card():
    buttons, bot = gateway()
    post(buttons, bot, 1)
    step("heard", "--chat", "telegram", stdin="yes")
    assert status(IDS[0]) == "yes"


def answered_first():
    buttons, bot = gateway()
    buttons.post_waiting()
    assert bot.sent == [] and queue() == [], (bot.sent, queue())


def two_steps():
    buttons, bot = gateway()
    first, second = post(buttons, bot, 2)
    assert {first[0]["text"], second[0]["text"]} == set(MESSAGES)
    by_text = {m["text"]: (m, i) for m, i in (first, second)}
    mine, other = by_text[MESSAGES[0]], by_text[MESSAGES[1]]
    press(buttons, bot, other, "yes")
    assert (status(IDS[0]), status(IDS[1])) == ("waiting", "yes")
    press(buttons, bot, mine, "no")
    assert (status(IDS[0]), status(IDS[1])) == ("no", "yes")
    assert bot.edits[-1]["text"] == MESSAGES[0] + "\n\nNo: I will leave it as it is.", bot.edits


def not_the_owner():
    buttons, bot = gateway()
    (sent,) = post(buttons, bot, 1)
    press(buttons, bot, sent, "yes", user=OWNER + 1)
    assert status(IDS[0]) == "waiting" and bot.edits == []


def second_press():
    buttons, bot = gateway()
    (sent,) = post(buttons, bot, 1)
    press(buttons, bot, sent, "yes")
    press(buttons, bot, sent, "no")
    assert status(IDS[0]) == "yes"
    assert bot.edits[-1]["text"] == step_buttons.WORDS["en"]["noOpenQuestion"], bot.edits


def after_typed():
    buttons, bot = gateway()
    (sent,) = post(buttons, bot, 1)
    step("heard", "--chat", "telegram", stdin="no")
    assert status(IDS[0]) == "no"
    press(buttons, bot, sent, "yes")
    assert status(IDS[0]) == "no"
    assert bot.edits[-1]["text"] == MESSAGES[0] + "\n\nThis was already answered (no). Nothing changed.", bot.edits


def no_client():
    buttons = step_buttons.StepButtons(lambda: ROOT, lambda: COMMAND)
    buttons.post_waiting()
    assert queue() == [IDS[0] + ".json"], queue()
    assert not os.path.exists(os.path.join(ROOT, ".godspeed", "step-buttons"))
    assert status(IDS[0]) == "waiting"


def send_fails():
    buttons, bot = gateway()
    send = bot.send_message

    async def no_keyboard(**kw):
        if "reply_markup" in kw:
            raise RuntimeError("the keyboard was refused")
        return await send(**kw)
    bot.send_message = no_keyboard
    buttons.post_waiting()
    time.sleep(0.2)
    assert bot.sent == [], "no plain copy: the next look sends the card instead"
    assert queue() == [IDS[0] + ".json"], queue()
    assert status(IDS[0]) == "waiting"
    step("heard", "--chat", "telegram", stdin="yes")
    assert status(IDS[0]) == "waiting", "a question that never reached the owner cannot be answered"


def notebook_cannot_say():
    buttons, bot = gateway()
    real = buttons.run
    buttons.run = lambda *args: subprocess.CompletedProcess(args, 1, "", "") if args[0] == "get" else real(*args)
    buttons.post_waiting()
    assert bot.sent == [] and queue() == [IDS[0] + ".json"], (bot.sent, queue())
    buttons.run = real
    post(buttons, bot, 1)
    assert queue() == [] and status(IDS[0]) == "waiting"


def expired():
    buttons, bot = gateway()
    file = os.path.join(ROOT, ".godspeed", "step-questions", IDS[0] + ".json")
    with open(file, encoding="utf-8") as f:
        item = json.load(f)
    item["expires_at"] = "2020-01-01T00:00:00.000Z"
    with open(file, "w", encoding="utf-8") as f:
        json.dump(item, f)
    buttons.post_waiting()
    assert queue() == [] and bot.sent == []


def registered():
    spec = importlib.util.spec_from_file_location("godspeed_context_plugin", os.path.join(folder, "__init__.py"),
                                                  submodule_search_locations=[folder])
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)
    factories, unloads = [], []
    ctx = types.SimpleNamespace(register_hook=lambda *a: None, register_telegram_handler=factories.append, on_unload=unloads.append)
    plugin.register(ctx)
    assert len(factories) == 1 and len(unloads) == 1
    bot = Bot()
    app = App(bot)

    async def connect():
        factories[0](app, None)
    asyncio.run(connect())
    assert [h.pattern for h in app.handlers] == [r"^gss1:"], [h.pattern for h in app.handlers]
    unloads[0]()
    assert plugin._buttons.active is False


globals()[sys.argv[1]]()
