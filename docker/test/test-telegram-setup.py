#!/usr/bin/env python3
# The Telegram setup's own test (docker/rootfs/usr/local/bin/godspeed-telegram-setup),
# with no Docker, no Telegram, no ChatGPT and no GitHub: run by CI before the image test,
# and by hand on any computer with Python 3:
#
#   python3 docker/test/test-telegram-setup.py
#
# A stand-in Telegram (fake-telegram.py) plays the reader; stand-ins for hermes, gh and
# the installer print what the real ones print and record how they were called. Walks
# the happy path, then every road back from a snag: a stranger who writes first, a
# code that runs out, a wrong repository address, an installer that stops. Prints
# PASS or FAIL per check and exits 1 when any check failed.
import importlib.machinery
import importlib.util
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PROGRAM = os.path.join(ROOT, "docker", "rootfs", "usr", "local", "bin", "godspeed-telegram-setup")
TOKEN = "123456789:TESTtoken_never-logged"
FAILS = 0


def load(name, path):
    spec = importlib.util.spec_from_loader(name, importlib.machinery.SourceFileLoader(name, path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


fake_telegram = load("fake_telegram", os.path.join(HERE, "fake-telegram.py"))


def check(what, ok):
    global FAILS
    print("%s  %s" % ("PASS" if ok else "FAIL", what))
    if not ok:
        FAILS += 1


def fwd(p):
    return p.replace("\\", "/")


FAKE_HERMES = r'''
import json, os, sys, time
d = os.environ["FAKE_DIR"]; a = sys.argv[1:]
open(os.path.join(d, "hermes-calls"), "a").write(" ".join(a) + "\n")
mark = os.path.join(d, "chatgpt-signed-in")
if a[:2] == ["auth", "list"]:
    if os.path.exists(mark): print("openai-codex (1 credential)")
    sys.exit(0)
state_f = os.path.join(d, "hermes-state.json")
st = json.load(open(state_f)) if os.path.exists(state_f) else {"keys": {}}
def save(): json.dump(st, open(state_f, "w"))
if a[:3] == ["config", "set", "model.provider"]:
    st["provider"] = a[3]; save(); sys.exit(0)
if a[:3] == ["config", "set", "model.default"]:
    st["model"] = a[3]; save(); sys.exit(0)
if a[:2] == ["auth", "remove"]:
    st["keys"].pop(a[2], None); save(); sys.exit(0)
if a[:2] == ["auth", "add"] and "api-key" in a:
    # What hermes_cli/auth_commands.py does: --api-key, or else it asks, and with no
    # terminal the answer is read from standard input.
    key = a[a.index("--api-key") + 1] if "--api-key" in a else sys.stdin.readline().strip()
    st["keys"][a[2]] = key; save(); print("Added %s credential" % a[2]); sys.exit(0)
if a[:2] == ["chat", "--oneshot"]:
    # The proof question: ChatGPT answers only on the models the plan may use, a key only when good.
    p = st.get("provider")
    if p == "openai-codex":
        ok = os.path.exists(mark) and st.get("model") in os.environ.get("FAKE_CODEX_OK", "gpt-5.6-terra").split(",")
    else:
        ok = "bad" not in st["keys"].get(p, "bad")
    if ok: print("ready"); sys.exit(0)
    print("Provider said: HTTP 400: {\"detail\":\"The '%s' model is not supported\"}" % st.get("model")); sys.exit(1)
if a[:2] == ["auth", "add"]:
    # What hermes_cli/auth_codex.py prints, colours included.
    print("To continue, follow these steps:\n")
    print("  1. Open this URL in your browser:")
    print("     \033[94mhttps://auth.openai.com/codex/device\033[0m\n")
    print("  2. Enter this code:")
    print("     \033[94mABCD-12345\033[0m\n")
    print("Waiting for sign-in... (press Ctrl+C to cancel)", flush=True)
    first = os.path.join(d, "chatgpt-failed-once")
    if os.environ.get("FAKE_HERMES_FAIL_FIRST") and not os.path.exists(first):
        open(first, "w").close(); time.sleep(1); print("Login failed: the code expired"); sys.exit(1)
    time.sleep(1.5); open(mark, "w").close(); print('Added openai-codex OAuth credential #1'); sys.exit(0)
if a[:1] == ["send"]:
    open(os.path.join(d, "hermes-sent"), "a").write(sys.stdin.read()); sys.exit(0)
sys.exit(0)
'''

FAKE_GH = r'''
import os, sys, time
d = os.environ["FAKE_DIR"]; a = sys.argv[1:]
open(os.path.join(d, "gh-calls"), "a").write(" ".join(a) + "\n")
mark = os.path.join(d, "github-signed-in")
if a[:2] == ["auth", "status"]: sys.exit(0 if os.path.exists(mark) else 1)
if a[:2] == ["auth", "login"] and "--skip-ssh-key" in a:
    sys.stderr.write("unknown flag: --skip-ssh-key\n\nUsage:  gh auth login [flags]\n"); sys.exit(1)
if a[:2] == ["auth", "login"]:
    sys.stderr.write("! First copy your one-time code: 1A2B-3C4D\n")
    sys.stderr.write("Open this URL to continue in your web browser: https://github.com/login/device\n")
    sys.stderr.flush(); time.sleep(1.5); open(mark, "w").close(); sys.exit(0)
if a[:2] == ["api", "user"]: print("anna"); sys.exit(0)
if a[:2] == ["repo", "view"]:
    have = [r for r in os.environ.get("FAKE_GH_REPOS", "").split(",") if r]
    sys.exit(0 if a[2] in have else 1)
sys.exit(0)
'''

FAKE_SETUP = r'''
import json, os, subprocess, sys, time
d = os.environ["FAKE_DIR"]
keys = ["KB_TELEGRAM_SKIP", "KB_SIGNIN_SKIP", "KB_MORNING_BRIEF", "KB_OBSERVED_STATE", "GODSPEED_INSTALL_COUNT", "GODSPEED_REPO", "KB_REPO_NAME",
        "GODSPEED_TELEGRAM_TOKEN", "GODSPEED_TELEGRAM_OWNER"]
runs = os.path.join(d, "setup-runs.json")
seen = json.load(open(runs)) if os.path.exists(runs) else []
seen.append({k: os.environ.get(k) for k in keys}); json.dump(seen, open(runs, "w"))
print("\n== \033[1mInstalling your assistant\033[0m", flush=True); time.sleep(1)
print("   ok: installed", flush=True)
print("\n== Your folder", flush=True); time.sleep(2)
if os.environ.get("FAKE_SETUP_FAIL_FIRST") and len(seen) == 1:
    print("\n== Giving your mission control a checked private GitHub home")
    print("\033[1;31m[stop]\033[0m the private GitHub repository was not created or checked.", file=sys.stderr)
    sys.exit(1)
g = os.environ["GODSPEED"]
origin = os.environ.get("GODSPEED_REPO") or "https://github.com/anna/%s.git" % os.environ.get("KB_REPO_NAME", "godspeed")
subprocess.run(["git", "init", "-q", g], check=True)
subprocess.run(["git", "-C", g, "remote", "add", "origin", origin], check=True)
print("   ok: done")
'''

FAKE_FINISH = r'''
import json, os, sys
d = os.environ["FAKE_DIR"]
runs = os.path.join(d, "finish-runs.json")
seen = json.load(open(runs)) if os.path.exists(runs) else []
seen.append({"input": json.loads(sys.stdin.read() or "{}"), "token": os.environ.get("GODSPEED_TELEGRAM_TOKEN"),
             "code": os.environ.get("GODSPEED_TELEGRAM_START_CODE")})
json.dump(seen, open(runs, "w"))
if os.environ.get("FAKE_FINISH_FAIL_FIRST") and len(seen) == 1:
    print("The notebook folder is busy right now", file=sys.stderr); sys.exit(1)
print("Filed the goal and the clock")
'''


def scenario_run(name, scenario, extra_env=None, env_file=None, timeout=120, prepare=None):
    tmp = tempfile.mkdtemp(prefix="tg-setup-")
    home, fakes = os.path.join(tmp, "home"), os.path.join(tmp, "fake")
    os.makedirs(home)
    os.makedirs(fakes)
    for fname, body in (("hermes.py", FAKE_HERMES), ("gh.py", FAKE_GH), ("setup.py", FAKE_SETUP), ("finish.py", FAKE_FINISH)):
        with open(os.path.join(fakes, fname), "w") as f:
            f.write(body)
    if env_file is not None:
        os.makedirs(os.path.join(home, ".hermes"))
        with open(os.path.join(home, ".hermes", ".env"), "w") as f:
            f.write(env_file)
    fk = fake_telegram.Fake(TOKEN, scenario)
    srv = fake_telegram.serve(fk)
    py = shlex.quote(fwd(sys.executable))
    env = dict(os.environ, HOME=home, GODSPEED_TELEGRAM_TOKEN=TOKEN,
               GODSPEED_TELEGRAM_API="http://127.0.0.1:%d" % srv.server_address[1],
               GODSPEED_TG_HERMES="%s %s" % (py, shlex.quote(fwd(os.path.join(fakes, "hermes.py")))),
               GODSPEED_TG_GH="%s %s" % (py, shlex.quote(fwd(os.path.join(fakes, "gh.py")))),
               GODSPEED_TG_SETUP="%s %s" % (py, shlex.quote(fwd(os.path.join(fakes, "setup.py")))),
               GODSPEED_TG_FINISH="%s %s" % (py, shlex.quote(fwd(os.path.join(fakes, "finish.py")))),
               GODSPEED_WORKSPACE=os.path.join(tmp, "workspace"),
               HERMES_HOME=os.path.join(home, ".hermes"), GODSPEED=os.path.join(home, "godspeed"),
               FAKE_DIR=fakes, TZ="Europe/Berlin")
    os.makedirs(os.path.join(tmp, "workspace"))
    if prepare:
        prepare(os.path.join(tmp, "workspace"))
    env.pop("GODSPEED_TELEGRAM_OWNER", None)
    env.pop("GODSPEED_TELEGRAM_START_CODE", None)
    env.pop("GODSPEED_TG_FLOW", None)
    env.pop("KB_SIGNIN_SKIP", None)
    env.update(extra_env or {})
    print("== %s" % name)
    t0 = time.time()
    try:
        p = subprocess.run([sys.executable, PROGRAM], env=env, capture_output=True, text=True, timeout=timeout)
        rc, out = p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired as e:
        rc, out = "timeout", (e.stdout or "") if isinstance(e.stdout, str) else ""
    srv.shutdown()

    def read(*parts):
        try:
            with open(os.path.join(*parts), encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""
    r = {"rc": rc, "out": out, "secs": time.time() - t0, "fake": fk, "home": home, "fakes": fakes,
         "to": lambda uid: [m["text"] for m in fk.sent if m["chat_id"] == uid],
         "env": read(home, ".hermes", ".env"),
         "state": json.loads(read(home, ".godspeed", "telegram-setup.json") or "{}"),
         "log": read(home, "logs", "godspeed-telegram-setup.log"),
         "runs": json.loads(read(fakes, "setup-runs.json") or "[]"),
         "hermes": read(fakes, "hermes-calls"), "gh": read(fakes, "gh-calls"),
         "hermes_sent": read(fakes, "hermes-sent"), "env_extra": env,
         "hstate": json.loads(read(fakes, "hermes-state.json") or "{}"),
         "finish": json.loads(read(fakes, "finish-runs.json") or "[]"),
         "workspace": os.path.join(tmp, "workspace")}
    if rc != 0:
        print(out[-3000:])
    return r


def have_zones():
    try:
        from zoneinfo import available_timezones
        return bool(available_timezones())
    except Exception:
        return False


def any_has(texts, *needles):
    return any(all(n in t for n in needles) for t in texts)


USERS = {"111": {"first_name": "Anna", "username": "anna"}, "999": {"first_name": "Eve", "username": "eve"}}


def test_codes():
    print("== reading the sign-in codes the way the real tools print them")
    m = load("tg_setup", PROGRAM)
    hermes = ("To continue, follow these steps:\n\n  1. Open this URL in your browser:\n"
              "     \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n  2. Enter this code:\n"
              "     \x1b[94mABCD-12345\x1b[0m\n\nWaiting for sign-in...")
    check("Hermes' ChatGPT code and address", m.find_device_code(hermes) == ("https://auth.openai.com/codex/device", "ABCD-12345"))
    check("Hermes' code without a dash", m.find_device_code(hermes.replace("ABCD-12345", "Q7RT9XW2")) ==
          ("https://auth.openai.com/codex/device", "Q7RT9XW2"))
    check("nothing is sent before the code is printed", m.find_device_code(hermes.split("  2.")[0]) is None)
    gh_old = ("! First copy your one-time code: 1A2B-3C4D\n"
              "Open this URL to continue in your web browser: https://github.com/login/device\n")
    check("gh's code and address, no terminal", m.find_device_code(gh_old) == ("https://github.com/login/device", "1A2B-3C4D"))
    gh_new = ("\n! One-time code (3E7F-F915) copied to clipboard\n"
              "Open this URL to continue in your web browser: https://github.com/login/device\n")
    check("gh's code where it has a clipboard", m.find_device_code(gh_new) == ("https://github.com/login/device", "3E7F-F915"))
    check("a repository address in any usual shape",
          [m.normalise_repo(x, "anna") for x in ("https://github.com/anna/godspeed", "github.com/anna/godspeed.git",
           "git@github.com:anna/godspeed.git", "anna/godspeed", "godspeed", "not an address!")]
          == ["anna/godspeed"] * 5 + [None])
    check("a country or a German city with no zone of its own",
          [m.find_zone(x) for x in ("Germany", "München", "Düsseldorf", "UK")] ==
          ["Europe/Berlin", "Europe/Berlin", "Europe/Berlin", "Europe/London"])
    if have_zones():
        check("a city is its zone, in any case, with spaces",
              [m.find_zone(x) for x in ("london", "New York", "Asia/Tokyo", "sao paulo", "Krefeld")] ==
              ["Europe/London", "America/New_York", "Asia/Tokyo", "America/Sao_Paulo", None])
    else:
        print("NOTE  no time zone database on this computer (pip install tzdata), so city names are not checked here")


def test_happy():
    r = scenario_run("the happy path: Start, two codes, three answers, set up", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start"}, {"from": 999, "text": "hi, is this yours?"}],
        "rules": [
            {"when": "Which AI should I think with", "do": [{"from": 111, "press": "openai-codex"}]},
            {"when": "already have a Mission Control", "do": [{"from": 111, "press": "repo:fresh"}]},
            {"when": "morning brief", "do": [{"from": 111, "press": "brief:yes"}]},
            {"when": "Whose 06:00", "do": [{"from": 111, "text": "Tokyo" if have_zones() else "UK"}]},
            {"when": "one line about the world", "do": [{"from": 111, "press": "world:yes"}]},
            {"when": "Setting everything up now", "do": [{"from": 111, "text": "are you there?"}]},
        ]})
    to_anna, to_eve = r["to"](111), r["to"](999)
    check("it finishes, exit 0", r["rc"] == 0)
    check("the first writer owns the bot", r["state"].get("owner_id") == 111 and r["state"].get("chat_id") == 111)
    check("the welcome greets them by name", any_has(to_anna, "Hi Anna", "Three short steps"))
    check("a stranger is told it is taken, and nothing else", to_eve == ["This assistant belongs to someone else."])
    check("the ChatGPT address and code arrive", any_has(to_anna, "https://auth.openai.com/codex/device", "<code>ABCD-12345</code>"))
    check("the brain question offers ChatGPT, OpenRouter, Claude, OpenAI, Gemini and the rest",
          any(m["buttons"] == ["openai-codex", "openrouter", "anthropic", "openai-api", "gemini", "more"]
              for m in r["fake"].sent))
    check("ChatGPT: a model the plan refuses is passed over, the one that answers is kept",
          r["hstate"].get("provider") == "openai-codex" and r["hstate"].get("model") == "gpt-5.6-terra"
          and r["hermes"].count("chat --oneshot") >= 2)
    check("the brain counts as connected only after it answered a test question",
          any_has(to_anna, "ChatGPT is connected, and I answered a first test question"))
    check("the GitHub address and code arrive", any_has(to_anna, "https://github.com/login/device", "<code>1A2B-3C4D</code>"))
    check("GitHub is confirmed with the account", any_has(to_anna, "GitHub is connected as anna"))
    check("git is set up to push after the sign-in", "auth setup-git" in r["gh"])
    run = r["runs"][0] if r["runs"] else {}
    check("the installer ran once, with the answers and no token",
          len(r["runs"]) == 1 and run.get("KB_MORNING_BRIEF") == "yes" and run.get("GODSPEED_INSTALL_COUNT") == "no"
          and run.get("KB_OBSERVED_STATE") == "yes"
          and run.get("KB_REPO_NAME") == "godspeed" and run.get("KB_TELEGRAM_SKIP") == "1"
          and run.get("KB_SIGNIN_SKIP") == "1"
          and not run.get("GODSPEED_REPO") and not run.get("GODSPEED_TELEGRAM_TOKEN"))
    check("progress is shown while it works", any("Working on: Your folder" in e for e in r["fake"].edits))
    check("a message during the install gets an answer", any_has(to_anna, "Still working on"))
    check("the bot goes to Hermes: token, owner, home chat",
          "TELEGRAM_BOT_TOKEN=%s" % TOKEN in r["env"] and "TELEGRAM_ALLOWED_USERS=111" in r["env"]
          and "TELEGRAM_HOME_CHANNEL=111" in r["env"])
    check("the gateway is restarted to take it", "gateway restart" in r["hermes"])
    zone, city = ("Asia/Tokyo", "Tokyo") if have_zones() else ("Europe/London", "London")
    check("the city they typed becomes Hermes' clock, before the restart",
          "Got it: %s time." % city in to_anna
          and 0 <= r["hermes"].find("config set timezone %s" % zone) < r["hermes"].find("gateway restart"))
    check("the first message goes the brief's road (hermes send)", "this is its chat" in r["hermes_sent"])
    check("the last message carries the address for another computer",
          any_has(to_anna, "GodspeedSetup.exe", "<code>https://github.com/anna/godspeed.git</code>", "--repo https://github.com/anna/godspeed.git"))
    check("setup is marked done", r["state"].get("done") is True)
    check("the token is in no log", TOKEN not in r["log"] and TOKEN not in r["out"])
    sent_before = len(r["fake"].sent)
    # A restart after it is done: nothing is sent, nothing is asked.
    again = subprocess.run([sys.executable, PROGRAM], env=r["env_extra"], capture_output=True, text=True, timeout=30)
    check("started again once done, it does nothing", again.returncode == 0 and len(r["fake"].sent) == sent_before)


def test_snags():
    r = scenario_run("every road back: an owner named, a code that ran out, a wrong address, a stop", {
        "users": USERS,
        "start": [{"from": 999, "text": "/start"}, {"from": 111, "text": "/start"}],
        "rules": [
            {"when": "Which AI should I think with", "do": [{"from": 111, "press": "openai-codex"}]},
            {"when": "That code ran out", "do": [{"from": 111, "press": "retry"}]},
            {"when": "already have a Mission Control", "do": [{"from": 111, "press": "repo:have"}]},
            {"when": "Send me its address", "do": [{"from": 111, "text": "github.com/anna/nope"}]},
            {"when": "I cannot open", "do": [{"from": 111, "text": "https://github.com/anna/mission"}]},
            {"when": "morning brief", "do": [{"from": 111, "text": "whatever"}, {"from": 111, "press": "brief:no"}]},
            {"when": "Setup stopped at", "do": [{"from": 111, "press": "setup:retry"}]},
        ]}, extra_env={"GODSPEED_TELEGRAM_OWNER": "@Anna", "FAKE_HERMES_FAIL_FIRST": "1",
                       "FAKE_SETUP_FAIL_FIRST": "1", "FAKE_GH_REPOS": "anna/mission"})
    to_anna, to_eve = r["to"](111), r["to"](999)
    check("it finishes, exit 0", r["rc"] == 0)
    check("the named owner takes it though a stranger wrote first",
          r["state"].get("owner_id") == 111 and to_eve == ["This assistant belongs to someone else."])
    check("a code that ran out offers a new one, and the new one works",
          r["hermes"].count("auth add openai-codex") == 2 and any_has(to_anna, "ChatGPT is connected, and I answered"))
    check("a wrong address is said, and asked again", any_has(to_anna, "I cannot open github.com/anna/nope"))
    check("typing instead of tapping gets a nudge", "Tap one of the buttons above, please." in to_anna)
    check("a stop says where and why", any_has(to_anna, "Setup stopped at", "private GitHub home",
                                               "the private GitHub repository was not created"))
    runs = r["runs"]
    check("Try again runs the installer again, with the same answers",
          len(runs) == 2 and runs[1].get("GODSPEED_REPO") == "https://github.com/anna/mission.git"
          and runs[1].get("KB_MORNING_BRIEF") == "no" and runs[1].get("GODSPEED_INSTALL_COUNT") == "no"
          and not runs[1].get("KB_REPO_NAME"))
    check("the last message carries the address they gave", any_has(to_anna, "https://github.com/anna/mission.git"))
    check("no brief, no question about the clock", not any_has(to_anna, "Whose 06:00") and "timezone" not in r["hermes"])
    check("no brief, no question about the world line, and it is off",
          not any_has(to_anna, "one line about the world") and runs[1].get("KB_OBSERVED_STATE") == "no")
    check("setup is marked done", r["state"].get("done") is True)


def test_found_repo():
    r = scenario_run("a repository called godspeed is already on their GitHub", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start"}],
        "rules": [
            {"when": "Which AI should I think with", "do": [{"from": 111, "press": "more"}]},
            {"when": "Which one", "do": [{"from": 111, "press": "deepseek"}]},
            {"when": "Send me your DeepSeek API key", "do": [{"from": 111, "text": "sk-deepseek-good-0123456789"}]},
            {"when": "Is that your", "do": [{"from": 111, "press": "found:no"}]},
            {"when": "morning brief", "do": [{"from": 111, "press": "brief:yes"}]},
            {"when": "Whose 06:00", "do": [{"from": 111, "text": "Krefeld"}]},
            {"when": "do not know the clock of Krefeld", "do": [{"from": 111, "press": "tz:keep"}]},
            {"when": "one line about the world", "do": [{"from": 111, "press": "world:no"}]},
        ]}, extra_env={"FAKE_GH_REPOS": "anna/godspeed,anna/godspeed-mission-control"})
    check("it asks whether that one is theirs", any_has(r["to"](111), "anna/godspeed</b> on your GitHub"))
    check("starting fresh picks a name that is free",
          r["runs"] and r["runs"][-1].get("KB_REPO_NAME") == "godspeed-2")
    check("another provider from the longer list, by key, and the key message deleted",
          r["hstate"].get("provider") == "deepseek" and len(r["fake"].deleted) == 1
          and any_has(r["to"](111), "DeepSeek is connected"))
    check("a town the clock does not know is said, and the server's clock can be kept",
          any_has(r["to"](111), "I do not know the clock of Krefeld") and "config set timezone Europe/Berlin" in r["hermes"])


def test_key_provider():
    good, bad = "sk-or-good-0123456789abcdef", "sk-or-bad-0123456789abcdef"
    r = scenario_run("OpenRouter by key: a short answer, a key that fails, a key that works", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start"}],
        "rules": [
            {"when": "Which AI should I think with", "do": [{"from": 111, "press": "openrouter"}]},
            {"when": "Send me your OpenRouter API key", "do": [{"from": 111, "text": "short"}]},
            {"when": "does not look like an API key", "do": [{"from": 111, "text": bad}]},
            {"when": "did not answer with that key", "do": [{"from": 111, "text": good}]},
            {"when": "already have a Mission Control", "do": [{"from": 111, "press": "repo:fresh"}]},
            {"when": "morning brief", "do": [{"from": 111, "press": "brief:no"}]},
        ]})
    to_anna = r["to"](111)
    check("it finishes, exit 0", r["rc"] == 0)
    check("no ChatGPT sign-in is started for another provider", "auth add openai-codex" not in r["hermes"])
    check("something that is not a key is said", any_has(to_anna, "That does not look like an API key"))
    check("a key that fails is said, with what the provider answered",
          any_has(to_anna, "OpenRouter did not answer with that key", "Provider said"))
    check("the key that works is kept, with Hermes' default model for OpenRouter",
          r["hstate"].get("provider") == "openrouter" and r["hstate"].get("keys", {}).get("openrouter") == good
          and r["hstate"].get("model") == "z-ai/glm-5.2")
    check("every message with a key is deleted from the chat", len(r["fake"].deleted) == 3)
    check("no key is in the log, the output or any message the bot sent",
          all(k not in r["log"] and k not in r["out"] and not any_has(to_anna, k) for k in (good, bad)))
    check("and no key is on a command line, where the process list shows it",
          all(k not in r["hermes"] for k in (good, bad)))
    check("the installer's own ChatGPT sign-in is skipped", r["runs"] and r["runs"][-1].get("KB_SIGNIN_SKIP") == "1")


CODE = "fictionalStartCode0123456789abcd"
ONE_CLICK = {"GODSPEED_TG_FLOW": "notebook", "GODSPEED_TELEGRAM_START_CODE": CODE}


def test_one_click_names():
    print("== the name a sent briefing is kept under")
    m = load("tg_setup_names", PROGRAM)
    check("a second download's (1) is dropped, the name kept",
          [m.briefing_name(x) for x in ("what-my-ai-knew (1).md", "what-my-ai-knew.md", "C:\\Users\\a\\notes.TXT",
                                        "AGENTS.md", "../../etc/passwd.md", "")] ==
          ["what-my-ai-knew.md", "what-my-ai-knew.md", "notes.txt", "what-my-ai-knew.md", "passwd.md", "what-my-ai-knew.md"])


def test_one_click_happy():
    briefing = "# What my AI knew\n\nAnna is a fictional nurse in London who runs before work.\n"
    r = scenario_run("the one-click server: the link's code, two sign-ins, city, briefing, goal", {
        "users": USERS,
        "start": [{"from": 999, "text": "/start"}, {"from": 999, "text": "/start guessed"},
                  {"from": 111, "text": "/start " + CODE}],
        "rules": [
            {"when": "Hi Anna", "do": [{"from": 999, "text": "/start " + CODE}]},
            {"when": "Which AI should I think with", "do": [{"from": 111, "press": "openai-codex"}]},
            {"when": "Which city do you live in", "do": [{"from": 111, "text": "London"}]},
            {"when": "Now your briefing", "do": [{"from": 111, "document": {"file_name": "what-my-ai-knew (1).md",
                                                                           "content": briefing}}]},
            {"when": "Last one: your goal", "do": [{"from": 111, "text": "Run a  half marathon\nin May."}]},
        ]}, extra_env=dict(ONE_CLICK, GODSPEED_REVISION=REVISION), prepare=backed_up)
    to_anna, to_eve = r["to"](111), r["to"](999)
    check("it finishes, exit 0", r["rc"] == 0)
    check("only the link's code takes the bot", r["state"].get("owner_id") == 111 and r["state"].get("bot_id") == 42)
    check("before that, a Start without the code is told where the link is",
          sum("open me with the button on your Godspeed page" in t for t in to_eve) == 1)
    check("the code works once: after the owner, the same link is refused",
          to_eve[-1:] == ["This assistant belongs to someone else."])
    check("the welcome names the three steps of this server",
          any_has(to_anna, "Hi Anna", "Sign in to GitHub, where your backup will be kept later",
                  "Your city, your briefing and your goal"))
    check("the ChatGPT and GitHub codes arrive, and git is set up",
          any_has(to_anna, "<code>ABCD-12345</code>") and any_has(to_anna, "<code>1A2B-3C4D</code>")
          and any_has(to_anna, "Nothing is copied there yet") and "auth setup-git" in r["gh"])
    check("no repository, morning brief or world question, and no installer",
          not any_has(to_anna, "already have a Mission Control") and not any_has(to_anna, "morning brief")
          and not any_has(to_anna, "one line about the world") and r["runs"] == [])
    kept = os.path.join(r["workspace"], "what-my-ai-knew.md")
    check("the briefing file is kept at the top of the folder, under its own name",
          os.path.exists(kept) and open(kept, encoding="utf-8").read() == briefing
          and any_has(to_anna, "I keep it as <code>what-my-ai-knew.md</code>"))
    zone = "Europe/London"
    fin = r["finish"]
    check("the goal and the city go to the notebook once, and the bot's key does not",
          len(fin) == 1 and fin[0]["input"] == {"timezone": zone, "goal": "Run a half marathon in May."}
          and fin[0]["token"] is None and fin[0]["code"] is None)
    check("the bot goes to Hermes, and Hermes' clock is the city's",
          "TELEGRAM_BOT_TOKEN=%s" % TOKEN in r["env"] and "TELEGRAM_ALLOWED_USERS=111" in r["env"]
          and "config set timezone %s" % zone in r["hermes"])
    check("the gateway is left to the container's supervisor", "gateway" not in r["hermes"])
    check("the first message goes the brief's road (hermes send)", "this is its chat" in r["hermes_sent"])
    check("setup is marked done", r["state"].get("done") is True)
    check("neither the key nor the start code is in any log",
          all(x not in r["log"] and x not in r["out"] for x in (TOKEN, CODE)))
    # Version 2's installers at this server's own commit, never version 1's latest release.
    check("another computer is sent to version 2's installers, of this server's version",
          any_has(to_anna, "godspeed-mission-control/raw/%s/installers/GodspeedSetup.exe" % REVISION,
                  "godspeed-mission-control/%s/installers/install-godspeed.sh" % REVISION,
                  "--repo https://github.com/anna/notebook.git")
          and not any_has(to_anna, "releases/latest"))


REVISION = "0123456789abcdef0123456789abcdef01234567"


def backed_up(workspace):
    """The notebook's folder already has its backup on GitHub."""
    subprocess.run(["git", "init", "-q", workspace], check=True)
    subprocess.run(["git", "-C", workspace, "remote", "add", "origin", "https://github.com/anna/notebook.git"], check=True)


def test_one_click_snags():
    long_text = "I am a fictional teacher in Leeds. " * 8
    r = scenario_run("the one-click server: Start without the link, a PDF, a pasted briefing, a long goal, a stop", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start"}],
        "rules": [
            {"when": "open me with the button", "do": [{"from": 111, "text": "/start " + CODE}]},
            {"when": "Which AI should I think with", "do": [{"from": 111, "press": "openrouter"}]},
            {"when": "Send me your OpenRouter API key", "do": [{"from": 111, "text": "sk-or-good-0123456789abcdef"}]},
            {"when": "Which city do you live in", "do": [{"from": 111, "press": "tz:keep"}]},
            {"when": "Now your briefing", "do": [{"from": 111, "document": {"file_name": "briefing.pdf", "hex": "25504446"}}]},
            {"when": "I can keep a text file", "do": [{"from": 111, "text": long_text},
                                                      {"from": 111, "text": "Second part of the same paste."}]},
            {"when": "Last one: your goal", "do": [{"from": 111, "text": "x" * 700}]},
            {"when": "That is a lot for one goal", "do": [{"from": 111, "text": "Teach one evening class."}]},
            {"when": "I could not file your goal", "do": [{"from": 111, "press": "finish:retry"}]},
        ]}, extra_env=dict(ONE_CLICK, FAKE_FINISH_FAIL_FIRST="1"))
    to_anna = r["to"](111)
    kept = os.path.join(r["workspace"], "what-my-ai-knew.md")
    check("it finishes, exit 0", r["rc"] == 0)
    check("Start without the link gets the hint, and the link then works", r["state"].get("owner_id") == 111)
    check("a file that is not text is said, and nothing is kept from it",
          any_has(to_anna, "I can keep a text file") and not os.path.exists(os.path.join(r["workspace"], "briefing.pdf")))
    check("a pasted briefing in two messages is kept whole",
          os.path.exists(kept) and open(kept, encoding="utf-8").read() ==
          long_text.strip() + "\nSecond part of the same paste.\n")
    check("an overlong goal is asked again", any_has(to_anna, "That is a lot for one goal"))
    fin = r["finish"]
    check("a stop is said with its reason, and Try again files the answers",
          any_has(to_anna, "I could not file your goal", "The notebook folder is busy right now")
          and len(fin) == 2 and fin[1]["input"]["goal"] == "Teach one evening class."
          and fin[1]["input"]["timezone"] == "Europe/Berlin")
    check("setup is marked done", r["state"].get("done") is True)
    r = scenario_run("the one-click server: the briefing comes later", {
        "users": USERS,
        "start": [{"from": 111, "text": "/start " + CODE}],
        "rules": [
            {"when": "Which AI should I think with", "do": [{"from": 111, "press": "openai-codex"}]},
            {"when": "Which city do you live in", "do": [{"from": 111, "press": "tz:keep"}]},
            {"when": "Now your briefing", "do": [{"from": 111, "press": "brief:later"}]},
            {"when": "Last one: your goal", "do": [{"from": 111, "text": "Sleep eight hours."}]},
        ]}, extra_env=ONE_CLICK)
    check("Later skips the briefing and setup still finishes",
          r["rc"] == 0 and r["state"].get("done") is True and r["state"].get("briefing") == ""
          and any_has(r["to"](111), "Send it to me whenever you like") and len(r["finish"]) == 1)


def test_nothing_to_do():
    r = scenario_run("a token Telegram refuses", {"users": USERS, "start": []},
                     extra_env={"GODSPEED_TELEGRAM_TOKEN": "123:wrong"}, timeout=30)
    check("it stops at once and says why in the log", r["rc"] == 0 and "does not accept" in r["log"])
    check("and the wrong token is in no log", "123:wrong" not in r["log"])
    r = scenario_run("the terminal setup connected Telegram already", {"users": USERS, "start": [{"from": 111, "text": "hi"}]},
                     env_file="TELEGRAM_BOT_TOKEN=999:other\nTELEGRAM_ALLOWED_USERS=5\n", timeout=30)
    check("it stays out of the gateway's way", r["rc"] == 0 and r["fake"].calls.get("getUpdates", 0) == 0
          and "stays out of its way" in r["log"])


if __name__ == "__main__":
    test_codes()
    test_happy()
    test_snags()
    test_found_repo()
    test_key_provider()
    test_one_click_names()
    test_one_click_happy()
    test_one_click_snags()
    test_nothing_to_do()
    print()
    if FAILS:
        print("%d FAILED" % FAILS)
        sys.exit(1)
    print("ALL PASS")
